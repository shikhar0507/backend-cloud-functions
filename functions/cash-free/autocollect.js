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

const {
  promisify
} = require('util');
const {
  rootCollections,
} = require('../admin/admin');
const {
  getISO8601Date,
} = require('../admin/utils');

const endpoint = (() => {
  if (env.isProduction) {
    return 'https://cac-api.cashfree.com';
  }

  return 'https://cac-gamma.cashfree.com';
})();


const encryptWithPublicKey = async keyPath => {
  const message = `${CLIENT_ID}.${momentTz().unix()}`;
  const readFile = promisify(fs.readFile);

  return crypto
    .publicEncrypt({
      key: await readFile(keyPath),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, Buffer.from(message))
    .toString('base64');
};

const getAutocollectToken = async () => {
  const uri = url.resolve(endpoint, '/cac/v1/authorize');
  const keyPath = (() => {
    if (env.isProduction) {
      return path.resolve('./admin', 'payout_prod.pem');
    }

    return path.resolve('./admin', 'payout_test.pem');
  })();

  console.log(keyPath);

  return rpn(uri, {
    method: 'POST',
    json: true,
    headers: {
      'X-Client-Id': CLIENT_ID,
      'X-Client-Secret': CLIENT_SECRET,
      'X-CF-Signature': await encryptWithPublicKey(keyPath),
    },
  });
};

const verifyAuthToken = async authToken => {
  const uri = url.resolve(endpoint, '/cac/v1/verifyToken');

  return rpn(uri, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${authToken}`
    },
    json: true,
  });
};

const getBearerToken = async () => {
  const timerDoc = await rootCollections
    .timers
    .doc(getISO8601Date())
    .get();

  const { cashFree } = timerDoc.data() || {};

  console.log('Timer', timerDoc.ref.path);

  // Token is already present
  if (cashFree && cashFree.autocollect) {
    // Just verify if it hasn't expired
    const tokenValidResponse = await verifyAuthToken(cashFree.autocollect.token);

    if (tokenValidResponse.subCode === '200') {
      return `Bearer ${cashFree.autocollect.token}`;
    }
  }

  const authTokenResponse = await getAutocollectToken();

  await timerDoc
    .ref
    .set({
      cashFree: {
        autocollect: {
          token: authTokenResponse.data.token,
        },
      },
    }, {
      merge: true,
    });

  return `Bearer ${authTokenResponse.data.token}`;
};

const getHeaders = async () => {
  return {
    Authorization: await getBearerToken(),
  };
};

const createVirtualAccount = async options => {
  const uri = url.resolve(endpoint, '/cac/v1/createVA');
  const { vAccountId, name, phone, email } = options;

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
