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

const {
  code,
} = require('./responses');

const {
  rootCollections,
  disableUser,
} = require('./admin');

const {
  profiles,
  dailyDisabled,
} = rootCollections;


/**
 * Ends the response by sending the `JSON` to the client with `200 OK` response.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} json The response object to send to the client.
 * @returns {void}
 */
const sendJSON = (conn, json) => {
  conn.res.writeHead(code.ok, conn.headers);
  conn.res.end(JSON.stringify(json));
};


/**
 * Ends the response of the request after successful completion of the task
 * or on an error.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 * @param {number} statusCode A standard HTTP status code.
 * @param {string} [message] Response message for the request.
 * @returns {void}
 *
 */
const sendResponse = (conn, statusCode, message = '') => {
  let success = true;

  /** 2xx codes denote success. */
  if (!statusCode.toString().startsWith('2')) success = false;

  conn.res.writeHead(statusCode, conn.headers);

  conn.res.end(JSON.stringify({
    success,
    message,
    code: statusCode,
  }));
};


/**
 * Ends the response when there is an error while handling the request.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 * @param {Object} error Firebase Error object.
 * @returns {void}
 */
const handleError = (conn, error) => {
  console.log(error);

  sendResponse(
    conn,
    code.internalServerError,
    'There was an error handling the request. Please try again later.'
  );
};


/**
 * Disables the user account in auth based on uid and writes the reason to
 * the document in the profiles collection for which the account was disabled.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {string} reason For which the account is being disabled.
 * @returns {void}
 */
const disableAccount = (conn, reason) => {
  const promises = [
    dailyDisabled
      .doc(new Date().toDateString())
      .set({
        [conn.requester.phoneNumber]: {
          reason,
          timestamp: new Date(),
        },
      }, {
          /** This doc may have other fields too. */
          merge: true,
        }),
    profiles
      .doc(conn.requester.phoneNumber)
      .set({
        disabledFor: reason,
        disabledTimestamp: new Date(),
      }, {
          /** This doc may have other fields too. */
          merge: true,
        }),
    disableUser(conn.requester.uid),
  ];

  Promise.all(promises).then(() => {
    sendResponse(
      conn,
      code.forbidden,
      'There was some trouble parsing your request. Please contact support.'
    );

    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Helper function to check `support` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `support` claims.
 */
const hasSupportClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be undefined or a boolean, so an explicit
   * check is used.
   */
  return customClaims.support === true;
};


/**
 * Helper function to check `manageTemplates` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `ManageTemplate` claims.
 */
const hasManageTemplateClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be undefined or a boolean, so an explicit
   * check is used.
   */
  return customClaims.manageTemplates === true;
};


/**
 * Helper function to check `superUser` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `superUser` claims.
 */
const hasSuperUserClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be `undefined` or a `boolean`, so an explicit
   * check is used.
   */
  return customClaims.superUser === true;
};


/**
 * Returns the server timestamp on a `GET` request.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 * @returns {void}
 */
const now = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /now endpoint.`
    );

    return;
  }

  /** Ends response. */
  sendJSON(conn, {
    success: true,
    timestamp: Date.now(),
    code: code.ok,
  });
};


module.exports = {
  hasSupportClaims,
  hasSuperUserClaims,
  hasManageTemplateClaims,
  disableAccount,
  sendResponse,
  handleError,
  sendJSON,
  now,
};
