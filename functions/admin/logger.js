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
  sendResponse,
  handleError,
} = require('./utils');

const {
  rootCollections,
} = require('./admin');

const {
  instant,
} = rootCollections;


/**
 * Creates a document in the `/Instant` collection with the
 * timestamp as its `doc-id`.
 *
 * @param {Object} conn Express's Request and Response Object.
 * @param {Object} response Contains Response code and message.
 * @returns {void}
 */
const createInstantLog = (conn, response) => {
  const {
    STATUS_CODES,
  } = require('http');

  /** Some requests don't send any message after completion.
   * Case in point: Update requests. In these cases, the
   * response will remain empty.
   */
  if (!response.message) response.message = '';
  let successful = true;

  if (response.code > 299) {
    successful = false;
  }

  instant
    .doc()
    .set({
      successful,
      requestBody: JSON.stringify(conn.req.body),
      requester: JSON.stringify(conn.requester),
      responseCode: response.code,
      /** @see https://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html */
      responseCodeValue: STATUS_CODES[`${response.code}`],
      responseMessage: response.message,
      resourcesAccessed: response.resourcesAccessed || null,
      url: conn.req.url,
      timestamp: new Date(),
    })
    .then(() => sendResponse(conn, response.code, response.message))
    .catch((error) => handleError(conn, error));
};


module.exports = {
  createInstantLog,
};
