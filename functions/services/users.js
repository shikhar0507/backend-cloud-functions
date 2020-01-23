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
  sendJSON,
  handleError,
  sendResponse,
  getAuth,
} = require('../admin/utils');
const {code} = require('../admin/responses');

const getPhoneNumbers = query => {
  if (typeof query.phoneNumber === 'string') {
    return [query.phoneNumber];
  }

  return query.phoneNumber;
};

const userRecordFilter = userRecord => {
  const {phoneNumber, displayName = '', photoURL = '', email} = userRecord;

  return {phoneNumber, displayName, photoURL, email};
};
const getUsers = async conn => {
  if (conn.req.method !== 'GET') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use GET`,
    );
  }

  if (!conn.req.query.hasOwnProperty('phoneNumber')) {
    return sendResponse(
      conn,
      code.badRequest,
      `Missing query param 'phoneNumbers'`,
    );
  }

  const phoneNumbers = getPhoneNumbers(conn.req.query);

  if (phoneNumbers.length === 0) {
    return sendResponse(
      conn,
      code.badRequest,
      `Missing phone numbers in query param`,
    );
  }

  if (phoneNumbers.length > 10) {
    return sendResponse(
      conn,
      code.badRequest,
      `Phone number list cannot be greater than 10`,
    );
  }

  const userRecords = await Promise.all(phoneNumbers.map(getAuth));
  const users = userRecords.map(userRecordFilter);

  return sendJSON(conn, {users});
};

module.exports = async conn => {
  try {
    return getUsers(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
