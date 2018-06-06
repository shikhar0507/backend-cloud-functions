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


const setClaims = (conn, userRecord) => {
  const permissions = {};

  if (typeof conn.req.body.permissions.support === 'boolean') {
    permissions.support = conn.req.body.permissions.support;
  }

  if (typeof conn.req.body.permissions.manageTemplates === 'boolean') {
    permissions.manageTemplates = conn.req.body.permissions.manageTemplates;
  }

  /** Both keys are not present in the request body. Skip giving
   * the permissions.
   * */
  if (Object.keys(permissions).length < 1) {
    sendResponse(
      conn,
      code.badRequest,
      'The "permissions" object in the request body is invalid.'
    );
    return;
  }

  setCustomUserClaims(userRecord.uid, permissions).then(() => {
    sendResponse(
      conn,
      code.ok,
      `Updated permissions for ${conn.req.body.phoneNumber} successfully.`
    );
    return;
  }).catch((error) => handleError(conn, error));
};


const getUserRecordFromPhoneNumber = (conn) => {
  getUserByPhoneNumber(conn.req.body.phoneNumber).then((userRecord) => {
    if (!userRecord[conn.req.body.phoneNumber].uid) {
      sendResponse(
        conn,
        code.badRequest,
        `No user with phone number ${conn.req.body.phoneNumber} exists.`);
      return;
    }

    setClaims(conn, {
      uid: userRecord[conn.req.body.phoneNumber].uid,
    });
    return;
  }).catch((error) => handleError(conn, error));
};


const validateRequestBody = (conn) => {
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
      'You cannot change your own permissions.'
    );
    return;
  }

  if (!conn.req.body.permissions) {
    sendResponse(
      conn,
      code.badRequest,
      'The "permisssions" object is missing from the request body.'
    );
    return;
  }

  /** The only object we need here is {...}. Anything else like an `Array`
   * is should is not allowed.
   */
  if (Object.prototype.toString
    .call(conn.req.body.permissions) !== '[object Object]') {
    sendResponse(
      conn,
      code.badRequest,
      'The "permissions" object in request body is invalid.'
    );
    return;
  }

  getUserRecordFromPhoneNumber(conn);
};


const app = (conn) => {
  if (!conn.requester.customClaims.superUser) {
    sendResponse(
      conn,
      code.forbidden,
      'You are unauthorized from changing permissions.'
    );
    return;
  }

  validateRequestBody(conn);
};


module.exports = app;
