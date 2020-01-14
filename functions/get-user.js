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

const {auth} = require('./admin/admin');
const {isE164PhoneNumber} = require('./admin/utils');
const {code} = require('./admin/responses');
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

  if (!isE164PhoneNumber(req.query.phoneNumber)) {
    return sendJSON(res, code.badRequest, {
      showFullLogin: false,
      success: false,
      message: `Invalid phone number`,
    });
  }

  console.log('origin:', req.get('origin'));

  /** No OTP in non-production environment */
  if (!env.isProduction) {
    return sendJSON(res, code.ok, {
      showFullLogin: false,
      success: true,
      message: ``,
    });
  }

  return auth
    .getUserByPhoneNumber(req.query.phoneNumber)
    .then(userRecord => {
      console.log('userRecord', userRecord.toJSON());

      return sendJSON(res, code.ok, {
        showFullLogin:
          !userRecord.email ||
          !userRecord.emailVerified ||
          !userRecord.displayName,
        success: true,
        message: '',
      });
    })
    .catch(error => {
      console.log('AuthError', error.code, JSON.stringify(req.query));

      if (error.code === 'auth/invalid-phone-number') {
        return sendJSON(res, code.badRequest, {
          showFullLogin: true,
          success: true,
          message: 'Invalid phone number',
        });
      }

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
