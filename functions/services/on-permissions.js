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


const { users, } = require('../admin/admin');

const { code, } = require('../admin/responses');

const { rootCollections, } = require('../admin/admin');

const { reportingActions, } = require('../admin/constants');

const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
  hasSuperUserClaims,
} = require('../admin/utils');



/**
 *  Sets `customClaims` for the user who's `phoneNumber` has been sent in the
 * request.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @param {Object} user Contains data from Auth of the user.
 * @param {Object} claims Custom claims object for the userRecord.
 * @returns {void}
 */
const setClaims = (conn, user, claims) => {
  const subject = `Custom Claims granted by the superUser`;

  const messageBody = `
  The superUser ${conn.requester.phoneNumber} has granted the following
  permission to the user: ${conn.req.body.phoneNumber}

  <pre>
    ${JSON.stringify(claims, ' ', 2)}
  </pre>
  `;

  Promise
    .all([
      rootCollections
        .instant
        .doc().set({
          action: reportingActions.usedCustomClaims,
          messageBody,
          subject,
        }),
      users
        .setCustomUserClaims(user.uid, claims),
    ])
    .then(() => sendResponse(conn, code.ok, `Permissions Granted: ${claims}`))
    .catch((error) => handleError(conn, error));
};


/**
 * Creates the `customClaims` object to set in the auth for `user`
 * from the request body.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @param {Object} user Contains the `userRecord`.
 * @returns {void}
 */
const createClaimsObject = (conn, user) => {
  const claims = {};

  if (conn.req.body.support) {
    claims.support = conn.req.body.support;
  }

  if (conn.req.body.manageTemplates) {
    claims.manageTemplates = conn.req.body.manageTemplates;
  }

  setClaims(conn, user, claims);
};


/**
 * Reads the user from `Auth` to verify if they already exist and have
 * some permission allocated.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {void}
 */
const fetchUserRecord = (conn) => {
  users
    .getUserByPhoneNumber(conn.req.body.phoneNumber)
    .then((userRecord) => {
      const user = userRecord[conn.req.body.phoneNumber];

      if (!user.uid) {
        sendResponse(
          conn,
          code.conflict,
          `${conn.req.body.phoneNumber} does not exist.`
        );

        return;
      }

      createClaimsObject(conn, user);

      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Checks if the `request` body is in the correct form.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {void}
 */
const validateRequestBody = (conn) => {
  if (conn.req.body.hasOwnProperty('superUser')) {
    sendResponse(
      conn,
      code.forbidden,
      'Cannot set superUser permission for anyone.'
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('phoneNumber')) {
    sendResponse(
      conn,
      code.badRequest,
      `The phoneNumber field is missing from the request body.`
    );

    return;
  }

  if (!isE164PhoneNumber(conn.req.body.phoneNumber)) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.phoneNumber} is not a valid phone number.`
    );

    return;
  }

  /** A person *can't* change their own permissions. */
  if (conn.requester.phoneNumber === conn.req.body.phoneNumber) {
    sendResponse(conn, code.forbidden, 'You cannot set your own permissions.');

    return;
  }

  /** Both the fields are missing from the request body. */
  if (!conn.req.body.hasOwnProperty('support')
    && !conn.req.body.hasOwnProperty('manageTemplates')) {
    sendResponse(
      conn,
      code.badRequest,
      `The are not valid permissions in the request body.`
    );

    return;
  }

  /** Both the fields are present in the request body. This is not allowed
   * because the user can have only one permission at a time.
   */
  if (conn.req.body.hasOwnProperty('support')
    && conn.req.body.hasOwnProperty('manageTemplates')) {
    sendResponse(
      conn,
      code.forbidden,
      `Granting more than one permission is not allowed for a user.`
    );

    return;
  }

  if (conn.req.body.hasOwnProperty('support')
    && conn.req.body.support !== true) {
    sendResponse(
      conn,
      code.badRequest,
      `The 'support' field should be a boolean value 'true'.`
    );

    return;
  }

  if (conn.req.body.hasOwnProperty('manageTemplates')
    && conn.req.body.manageTemplates !== true) {
    sendResponse(
      conn,
      code.badRequest,
      `The 'manageTemplates' field should be a boolean value 'true'.`
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
module.exports = (conn) => {
  if (!conn.requester.customClaims) {
    sendResponse(
      conn,
      code.forbidden,
      'You are forbidden from accessing this resource.'
    );

    return;
  }

  if (conn.req.method !== 'PUT') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for '/api/services/permissions'`
      + ` endpoint. Use 'PUT'.`
    );

    return;
  }

  if (!hasSuperUserClaims(conn.requester.customClaims)) {
    sendResponse(
      conn,
      code.forbidden,
      `You are not allowed to grant permissions.`
    );

    return;
  }

  validateRequestBody(conn);
};
