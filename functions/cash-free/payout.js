/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const rpn = require('request-promise-native');
const url = require('url');
const fs = require('fs');
const path = require('path');
const momentTz = require('moment-timezone');
const crypto = require('crypto');
const env = require('../admin/env');
const CLIENT_ID = env.cashFree.payout.clientId;
const CLIENT_SECRET = env.cashFree.payout.clientSecret;
const { promisify } = require('util');
const { rootCollections } = require('../admin/admin');
const { getISO8601Date } = require('../admin/utils');

const endpoint = (() => {
  if (env.isProduction) {
    return 'https://payout-api.cashfree.com';
  }

  return 'https://payout-gamma.cashfree.com';
})();

const encryptWithPublicKey = async keyPath => {
  const message = `${CLIENT_ID}.${momentTz().unix()}`;
  const readFile = promisify(fs.readFile);

  return crypto
    .publicEncrypt(
      {
        key: await readFile(keyPath),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      Buffer.from(message),
    )
    .toString('base64');
};

const getPayoutToken = async () => {
  const authUri = url.resolve(endpoint, '/payout/v1/authorize');
  const keyPath = (() => {
    if (env.isProduction) {
      return path.resolve('./admin', 'payout_prod.pem');
    }

    return path.resolve('./admin', 'payout_test.pem');
  })();

  return rpn(authUri, {
    method: 'POST',
    headers: {
      'X-Client-Id': CLIENT_ID,
      'X-Client-Secret': CLIENT_SECRET,
      'X-CF-Signature': await encryptWithPublicKey(keyPath),
    },
    json: true,
  });
};

const verifyAuthToken = async authToken => {
  const uri = url.resolve(endpoint, '/payout/v1/verifyToken');

  return rpn(uri, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    json: true,
  });
};

const getBearerToken = async () => {
  const timerDoc = await rootCollections.timers.doc(getISO8601Date()).get();

  const { cashFree } = timerDoc.data() || {};

  // Token is already present
  if (cashFree && cashFree.payout) {
    // Just verify if it hasn't expired
    const tokenValidResponse = await verifyAuthToken(cashFree.payout.token);

    if (tokenValidResponse.subCode === '200') {
      return `Bearer ${cashFree.payout.token}`;
    }
  }

  const authTokenResponse = await getPayoutToken();

  await timerDoc.ref.set(
    {
      cashFree: {
        payout: {
          token: authTokenResponse.data.token,
        },
      },
    },
    {
      merge: true,
    },
  );

  return `Bearer ${authTokenResponse.data.token}`;
};

const getHeaders = async () => ({
  Authorization: await getBearerToken(),
});

const requestTransfer = async ({ remarks, beneId, amount }) => {
  const uri = url.resolve(endpoint, '/payout/v1/requestTransfer');

  return rpn(uri, {
    headers: await getHeaders(),
    method: 'POST',
    body: {
      remarks,
      beneId,
      amount,
      transferId: crypto.randomBytes(16).toString('hex'),
      transferMode: 'banktransfer',
    },
    json: true,
  });
};

const getTransferStatus = async ({ referenceId, transferId }) => {
  const uri = url.resolve(endpoint, '/payout/v1/getTransferStatus');

  return rpn(uri, {
    json: true,
    method: 'GET',
    headers: await getHeaders(),
    qs: {
      referenceId,
      transferId,
    },
  });
};

const validateBank = async ({ name, phone, bankAccount, ifsc }) => {
  const uri = url.resolve(endpoint, '/payout/v1/validation/bankDetails');

  return rpn(uri, {
    method: 'GET',
    json: true,
    headers: await getHeaders(),
    qs: {
      name,
      phone,
      bankAccount,
      ifsc,
    },
  });
};

const addBeneficiary = async ({
  beneId,
  name,
  email,
  phone,
  bankAccount,
  ifsc,
  address1,
}) => {
  const uri = url.resolve(endpoint, '/payout/v1/addBeneficiary');

  return rpn(uri, {
    method: 'POST',
    json: true,
    headers: await getHeaders(),
    body: {
      beneId,
      name,
      email,
      phone,
      bankAccount,
      ifsc,
      address1,
    },
  });
};

const getBeneficiary = async beneId => {
  const uri = url.resolve(endpoint, `/payout/v1/getBeneficiary/${beneId}`);

  return rpn(uri, {
    headers: await getHeaders(),
    json: true,
  });
};

const removeBeneficiary = async beneId => {
  const uri = url.resolve(endpoint, '/payout/v1/removeBeneficiary');

  return rpn(uri, {
    body: {
      beneId,
    },
    method: 'POST',
    headers: await getHeaders(),
    json: true,
  });
};

const getBalance = async () => {
  const uri = url.resolve(endpoint, '/payout/v1/getBalance');

  return rpn(uri, {
    headers: await getHeaders(),
    json: true,
  });
};

const requestBatchTransfer = async ({ batchTransferId, batch }) => {
  const uri = url.resolve(endpoint, '/payout/v1/requestBatchTransfer');

  return rpn(uri, {
    headers: await getHeaders(),
    json: true,
    method: 'POST',
    body: {
      batch,
      batchTransferId,
      batchFormat: 'BANK_ACCOUNT',
    },
  });
};

module.exports = {
  requestBatchTransfer,
  getBalance,
  validateBank,
  getBeneficiary,
  addBeneficiary,
  requestTransfer,
  removeBeneficiary,
  getTransferStatus,
};
