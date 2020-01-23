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

const { auth, rootCollections } = require('../admin/admin');
const { code } = require('../admin/responses');
const {
  sendResponse,
  handleError,
  isValidEmail,
  hasSupportClaims,
  isE164PhoneNumber,
} = require('../admin/utils');
const { sendGridTemplateIds } = require('../admin/constants');
const env = require('../admin/env');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(env.sgMailApiKey);

const sendVerificationEmail = (userRecord, body) => {
  return sgMail.send({
    templateId: sendGridTemplateIds.verificationEmail,
    to: {
      name: userRecord.displayName || body.displayName || '',
      email: userRecord.email || body.email,
    },
    from: {
      name: 'Growthfile Help',
      email: env.systemEmail,
    },
    dynamicTemplateData: {
      phoneNumber: body.phoneNumber,
      verificationUrl: `${env.mainDomain}/verify-email?uid=${userRecord.uid}`,
    },
    subject: 'Verify your email on Growthfile',
  });
};

const getUserFromAuth = phoneNumber => {
  const result = {
    phoneNumber,
    found: false,
    uid: null,
    displayName: null,
    photoURL: null,
  };

  const valuesPolyfill = object => {
    return Object.keys(object).map(key => object[key]);
  };

  /**
   * A temporary polyfill for using `Object.values` since sendgrid has
   * probably removed support for Node 6, but the Node 8 runtime is still
   * suffering from "connection error" issue at this time.
   * Will remove this after a few days.
   *
   * @see https://github.com/sendgrid/sendgrid-nodejs/issues/929
   * @see https://github.com/firebase/firebase-functions/issues/429
   */
  Object.values = Object.values || valuesPolyfill;

  return auth
    .getUserByPhoneNumber(phoneNumber)
    .then(userRecord => {
      const { uid, displayName, disabled, email, emailVerified } = userRecord;

      result.uid = uid;
      result.email = email;
      result.emailVerified = emailVerified;
      result.displayName = displayName;
      result.disabled = disabled;

      return result;
    })
    .catch(error => {
      return {
        uid: null,
        errorCode: error.code,
      };
    });
};

module.exports = conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'POST'`,
    );
  }

  // Handling country code automatically.
  if (!conn.req.body.phoneNumber.startsWith('+')) {
    conn.req.body.phoneNumber = `+${conn.req.body.phoneNumber}`;
  }

  if (!hasSupportClaims(conn.requester.customClaims)) {
    return sendResponse(
      conn,
      code.unauthorized,
      `You cannot access this resource`,
    );
  }

  /** Email can be null also */
  if (conn.req.body.email && !isValidEmail(conn.req.body.email)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Invalid/Missing email from the request body`,
    );
  }

  if (!isE164PhoneNumber(conn.req.body.phoneNumber)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Invalid phone number: ${conn.req.body.phoneNumber}`,
    );
  }

  if (!env.isProduction) {
    return sendResponse(conn, code.ok, 'User successfully created/updated.');
  }

  let sendEmail = false;
  const authRecord = {};

  return getUserFromAuth(conn.req.body.phoneNumber)
    .then(authFetchResult => {
      // User not found
      if (!authFetchResult.uid) {
        if (authFetchResult.errorCode === 'auth/user-not-found') {
          sendEmail = true;
          console.log('Creating user:', conn.req.body);

          return auth.createUser({
            phoneNumber: conn.req.body.phoneNumber,
            email: conn.req.body.email,
            displayName: conn.req.body.displayName,
          });
        }

        throw new Error(authFetchResult.errorCode);
      }

      if (authFetchResult.email !== conn.req.body.email) {
        sendEmail = true;
        authRecord.email = conn.req.body.email;
        authRecord.emailVerified = false;
      }

      if (authFetchResult.displayName !== conn.req.body.displayName) {
        authRecord.displayName = conn.req.body.displayName;
      }

      console.log('Updating user:', authRecord);

      return auth.updateUser(authFetchResult.uid, authRecord);
    })
    .then(userRecord => {
      if (!sendEmail) {
        return Promise.resolve();
      }

      console.log('sending email for:', userRecord);

      const promises = [];

      if (sendEmail && env.isProduction) {
        promises.push(sendVerificationEmail(userRecord, conn.req.body));
      }

      if (userRecord.uid) {
        const promise = rootCollections.updates.doc(userRecord.uid).set(
          {
            // When the user visits the verification link sent
            // to them in the email, this link will allow
            // the backend to verify if their email verification
            // was initiated
            emailVerificationRequestPending: true,
          },
          {
            merge: true,
          },
        );

        promises.push(promise);
      }

      return Promise.all(promises);
    })
    .then(() => {
      return sendResponse(conn, code.ok, 'User successfully created/updated.');
    })
    .catch(error => {
      if (error.code === 'auth/email-already-exists') {
        return auth
          .getUserByEmail(conn.req.body.email)
          .then(userRecord =>
            sendResponse(
              conn,
              code.conflict,
              `'${conn.req.body.email}' is already in use by '${userRecord.phoneNumber}'`,
            ),
          );
      }

      return handleError(conn, error);
    });
};
