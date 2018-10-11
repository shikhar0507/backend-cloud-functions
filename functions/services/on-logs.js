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
  rootCollections,
  db,
} = require('../admin/admin');

const {
  sendResponse,
  handleError,
  isNonEmptyString,
} = require('../admin/utils');

const {
  code,
} = require('../admin/responses');

const {
  reportingActions,
} = require('../admin/constants');


module.exports = (conn) => {
  if (conn.req.method !== 'POST') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for ${conn.req.url}. Use 'POST'.`
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('message')) {
    sendResponse(
      conn,
      code.badRequest,
      'The request body is missing the message object.'
    );

    return;
  }

  if (!isNonEmptyString(conn.req.body.message)) {
    sendResponse(
      conn,
      code.badRequest,
      'The message object in the request body should be of type string.'
    );

    return;
  }

  rootCollections
    .updates
    .doc(conn.requester.uid)
    .get()
    .then((doc) => {
      const batch = db.batch();
      const docRef = rootCollections.instant.doc();
      const body = conn.req.body;
      body.requester = conn.requester;
      /** This field isn't required since it has lots of extra data. */
      delete body.requester.employeeOf;
      body.url = conn.req.url;
      body.updatesDoc = doc.data();
      batch.set(docRef, {
        messageBody: JSON.stringify(conn.req.body, ' ', 2),
        subject: 'A new error showed up in the Growthfile Frontend.',
        action: reportingActions.clientError,
      });

      return batch.commit();
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};
