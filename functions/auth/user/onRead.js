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
  sendResponse,
} = require('../../admin/utils');

const {
  getUserByPhoneNumber,
} = users;


/**
 * Fetches the userRecords for all the phone numbers from the request param.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 */
const app = (conn) => {
  const promises = [];

  if (Array.isArray(conn.req.query.q)) {
    conn.req.query.q.forEach((val) =>
      promises.push(getUserByPhoneNumber(val)));
  } else {
    promises.push(getUserByPhoneNumber(conn.req.query.q));
  }

  Promise.all(promises).then((userRecords) => {
    sendResponse(conn, 200, userRecords);
    return;
  }).catch((error) => handleError(conn, error));
};


module.exports = app;
