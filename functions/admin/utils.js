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


/**
 * Returns the server timestamp on request.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 */
const now = (conn) => sendResponse(conn, 200, new Date());


/**
 * Ends the response of the request after successful completion of the task
 * or on an error.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 * @param {number} statusCode A standard HTTP status code.
 * @param {string} message Response message for the request.
 */
const sendResponse = (conn, statusCode, message) => {
  conn.headers['Content-Type'] = 'application/json';
  conn.res.writeHead(statusCode, conn.headers);

  conn.res.end(JSON.stringify({
    code: statusCode,
    message,
  }));
};


/**
 * Ends the response when there is an error while handling the request.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 * @param {Object} error Firebase Error object.
 */
const handleError = (conn, error) => {
  console.log(error);
  sendResponse(conn, 500, 'INTERNAL SERVER ERROR', error);
};


module.exports = {
  sendResponse,
  handleError,
  now,
};
