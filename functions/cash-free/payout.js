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
const {promisify} = require('util');
const {rootCollections} = require('../admin/admin');
const {getISO8601Date} = require('../admin/utils');

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

  const {cashFree} = timerDoc.data() || {};

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

const getHeaders = async () => {
  return {
    Authorization: await getBearerToken(),
  };
};

const requestTransfer = async options => {
  const uri = url.resolve(endpoint, '/payout/v1/requestTransfer');
  const {remarks, beneId, amount} = options;

  const TRANSFER_MODES = {
    BANK_TRANSFER: 'banktransfer',
    UPI: 'upi',
    PAYTM: 'paytm',
    AMAZON_PAY: 'amazonpay',
    CARD: 'card',
  };

  return rpn(uri, {
    headers: await getHeaders(),
    method: 'POST',
    body: {
      remarks,
      beneId,
      amount,
      transferId: crypto.randomBytes(16).toString('hex'),
      transferMode: options.transferMode || TRANSFER_MODES.BANK_TRANSFER,
    },
    json: true,
  });
};

const getTransferStatus = async options => {
  const uri = url.resolve(endpoint, '/payout/v1/getTransferStatus');
  const {referenceId, transferId} = options;

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

const validateBank = async options => {
  const {name, phone, bankAccount, ifsc} = options;

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

const addBeneficiary = async options => {
  const uri = url.resolve(endpoint, '/payout/v1/addBeneficiary');

  return rpn(uri, {
    method: 'POST',
    json: true,
    headers: await getHeaders(),
    body: {
      beneId: options.beneId,
      name: options.name,
      email: options.email,
      phone: options.phone,
      bankAccount: options.bankAccount,
      ifsc: options.ifsc,
      address1: options.address1,
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

const verifyWebhookPost = (webhookData, clientSecret) => {
  let concatenatedValues = '';
  const receivedSignature = webhookData.signature;
  delete webhookData.signature;
  const sortedKeys = Object.keys(webhookData).sort();

  sortedKeys.forEach(key => (concatenatedValues += `${webhookData[key]}`));

  const calculatedSignature = crypto
    .createHmac('sha256', clientSecret)
    .update(concatenatedValues)
    .digest('base64');

  return calculatedSignature === receivedSignature;
};

const getBalance = async () => {
  const uri = url.resolve(endpoint, '/payout/v1/getBalance');

  return rpn(uri, {
    headers: await getHeaders(),
    json: true,
  });
};

const selfWithdrawal = async options => {
  const uri = url.resolve(endpoint, '/payout/v1/selfWithdrawal');

  return rpn(uri, {
    headers: await getHeaders(),
    json: true,
    method: 'POST',
    body: {
      amount: options.amount,
      remarks: options.remarks,
      withdrawalId: crypto.randomBytes(16).toString('hex'),
    },
  });
};

module.exports = {
  getBalance,
  validateBank,
  selfWithdrawal,
  getBeneficiary,
  addBeneficiary,
  requestTransfer,
  verifyWebhookPost,
  removeBeneficiary,
  getTransferStatus,
};
