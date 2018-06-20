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
  handleError,
} = require('../../admin/utils');

const {
  isValidPhoneNumber,
} = require('../../firestore/activity/helper');

const {
  code,
} = require('../../admin/responses');

const {
  createInstantLog,
} = require('../../admin/logger');


/**
 *  Sets `customClaims` for the user who's `phoneNumber` has been sent in the
 * request.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @param {Object} user Contains data from Auth of the user.
 * @param {Object} claims Custom claims object for the userRecord.
 * @param {Object} response Object to store the logging data.
 */
const setClaims = (conn, user, claims, response) => {
  users
    .setCustomUserClaims(user.uid, claims)
    .then(() => {
      response.code = code.noContent;
      createInstantLog(conn, response);
      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Creates the `customClaims` object to set in the auth for `user`
 * from the request body.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @param {Object} user Contains the `userRecord`.
 * @param {Object} response Object to store the logging data.
 */
const createClaimsObject = (conn, user, response) => {
  const claims = {};

  if (conn.req.body.support) {
    claims.support = conn.req.body.support;
  }

  if (conn.req.body.manageTemplates) {
    claims.manageTemplates = conn.req.body.manageTemplates;
  }

  setClaims(conn, user, claims, response);
};


/**
 * Reads the user from `Auth` to verify if they already exist and have
 * some permission allocated.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @param {Object} response Object to store the logging data.
 */
const fetchUserRecord = (conn, response) => {
  users
    .getUserByPhoneNumber(conn.req.body.phoneNumber)
    .then((userRecord) => {
      const user = userRecord[conn.req.body.phoneNumber];

      if (!user.uid) {
        response.code = code.conflict;
        response.message = `${conn.req.body.phoneNumber} does not exist.`;
        response.resourcesAccessed.push('user record');
        createInstantLog(conn, response);
        return;
      }

      createClaimsObject(conn, user, response);
      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Checks if the `request` body is in the correct form.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @param {Object} response Object to store the logging data.
 */
const validateRequestBody = (conn, response) => {
  if (!conn.req.body.hasOwnProperty('phoneNumber')) {
    response.code = code.badRequest;
    response.message = 'The phoneNumber field is missing from the'
      + ' request body.';
    createInstantLog(conn, response);
    return;
  }

  if (!isValidPhoneNumber(conn.req.body.phoneNumber)) {
    response.code = code.badRequest;
    response.message = `${conn.req.body.phoneNumber} is not a valid'
    +' phone number.`;
    createInstantLog(conn, response);
    return;
  }

  /** A person *can't* change their own permissions. */
  if (conn.requester.phoneNumber === conn.req.body.phoneNumber) {
    response.code = code.forbidden;
    response.message = 'You cannot set your own permissions.';
    createInstantLog(conn, response);
    return;
  }

  /** Both the fields are missing from the request body. */
  if (!conn.req.body.hasOwnProperty('support')
    && !conn.req.body.hasOwnProperty('manageTemplates')) {
    response.code = code.badRequest;
    response.message = 'There are no valid "permission"'
      + ' fields in the request body.';
    createInstantLog(conn, response);
    return;
  }

  /** Both the fields are present in the request body. This is not allowed
   * because the user can have only one permission at a time.
   */
  if (conn.req.body.hasOwnProperty('support')
    && conn.req.body.hasOwnProperty('manageTemplates')) {
    response.code = code.forbidden;
    response.message = 'Granting more than one permission'
      + ' is not allowed for a user.';
    createInstantLog(conn, response);
    return;
  }

  if (conn.req.body.hasOwnProperty('support')
    && conn.req.body.support !== true) {
    response.code = code.badRequest;
    response.message = 'The \'support\' field should be a'
      + ' boolean value \'true\'.';
    createInstantLog(conn, response);
    return;
  }

  if (conn.req.body.hasOwnProperty('manageTemplates')
    && conn.req.body.manageTemplates !== true) {
    response.code = code.badRequest;
    response.message = 'The \'manageTemplates\' field should be'
      + ' a boolean value \'true\'.';
    createInstantLog(conn, response);
    return;
  }

  fetchUserRecord(conn, response);
};


/**
 * Checks if the `requester` is a `superUser`.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 */
const app = (conn) => {
  /** Object to store the logging data. */
  const response = {};
  response.resourcesAccessed = [];

  if (!conn.requester.customClaims.superUser) {
    response.code = code.forbidden;
    response.message = 'You are forbidden from granting permissions.';
    createInstantLog(conn, response);
    return;
  }

  validateRequestBody(conn, response);
};


module.exports = app;
