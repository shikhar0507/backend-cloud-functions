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


const { code, } = require('../admin/responses');
const {
  isValidDate,
  sendResponse,
  hasAdminClaims,
} = require('../admin/utils');


const handleAction = (conn, action) => {
  if (!hasAdminClaims(conn.requester.customClaims)) {
    sendResponse(
      conn,
      code.forbidden,
      'You are not allowed to access this resource.'
    );

    return;
  }

  if (action.startsWith('read')) {
    if (!conn.req.query.hasOwnProperty('from')) {
      sendResponse(
        conn,
        code.badRequest,
        `The request URL is missing the 'from' query parameter.`
      );

      return;
    }

    if (!isValidDate(conn.req.query.from)) {
      sendResponse(
        conn,
        code.badRequest,
        `The value in the 'from' query parameter is not a valid unix timestamp.`
      );

      return;
    }

    const onRead = require('../firestore/offices/on-read');
    onRead(conn);

    return;
  }

  sendResponse(conn, code.badRequest, 'No resource found at this URL');
};


module.exports = (conn) => {
  const action = require('url').parse(conn.req.url).path.split('/')[2];

  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'GET' for /read`
    );

    return;
  }

  if (action.startsWith('read')) {
    handleAction(conn, action);

    return;
  }

  sendResponse(conn, code.notImplemented, 'No resource found at this path.');
};
