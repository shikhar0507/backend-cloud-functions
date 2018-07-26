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


const { sendResponse, } = require('../admin/utils');

const { code, } = require('../admin/responses');


/**
 * Calls the resource related to a service depending on the action
 * from the `URL`.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
module.exports = (conn) => {
  const action = require('url').parse(conn.req.url).path.split('/')[2];

  if (action === 'users') {
    const onUsers = require('../services/on-users');
    onUsers(conn);

    return;
  }

  if (action === 'permissions') {
    const onPermissions = require('../services/on-permissions');
    onPermissions(conn);

    return;
  }

  if (action === 'templates') {
    const onTemplates = require('../services/on-templates');
    onTemplates(conn);

    return;
  }

  sendResponse(
    conn,
    code.notFound,
    `No resource found at the path: ${(conn.req.url)}.`
  );
};
