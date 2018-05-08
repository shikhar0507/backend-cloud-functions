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


const onRead = require('../auth/user/onRead');
const onUpdate = require('../auth/user/onUpdate');

const {
  parse,
} = require('url');

const {
  handleError,
  sendResponse,
} = require('../admin/utils');


/**
 * Handles the requests made to /users resource.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const handleUserProfiles = (conn) => {
  const method = conn.req.method;
  const action = parse(conn.req.url).path.split('/')[3];

  if (action.startsWith('read')) {
    if (method !== 'GET') {
      sendResponse(conn, 405, 'METHOD NOT ALLOWED');
      return;
    }

    onRead(conn);
    return;
  }

  if (action === 'update') {
    if (method !== 'PATCH') {
      sendResponse(conn, 405, 'METHOD NOT ALLOWED');
      return;
    }

    onUpdate(conn);
    return;
  }

  sendResponse(conn, 400, 'BAD REQUEST');
};


/**
 * Calls the resource related to a service depending on the action
 * from the url.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const servicesHandler = (conn) => {
  const action = parse(conn.req.url).path.split('/')[2];

  if (action === 'users') {
    handleUserProfiles(conn);
    return;
  }

  sendResponse(conn, 400, 'BAD REQUEST');
};

module.exports = servicesHandler;
