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


const {
  parse,
} = require('url');

const {
  rootCollections,
  users,
} = require('../admin/admin');

const {
  getUserByUid,
  verifyIdToken,
} = users;

const {
  handleError,
  sendResponse,
  now,
  disableAccount,
} = require('../admin/utils');

const {
  code,
} = require('../admin/responses');

const onService = require('./on-service');
const onActivity = require('./on-activity');

const {
  profiles,
} = rootCollections;


/**
 * Checks the path of the URL in the reuqest and handles the execution flow.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const handleRequestPath = (conn) => {
  const action = parse(conn.req.url).path.split('/')[1];

  if (action === 'activities') {
    onActivity(conn);
    return;
  }

  if (action === 'services') {
    onService(conn);
    return;
  }

  if (action === 'now') {
    now(conn); // server timestamp
    return;
  }

  sendResponse(conn, code.badRequest, 'The request path is not valid');
};


/**
 * Fetches the phone number of the requester and verifies
 * if the document for this phone number inside the /Profiles
 * has the same uid as the requester.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const verifyUidAndPhoneNumberCombination = (conn) => {
  profiles.doc(conn.requester.phoneNumber).get().then((doc) => {
    if (doc.get('uid') !== conn.requester.uid) {
      /** The user probably managed to change their phone number by something
       * other than out provided endpoint for updating the auth.
       * Disabling their account because this is not allowed.
       */
      disableAccount(
        conn,
        'The uid and phone number of the requester does not match.'
      );
      return;
    }

    handleRequestPath(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the requestor's phone number from auth.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const getCreatorsPhoneNumber = (conn) => {
  getUserByUid(conn.requester.uid).then((userRecord) => {
    if (userRecord.disabled) {
      /** users with disabled accounts cannot request any operation **/
      sendResponse(conn, code.forbidden, 'Your account is disabled.');
      return;
    }

    if (userRecord.customClaims) {
      conn.requester.customClaims = userRecord.customClaims;
    }

    conn.requester.phoneNumber = userRecord.phoneNumber;

    verifyUidAndPhoneNumberCombination(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Verifies the `id-token` form the Authorization header in the request.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const checkAuthorizationToken = (conn) => {
  const authorization = conn.req.headers.authorization;

  if (typeof authorization !== 'string') {
    sendResponse(
      conn,
      code.unauthorized,
      'The authorization header is not valid.'
    );

    return;
  }

  if (!authorization.startsWith('Bearer ')) {
    sendResponse(
      conn,
      code.unauthorized,
      'Authorization type is not "Bearer".'
    );

    return;
  }

  /** checks if the token was revoked recently when set to true */
  const checkRevoked = true;

  verifyIdToken(authorization.split('Bearer ')[1], checkRevoked)
    .then((decodedIdToken) => {
      /** object to identify the requester throughout the flow */
      conn.requester = {};
      conn.requester.uid = decodedIdToken.uid;

      getCreatorsPhoneNumber(conn);
      return;
    }).catch((error) => {
      if (error.code === 'auth/id-token-revoked') {
        sendResponse(
          conn,
          code.unauthorized,
          'The idToken was revoked recently. Please reauthenticate.'
        );
        return;
      }

      if (error.code === 'auth/argument-error') {
        sendResponse(
          conn,
          code.unauthorized,
          'The idToken in the request header is invalid/expired.'
        );
        return;
      }

      console.log(error);
      sendResponse(
        conn,
        code.forbidden,
        'There was an error processing the idToken sent in the request.'
      );
    });
};


/**
 * Handles the routing for the request from the clients.
 *
 * @param {Object} req Express Request object.
 * @param {Object} res Express Response object.
 */
const server = (req, res) => {
  const conn = {
    req,
    res,
  };

  conn.headers = {
    /** preflight headers */
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET, PATCH, PUT',
    'Access-Control-Allow-Headers': 'X-Requested-With, Authorization,' +
      'Content-Type, Accept',
    'Access-Control-Max-Age': 2592000, // 30 days
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS' || req.method === 'HEAD') {
    /** no content to send in response to the  OPTIONS OR GET request */
    sendResponse(conn, code.noContent);
    return;
  }

  /** allowed methods */
  if (['GET', 'POST', 'PATCH', 'PUT'].indexOf(req.method) > -1) {
    checkAuthorizationToken(conn);
    return;
  }

  sendResponse(
    conn,
    code.notImplemented,
    `${req.method} has not been implemented.`
    + 'Please use GET, POST, PATCH, or PUT methods to make your request.'
  );
};


module.exports = server;
