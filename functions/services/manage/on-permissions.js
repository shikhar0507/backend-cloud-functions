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
  users,
} = require('../../admin/admin');

const {
  sendResponse,
  handleError,
} = require('../../admin/utils');

const {
  isValidPhoneNumber,
} = require('../../firestore/activity/helper');

const {
  code,
} = require('../../admin/responses');

const {
  setCustomUserClaims,
  getUserByPhoneNumber,
} = users;


/**
 *  Sets customClaims for the user who's phoneNumber has been sent in the
 * request.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @param {Object} user Contains data from Auth of the user.
 */
const setClaims = (conn, user) => {
  const claims = {};

  if (conn.req.body.suport) {
    claims.support = conn.req.body.support;
  }

  if (conn.req.body.manageTemplates) {
    claims.manageTemplates = conn.req.body.manageTemplates;
  }

  setCustomUserClaims(user.uid, claims).then(() => {
    sendResponse(
      conn,
      code.noContent
    );
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Reads the user from Auth to verify if they already exist and have
 * some permission allocated.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 */
const fetchUserRecord = (conn) => {
  getUserByPhoneNumber(conn.req.body.phoneNumber).then((userRecord) => {
    const user = userRecord[conn.req.body.phoneNumber];

    if (!user.uid) {
      sendResponse(
        conn,
        code.conflict,
        `${conn.req.body.phoneNumber} does not exist.`
      );
      return;
    }

    if (!user.customClaims) {
      setClaims(conn, user);
      return;
    }

    if (user.customClaims.support || user.customClaims.manageTemplates) {
      sendResponse(
        conn,
        code.conflict,
        `${conn.req.body.phoneNumber} already has the following permissions:`
        + ` ${JSON.stringify(user.customClaims)}`
      );
      return;
    }

    setClaims(conn, user);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Checks of the `request` body is in the correct form.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 */
const validateRequestBody = (conn) => {
  if (!conn.req.body.phoneNumber) {
    sendResponse(
      conn,
      code.badRequest,
      'The phoneNumber field is missing from the request body.'
    );
    return;
  }

  if (!isValidPhoneNumber(conn.req.body.phoneNumber)) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.phoneNumber} is not a valid phone number.`
    );
    return;
  }

  if (conn.requester.phoneNumber === conn.req.body.phoneNumber) {
    sendResponse(
      conn,
      code.forbidden,
      'You cannot set your own permissions'
    );
    return;
  }

  if (!conn.req.body.support && !conn.req.body.manageTemplates) {
    /** Both fields can't be skipped together.
     */
    sendResponse(
      conn,
      code.badRequest,
      'There are no valid fields in the request body.'
    );
    return;
  }

  if (conn.req.body.support && conn.req.body.manageTemplates) {
    /** Only one permission can be set at a time. */
    sendResponse(
      conn,
      code.forbidden,
      'Granting more than one permission is not allowed for a single user.'
    );
    return;
  }

  if (conn.req.body.support && typeof conn.req.body.support !== 'boolean') {
    sendResponse(
      conn,
      code.badRequest,
      'The \'support\' field should be a boolean.'
    );
    return;
  }

  if (conn.req.body.manageTemplates
    && typeof conn.req.body.manageTemplates !== 'boolean') {
    sendResponse(
      conn,
      code.badRequest,
      'The \'manageTemplates\' field should be a boolean.'
    );
    return;
  }

  fetchUserRecord(conn);
};


/**
 * Checks if the requester is a `superUser`.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 */
const app = (conn) => {
  if (!conn.requester.customClaims.superUser) {
    sendResponse(
      conn,
      code.forbidden,
      'You are unauthorized from setting up permissions.'
    );
    return;
  }

  validateRequestBody(conn);
};


module.exports = app;
