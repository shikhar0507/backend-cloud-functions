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


const { rootCollections, users, } = require('../admin/admin');
const { code, } = require('../admin/responses');
const {
  handleError,
  sendResponse,
  now,
  disableAccount,
} = require('../admin/utils');



/**
 * Checks the `path` of the URL in the request and handles the execution flow.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const handleRequestPath = (conn) => {
  const action = require('url')
    .parse(conn.req.url)
    .path
    .split('/');

  console.log('API:', action);

  const resource = action[1];

  if (resource === 'activities') {
    const onActivity = require('./on-activity');
    onActivity(conn, action);

    return;
  }

  if (resource === 'services') {
    const onService = require('./on-service');
    onService(conn, action);

    return;
  }

  if (resource.startsWith('read')) {
    const onRead = require('../firestore/on-read');
    onRead(conn);

    return;
  }

  if (resource.startsWith('admin')) {
    const onAdmin = require('./on-admin');

    onAdmin(conn, action);

    return;
  }

  if (resource === 'now') {
    now(conn);

    return;
  }

  sendResponse(
    conn,
    code.notFound,
    'No resource found at this path.'
  );
};


/**
 * Fetches the phone number of the requester and verifies
 * if the document for this phone number inside the /Profiles
 * has the same uid as the requester.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} userRecord User record object from Firebase Auth.
 * @returns {void}
 */
const getProfile = (conn, userRecord) => {
  rootCollections
    .profiles
    .doc(conn.requester.phoneNumber)
    .get()
    .then((doc) => {
      conn.requester.lastFromQuery = doc.get('lastFromQuery');
      /**
        * When a user signs up for the first time, the `authOnCreate`
        * cloud function creates two docs in the Firestore.
        *
        * `Profiles/(phoneNumber)`, & `Updates/(uid)`.
        *
        * The `Profiles` doc has `phoneNumber` of the user as the `doc-id`.
        * It has one field `uid` = the uid from the auth.
        *
        * The Updates doc has the `doc-id` as the uid from the auth
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
        * the `auth` creation and the hit time on the api.
        */
      const authCreationTime =
        new Date(userRecord.metadata.creationTime).getTime();

      if (Date.now() - authCreationTime < 60) {
        handleRequestPath(conn);

        return;
      }

      if (doc.get('uid') !== conn.requester.uid) {
        console.log({
          msg: `The uid and phone number of the requester does not match.`,
          authUid: conn.requester.uid,
          profileUid: doc.get('uid'),
        });

        /**
         * The user probably managed to change their phone number by something
         * other than out provided endpoint for updating the `auth`.
         * Disabling their account because this is not allowed.
         */
        disableAccount(
          conn,
          `The uid and phone number of the requester does not match.`
        );

        return;
      }

      handleRequestPath(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Fetches the requester phone number from auth.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const fetchRequesterPhoneNumber = (conn) =>
  users
    .getUserByUid(conn.requester.uid)
    .then((userRecord) => {
      if (userRecord.disabled) {
        /** Users with disabled accounts cannot request any operation **/
        sendResponse(
          conn,
          code.forbidden,
          'Your account is disabled. Please contact support.'
        );

        return;
      }

      if (userRecord.customClaims) {
        conn.requester.customClaims = userRecord.customClaims;
      }

      conn.requester.phoneNumber = userRecord.phoneNumber;
      conn.requester.displayName = userRecord.displayName || '';

      console.log('phoneNumber:', conn.requester.phoneNumber);

      getProfile(conn, userRecord);

      return;
    })
    .catch((error) => handleError(conn, error));


/**
 * Verifies the `id-token` form the Authorization header in the request.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const checkAuthorizationToken = (conn) => {
  if (!conn.req.headers.hasOwnProperty('authorization')) {
    sendResponse(
      conn,
      code.unauthorized,
      'The authorization header is missing from the headers.'
    );

    return;
  }

  if (typeof conn.req.headers.authorization !== 'string') {
    sendResponse(
      conn,
      code.unauthorized,
      'The authorization header is not valid.'
    );

    return;
  }

  if (!conn.req.headers.authorization.startsWith('Bearer ')) {
    sendResponse(
      conn,
      code.unauthorized,
      `Authorization type is not 'Bearer'.`
    );

    return;
  }

  /** Checks if the token was revoked recently when set to `true` */
  const checkRevoked = true;

  users
    .verifyIdToken(
      conn.req.headers.authorization.split('Bearer ')[1],
      checkRevoked
    )
    .then((decodedIdToken) => {
      /** Object to identify the requester throughout the flow. */
      conn.requester = {};
      conn.requester.uid = decodedIdToken.uid;

      fetchRequesterPhoneNumber(conn);

      return;
    })
    .catch((error) => {
      if (error.code === 'auth/id-token-revoked') {
        sendResponse(
          conn,
          code.unauthorized,
          'The idToken was revoked recently. Please re-authenticate.'
        );

        return;
      }

      if (error.code === 'auth/argument-error') {
        sendResponse(
          conn,
          code.unauthorized,
          `The idToken in the request header is invalid/expired.`
          + ` Please re-authenticate.`
        );

        return;
      }

      console.error(error);

      sendResponse(
        conn,
        code.forbidden,
        `There was an error processing the idToken sent in the request.`
        + ` Please re-authenticate.`
      );
    });
};


/**
 * Handles the routing for the request from the clients.
 *
 * @param {Object} req Express Request object.
 * @param {Object} res Express Response object.
 * @returns {void}
 */
module.exports = (req, res) => {
  const conn = {
    req,
    res,
  };

  conn.headers = {
    /** The pre-flight headers */
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, HEAD, POST, GET, PATCH, PUT',
    'Access-Control-Allow-Headers': 'X-Requested-With, Authorization,' +
      'Content-Type, Accept',
    // 30 days
    'Access-Control-Max-Age': 2592000,
    'Content-Type': 'application/json',
    'Content-Language': 'en-US',
    'Cache-Control': 'no-cache',
  };

  if (new Set()
    .add('OPTIONS')
    .add('HEAD')
    .has(req.method)) {
    /** FOR handling CORS... */
    sendResponse(conn, code.noContent);

    return;
  }

  /** Allowed methods */
  if (new Set()
    .add('GET')
    .add('POST')
    .add('PATCH')
    .add('PUT')
    .has(req.method)) {
    checkAuthorizationToken(conn);

    return;
  }

  sendResponse(
    conn,
    code.notImplemented,
    `${req.method} is not supported for any request.`
    + ' Please use `GET`, `POST`, `PATCH`, or `PUT` to make your requests.'
  );
};
