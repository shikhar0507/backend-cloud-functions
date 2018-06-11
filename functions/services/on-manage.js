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
  sendResponse,
} = require('../admin/utils');

const {
  code,
} = require('../admin/responses');

const {
  parse,
} = require('url');

const app = (conn) => {
  if (!conn.requester.customClaims) {
    sendResponse(
      code,
      code.forbidden,
      'You are unauthorized to perform this operation.'
    );
    return;
  }

  const action = parse(conn.req.url).path.split('/')[3];

  if (action === 'permissions') {
    if (conn.req.method !== 'PUT') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${conn.req.method} is not allowed for /${action}`
        + ' endpoint. Use PUT.'
      );
      return;
    }

    const onPermissions = require('./manage/on-permissions');
    onPermissions(conn);
    return;
  }

  sendResponse(
    conn,
    code.notImplemented,
    'This request path is invalid for /manage.'
  );
};


module.exports = app;
