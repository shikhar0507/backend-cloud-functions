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

const { sendResponse, getISO8601Date } = require('../../admin/utils');
const { db, rootCollections } = require('../../admin/admin');
const { code } = require('../../admin/responses');

const validator = ({
  bankAccount,
  ifsc,
  address1,
  email,
  upi,
  displayName,
}) => {
  if (!(bankAccount && bankAccount !== '')) {
    return 'bankAccount cannot be empty';
  }
  if (!(ifsc && ifsc !== '')) {
    return 'ifsc cannot be empty';
  }
  if (!(address1 && address1 !== '')) {
    return 'address1 cannot be empty';
  }
  if (!(email && email !== '')) {
    return 'email cannot be empty';
  }
  if (!(upi && upi !== '')) {
    return 'upi cannot be empty';
  }
  if (!(displayName && displayName !== '')) {
    return 'displayName cannot be empty';
  }
  return false;
};

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
      `${conn.req.method} is not allowed for the /profile/linkedAccount endpoint.`,
    );
  }

  const validationResult = validator(conn.req.body);
  if (validationResult) {
    return sendResponse(conn, code.badRequest, validationResult);
  }

  const {
    bankAccount,
    ifsc,
    address1,
    email,
    upi,
    displayName,
  } = conn.req.body;
  displayName.toString();

  const batch = db.batch();
  const [updateDoc, timerDoc] = await Promise.all([
    rootCollections.updates.doc(conn.requester.uid).get(),
    rootCollections.timers.doc(getISO8601Date()).get(),
  ]);

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

  batch.set(
    updateDoc.ref,
    {
      linkedAccount: [
        {
          bankAccount,
          ifsc,
          address1,
          email,
          upi,
        },
      ],
    },
    { merge: true },
  );

  await batch.commit();
  return sendResponse(conn, code.ok, 'Updated Acquisitions');
};
