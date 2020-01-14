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

const {db, auth, rootCollections} = require('../admin/admin');
const {code} = require('../admin/responses');
const {
  handleError,
  sendResponse,
  headerValid,
  disableAccount,
  hasSupportClaims,
  hasAdminClaims,
  sendJSON,
} = require('../admin/utils');
const env = require('../admin/env');
const routes = require('../routes');
const {Logging} = require('@google-cloud/logging');

const handleResource = conn => {
  const resource = routes(conn.req);

  /** 404 */
  if (!resource.func) {
    return sendResponse(
      conn,
      code.notFound,
      `The path: '${conn.req.url}' was not found on this server.`,
    );
  }

  const rejectAdminRequest =
    resource.checkAdmin &&
    !hasAdminClaims(conn.requester.customClaims) &&
    !conn.requester.isSupportRequest;
  const rejectSupportRequest =
    resource.checkSupport &&
    conn.requester.isSupportRequest &&
    !hasSupportClaims(conn.requester.customClaims);

  if (rejectAdminRequest || rejectSupportRequest) {
    return sendResponse(
      conn,
      code.forbidden,
      `You are not allowed to access this resource`,
    );
  }

  if (conn.requester.customClaims.admin && conn.requester.customClaims.admin.length) {
    return resource.func(conn);
  }

  if (conn.requester.customClaims.manageTemplates && resource.checkManageTemplates) {
    return resource.func(conn);
  }

 return sendResponse(
    conn,
    code.forbidden,
    `You are not allowed to access this resource`
  );
};

const getProfile = conn => {
  const batch = db.batch();
  /**
   * When a user signs up for the first time, the `authOnCreate`
   * cloud function creates two docs in the Firestore.
   *
   * `Profiles/(phoneNumber)`, & `Updates/(uid)`.
   *
   * The `Profiles` doc has `phoneNumber` of the user as the `doc-id`.
   * It has one field `uid` = the uid from the auth.
   *
   * The `Updates` doc has the `doc-id` as the `uid` from the auth
   * and one field `phoneNumber` = phoneNumber from auth.
   *
   * When a user signs up via the user facing app, they instantly hit
   * the `/api` endpoint. In normal flow, the
   * `getProfile` is called.
   *
   * It compares the `uid` from profile doc and the `uid` from auth.
   * If the `authOnCreate` hasn't completed execution in this time,
   * chances are that this doc won't be found and getting the uid
   * from this non-existing doc will result in `disableAccount` function
   * being called.
   *
   * To counter this, we allow a grace period of `60` seconds between
   * the `auth` creation and the hit time on the `api`.
   */
  const AUTH_CREATION_TIMESTAMP = new Date(
    conn.requester.creationTime,
  ).getTime();
  const NUM_MILLI_SECS_IN_MINUTE = 60000;

  if (Date.now() - AUTH_CREATION_TIMESTAMP < NUM_MILLI_SECS_IN_MINUTE) {
    return handleResource(conn);
  }

  return rootCollections.profiles
    .doc(conn.requester.phoneNumber)
    .get()
    .then(profileDoc => {
      conn.requester.profileDoc = profileDoc;
      conn.requester.lastQueryFrom = profileDoc.get('lastQueryFrom');
      conn.requester.employeeOf = profileDoc.get('employeeOf') || {};

      /**
       * In `/api`, if uid is undefined in /Profiles/{phoneNumber} && authCreateTime and lastSignInTime is same,
       *   run `authOnCreate` logic again.
       */
      if (
        profileDoc.get('uid') &&
        profileDoc.get('uid') !== conn.requester.uid
      ) {
        console.log({
          authCreationTime: AUTH_CREATION_TIMESTAMP,
          now: Date.now(),
          msg: `The uid and phone number of the requester does not match.`,
          phoneNumber: profileDoc.id,
          profileUid: profileDoc.get('uid'),
          authUid: conn.requester.uid,
          gracePeriodInSeconds: NUM_MILLI_SECS_IN_MINUTE,
          diff: Date.now() - AUTH_CREATION_TIMESTAMP,
        });

        /**
         * The user probably managed to change their phone number by something
         * other than out provided endpoint for updating the `auth`.
         * Disabling their account because this is not allowed.
         */
        return disableAccount(
          conn,
          `The uid and phone number of the requester does not match.`,
        );
      }

      /** AuthOnCreate probably failed. This is the fallback */
      if (!profileDoc.get('uid')) {
        batch.set(
          profileDoc.ref,
          {
            uid: conn.requester.uid,
          },
          {
            merge: true,
          },
        );

        batch.set(
          rootCollections.updates.doc(conn.requester.uid),
          {
            phoneNumber: conn.requester.phoneNumber,
          },
          {
            merge: true,
          },
        );
      }

      return Promise.all([batch.commit(), handleResource(conn)]);
    })
    .catch(error => handleError(conn, error));
};

const getUserAuthFromIdToken = async (conn, decodedIdToken) => {
  const userRecord = await auth.getUser(decodedIdToken.uid);

  if (userRecord.disabled) {
    /** Users with disabled accounts cannot request any operation **/
    return sendResponse(
      conn,
      code.forbidden,
      `This account has been temporarily disabled. Please contact` +
        ` your admin`,
    );
  }

  conn.requester = {
    uid: decodedIdToken.uid,
    emailVerified: userRecord.emailVerified,
    email: userRecord.email || '',
    phoneNumber: userRecord.phoneNumber,
    displayName: userRecord.displayName || '',
    photoURL: userRecord.photoURL || '',
    customClaims: userRecord.customClaims || null,
    creationTime: userRecord.metadata.creationTime,
    /**
     * Can be used to verify in the activity flow to see if the request
     * is of type support.
     *
     * URL query params are of type `string`
     */
    isSupportRequest: conn.req.query.support === 'true',
  };

  if (routes(conn.req).func === '/now') {
    return require('../firestore/now')(conn);
  }

  return getProfile(conn);
};

const reportBackgroundError = async (error, logName) => {
  // DOCS: https://firebase.google.com/docs/functions/reporting-errors
  const logging = new Logging();
  const log = logging.log(logName);
  const metadata = {
    resource: {
      type: 'cloud_function',
      labels: {
        function_name: process.env.FUNCTION_NAME,
      },
    },
  };

  const errorEvent = {
    message: error.stack,
    serviceContext: {
      service: process.env.FUNCTION_NAME,
      resourceType: 'cloud_function',
    },
  };

  return new Promise((resolve, reject) => {
    return log.write(log.entry(metadata, errorEvent), error => {
      if (error) {
        return reject(new Error(error));
      }

      return resolve();
    });
  });
};

/**
 * Verifies the `id-token` form the Authorization header in the request.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const checkAuthorizationToken = async conn => {
  const result = headerValid(conn.req.headers);

  if (!result.isValid) {
    return sendResponse(conn, code.forbidden, result.message);
  }

  try {
    const decodedIdToken = await auth.verifyIdToken(
      result.authToken,
      true, // checkRevoked is true in order to block all requests
      // from revoked sessions by a user.
    );

    return getUserAuthFromIdToken(conn, decodedIdToken);
  } catch (error) {
    if (
      error.code === 'auth/id-token-expired' ||
      error.code === 'auth/id-token-revoked'
    ) {
      return sendResponse(
        conn,
        code.unauthorized,
        'Please restart the Growthfile app',
      );
    }

    const errorObject = {
      error,
      url: conn.req.url,
      body: conn.req.body,
      header: conn.req.headers,
    };

    await reportBackgroundError(errorObject, 'AUTH_REJECTION');

    return sendResponse(conn, code.unauthorized, 'Unauthorized');
  }
};

/**
 * Handles the routing for the request from the clients.
 *
 * @param {Object} req Express Request object.
 * @param {Object} res Express Response object.
 * @returns {void}
 */
module.exports = async (req, res) => {
  const allowedMethods = [
    'OPTIONS',
    'HEAD',
    'POST',
    'GET',
    'PATCH',
    'PUT',
    'DELETE',
  ];

  const conn = {
    req,
    res,
    headers: {
      /** The pre-flight headers */
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': `${allowedMethods}`,
      'Access-Control-Allow-Headers':
        'X-Requested-With, Authorization,' + 'Content-Type, Accept',
      'Access-Control-Max-Age': 86400,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Cache-Control': 'no-cache',
    },
  };

  /** For handling CORS */
  if (req.method === 'HEAD' || req.method === 'OPTIONS') {
    //TODO: HEAD is probably not required here. Test and remove
    return sendResponse(conn, code.noContent);
  }

  if (!allowedMethods.includes(req.method)) {
    return sendResponse(
      conn,
      code.notImplemented,
      `${req.method} is not supported for any request.` +
        `Please use '${allowedMethods}'` +
        ' to make your requests',
    );
  }

  if (env.isProduction && conn.req.query.cashFreeToken === env.cashFreeToken) {
    await rootCollections.errors.doc().set({
      report: 'cashfree',
      body: conn.req.body || {},
      timestamp: Date.now(),
    });

    return sendResponse(conn, code.ok);
  }

  if (conn.req.path === '/webhook/facebook') {
    const result = await require('../webhooks/facebook')(conn);

    return sendJSON(conn, result);
  }

  if (conn.req.path === '/webhook/sendgrid') {
    await require('../webhooks/sendgrid')(conn);

    return sendResponse(conn, code.ok);
  }

  if (
    env.isProduction &&
    (!conn.req.headers['x-cf-secret'] ||
      conn.req.headers['x-cf-secret'] !== env.cfSecret)
  ) {
    return sendResponse(
      conn,
      code.forbidden,
      `Missing 'X-CF-Secret' header in the request headers`,
    );
  }

  return checkAuthorizationToken(conn);

  // const r = await auth.getUserByPhoneNumber('+918527801091');
  // await auth.setCustomUserClaims(r.uid, {
  //   support: true,
  // })

  // sendResponse(conn ,200);

};