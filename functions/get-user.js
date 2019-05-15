'use strict';

const {
  auth,
} = require('./admin/admin');
const {
  code,
} = require('./admin/responses');
const env = require('./admin/env');

const sendJSON = (res, statusCode, data = {}) =>
  res.status(statusCode).json(data);

module.exports = (req, res) => {
  res.header('Access-Control-Allow-Origin', env.mainDomain);

  if (!process.env.PRODUCTION) {
    res.header('Access-Control-Allow-Origin', req.get('origin'));
  }

  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return sendJSON(res, code.noContent);
  }

  if (req.method !== 'GET') {
    return sendJSON(res, code.methodNotAllowed, {
      showFullLogin: '',
      success: false,
      message: `${req.method} is not allowed. Use GET`,
    });
  }

  console.log('url', req.url);
  console.log('phoneNumber', req.query.phoneNumber);

  return auth
    .getUserByPhoneNumber(req.query.phoneNumber)
    .then((userRecord) => {
      console.log('userRecord', userRecord.toJSON());

      return sendJSON(res, code.ok, {
        showFullLogin: !userRecord.email
          || !userRecord.emailVerified
          || !userRecord.displayName,
        success: true,
        message: '',
      });
    })
    .catch((error) => {
      console.log('AutError', error.code);

      if (error.code.startsWith('auth/')) {
        return sendJSON(res, code.ok, {
          showFullLogin: true,
          success: true,
          message: '',
        });
      }

      return sendJSON(res, code.internalServerError, {
        showFullLogin: false,
        success: false,
        message: 'Something went wrong',
      });
    });
};
