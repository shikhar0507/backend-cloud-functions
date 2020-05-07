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

const { sendResponse, getISO8601Date, sendJSON } = require('../../admin/utils');
const { db, rootCollections } = require('../../admin/admin');
const { code } = require('../../admin/responses');

/**
 * Returns the server timestamp on a `GET` request.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @returns {void}
 */
module.exports = async conn => {
  if (conn.req.method !== 'PUT') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /profile/fcmToken endpoint.`,
    );
  }
  const { token } = conn.req.body;
  if (!(token && token !== '')) {
    return sendResponse(conn, code.badRequest, 'Token not found');
  }
  const batch = db.batch();
  const [updatesDoc, timerDoc] = await Promise.all([
    rootCollections.updates.doc(conn.requester.uid).get(),
    rootCollections.timers.doc(getISO8601Date()).get(),
  ]);

  /**
   * The `authOnCreate` function executed, when the user signed up, but
   * the `/api` was executed before `authOnCreate` completed. This will result
   * in this function to crash since it assumes that the doc in the `Updates/{uid}`
   * doc exists.
   */
  if (!updatesDoc.exists) {
    return sendJSON(conn, {
      revokeSession: false,
      updateClient: false,
      success: false,
      timestamp: Date.now(),
      code: code.forbidden,
    });
  }

  if (!timerDoc.exists) {
    batch.set(
      timerDoc.ref,
      {
        timestamp: Date.now(),
        // Prevents multiple trigger events for reports.
        sent: false,
      },
      {
        merge: true,
      },
    );
  }

  batch.set(updatesDoc.ref, { registrationToken: token }, { merge: true });

  await batch.commit();
  return sendResponse(conn, code.ok, 'Updated Token');
};
