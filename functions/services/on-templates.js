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


const { sendResponse, hasManageTemplateClaims, } = require('../admin/utils');

const { code, } = require('../admin/responses');


module.exports = (conn) => {
  if (!hasManageTemplateClaims(conn.requester.customClaims)) {
    sendResponse(
      conn,
      code.forbidden,
      'You do not have permission to access /manageTemplates.'
    );

    return;
  }

  const action = require('url').parse(conn.req.url).path.split('/')[3];

  if (action === 'create') {
    if (conn.req.method !== 'POST') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${conn.req.method} is not allowed for /create. Use POST.`
      );

      return;
    }

    const onCreate = require('../firestore/activity-templates/on-create');
    onCreate(conn);

    return;
  }

  if (action === 'update') {
    if (conn.req.method !== 'PUT') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${conn.req.method} is not allowed for /update. Use PUT.`
      );

      return;
    }

    const onUpdate = require('../firestore/activity-templates/on-update');
    onUpdate(conn);

    return;
  }

  if (action.startsWith('read')) {
    if (conn.req.method !== 'GET') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${conn.req.method} is not allowed for /read. Use GET.`
      );

      return;
    }

    const onRead = require('../firestore/activity-templates/on-read');
    onRead(conn);

    return;
  }

  sendResponse(
    conn,
    code.notFound,
    `No resource found at the path: ${(conn.req.url)}.`
  );
};
