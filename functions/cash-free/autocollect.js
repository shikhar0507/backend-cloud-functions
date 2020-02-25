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
const env = require('../admin/env');
const url = require('url');
const fs = require('fs');
const path = require('path');
const momentTz = require('moment-timezone');
const crypto = require('crypto');
const CLIENT_ID = env.cashFree.autocollect.clientId;
const CLIENT_SECRET = env.cashFree.autocollect.clientSecret;

const { promisify } = require('util');
const { rootCollections } = require('../admin/admin');
const { getISO8601Date } = require('../admin/utils');

const endpoint = (() => {
  if (env.isProduction) {
    return 'https://cac-api.cashfree.com';
  }

  return 'https://cac-gamma.cashfree.com';
})();

const keyPath = (() => {
  if (env.isProduction) {
    return path.resolve('./admin', 'payout_prod.pem');
  }

  return path.resolve('./admin', 'payout_test.pem');
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

const getAutocollectToken = async () => {
  const uri = url.resolve(endpoint, '/cac/v1/authorize');
  console.log('keyPath', keyPath);
  // console.log()
  const headers = {
    'X-Client-Id': CLIENT_ID,
    'X-Client-Secret': CLIENT_SECRET,
    'X-CF-Signature': await encryptWithPublicKey(keyPath),
  };

  console.log('headers', headers);

  return rpn(uri, {
    method: 'POST',
    json: true,
    headers,
  });
};

const verifyAuthToken = async authToken => {
  const uri = url.resolve(endpoint, '/cac/v1/verifyToken');

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

  console.log('Timer', timerDoc.ref.path);

  // Token is already present
  if (cashFree && cashFree.autocollect) {
    // Just verify if it hasn't expired
    const tokenValidResponse = await verifyAuthToken(
      cashFree.autocollect.token,
    );

    if (tokenValidResponse.subCode === '200') {
      return `Bearer ${cashFree.autocollect.token}`;
    }
  }

  const authTokenResponse = await getAutocollectToken();

  console.log('authTokenResponse', authTokenResponse);

  await timerDoc.ref.set(
    {
      cashFree: {
        autocollect: {
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

const createVirtualAccount = async ({ vAccountId, name, phone, email }) => {
  const uri = url.resolve(endpoint, '/cac/v1/createVA');

  return rpn(uri, {
    method: 'POST',
    json: true,
    headers: await getHeaders(),
    body: {
      vAccountId,
      name,
      phone,
      email,
    },
  });
};

module.exports = {
  createVirtualAccount,
};
