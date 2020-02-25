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

const { users, auth } = require('../admin/admin');
const { code } = require('../admin/responses');
const { rootCollections } = require('../admin/admin');
const { reportingActions } = require('../admin/constants');
const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
  hasSuperUserClaims,
} = require('../admin/utils');

const action = reportingActions.usedCustomClaims;

const getClaimsObject = body => {
  const claims = {};

  if (body.support) {
    claims.support = body.support;
  }

  if (body.manageTemplates) {
    claims.manageTemplates = body.manageTemplates;
  }

  return claims;
};

const getFailureMessageObject = (conn, action, responseCode) => {
  let success = true;

  if (responseCode > 300) success = false;

  const subject =
    `${conn.requester.displayName || conn.requester.phoneNumber}` +
    ` just accessed the API: ${conn.req.url}`;

  const messageBody = `
    <strong>Display Name</strong>: ${conn.requester.displayName || 'NOT SET'}
    <br>
    <strong>Phone Number</strong>: ${conn.requester.phoneNumber}
    <br>
    <strong>URL</strong></strong>: ${conn.req.url}
    <br>
    <strong>Successful<strong>: ${success}
    <br>
    <strong>Action</strong>: ${action}
    <br>

    <H3>Request Body<h3>

    <pre style="font-size: 20px;
    border: 2px solid grey;
    width: 450px;
    border-left: 12px solid green;
    border-radius: 5px;
    font-family: monaco;
    padding: 14px;">
${JSON.stringify(conn.req.body, ' ', 2)}
    </pre>
  `;

  return { subject, messageBody, action };
};

const logFailedRequest = (conn, responseCode, message, action) => {
  rootCollections.instant
    .doc()
    .set(getFailureMessageObject(conn, action, responseCode))
    .then(() => sendResponse(conn, responseCode, message))
    .catch(error => handleError(conn, error));
};

/**
 *  Sets `customClaims` for the user who's `phoneNumber` has been sent in the
 * request.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @param {string} uid UID from Firebase auth.
 * @param {Object} claims Custom claims object for the userRecord.
 * @returns {void}
 */
const setClaims = (conn, uid) => {
  const claims = getClaimsObject(conn.req.body);
  const subject = `Custom Claims granted by the superUser`;

  const messageBody = `
  The superUser ${conn.requester.phoneNumber} has granted the following
  permission to the user: ${conn.req.body.phoneNumber}

  <pre>
  ${JSON.stringify(claims, ' ', 2)}
  </pre>
  `;

  Promise.all([
    rootCollections.instant.doc().set({ action, messageBody, subject }),
    auth.setCustomUserClaims(uid, claims),
  ])
    .then(() =>
      sendResponse(
        conn,
        code.ok,
        `Permissions Granted: ${JSON.stringify(claims, ' ', 2)}`,
      ),
    )
    .catch(error => handleError(conn, error));
};

/**
 * Reads the user from `Auth` to verify if they already exist and have
 * some permission allocated.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {void}
 */
const fetchUserRecord = conn => {
  users
    .getUserByPhoneNumber(conn.req.body.phoneNumber)
    .then(userRecord => {
      const user = userRecord[conn.req.body.phoneNumber];
      const uid = user.uid;

      if (!uid) {
        logFailedRequest(
          conn,
          code.conflict,
          `${conn.req.body.phoneNumber} does not exist.`,
          action,
        );

        return;
      }

      setClaims(conn, uid);

      return;
    })
    .catch(error => handleError(conn, error));
};

/**
 * Checks if the `request` body is in the correct form.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {void}
 */
const validateRequestBody = conn => {
  if (conn.req.body.hasOwnProperty('superUser')) {
    logFailedRequest(
      conn,
      code.forbidden,
      'Cannot set superUser permission for anyone',
      action,
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('phoneNumber')) {
    logFailedRequest(
      conn,
      code.badRequest,
      `The phoneNumber field is missing from the request body`,
      action,
    );

    return;
  }

  if (!isE164PhoneNumber(conn.req.body.phoneNumber)) {
    logFailedRequest(
      conn,
      code.badRequest,
      `${conn.req.body.phoneNumber} is not a valid phone number.`,
      action,
    );

    return;
  }

  /** A person *can't* change their own permissions. */
  if (conn.requester.phoneNumber === conn.req.body.phoneNumber) {
    logFailedRequest(
      conn,
      code.forbidden,
      'You cannot set your own permissions',
      action,
    );

    return;
  }

  /** Both the fields are missing from the request body. */
  if (
    !conn.req.body.hasOwnProperty('support') &&
    !conn.req.body.hasOwnProperty('manageTemplates')
  ) {
    logFailedRequest(
      conn,
      code.badRequest,
      `No valid permission object found in the request body`,
      action,
    );

    return;
  }

  /** Both the fields are present in the request body. This is not allowed
   * because the user can have only one permission at a time.
   */
  if (
    conn.req.body.hasOwnProperty('support') &&
    conn.req.body.hasOwnProperty('manageTemplates')
  ) {
    logFailedRequest(
      conn,
      code.forbidden,
      `Granting more than one permission is not allowed for a user`,
      action,
    );

    return;
  }

  if (
    conn.req.body.hasOwnProperty('support') &&
    conn.req.body.support !== true
  ) {
    logFailedRequest(
      conn,
      code.badRequest,
      `The 'support' field should be a boolean value 'true'`,
      action,
    );

    return;
  }

  if (
    conn.req.body.hasOwnProperty('manageTemplates') &&
    conn.req.body.manageTemplates !== true
  ) {
    logFailedRequest(
      conn,
      code.badRequest,
      `The 'manageTemplates' field should be a boolean value 'true'`,
      action,
    );

    return;
  }

  fetchUserRecord(conn);
};

/**
 * Checks if the `requester` is a `superUser`.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {void}
 */
module.exports = conn => {
  if (conn.req.method !== 'PUT') {
    logFailedRequest(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for '/api/services/permissions'` +
        ` endpoint. Use 'PUT'`,
      action,
    );

    return;
  }

  if (!hasSuperUserClaims(conn.requester.customClaims)) {
    logFailedRequest(
      conn,
      code.forbidden,
      `You are not allowed to grant permissions`,
      action,
    );

    return;
  }

  validateRequestBody(conn);
};
