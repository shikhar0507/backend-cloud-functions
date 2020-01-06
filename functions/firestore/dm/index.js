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

const {rootCollections, db} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
  isValidGeopoint,
  isNonEmptyString,
  isE164PhoneNumber,
  isValidDate,
} = require('../../admin/utils');
const {code} = require('../../admin/responses');
const admin = require('firebase-admin');

module.exports = conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'POST'`,
    );
  }

  if (!isNonEmptyString(conn.req.body.comment)) {
    return sendResponse(
      conn,
      code.badRequest,
      `The field 'comment' should be a non-empty string`,
    );
  }

  if (!isValidDate(conn.req.body.timestamp)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Invalid/Missing timestamp found in the request body`,
    );
  }

  if (!isValidGeopoint(conn.req.body.geopoint)) {
    return sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.geopoint} is invalid`,
    );
  }

  if (!isE164PhoneNumber(conn.req.body.assignee)) {
    return sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.assignee} is invalid`,
    );
  }

  let failed = false;

  return rootCollections.updates
    .where('phoneNumber', '==', conn.req.body.assignee)
    .limit(1)
    .get()
    .then(snapShot => {
      failed = snapShot.empty;

      if (failed) {
        return sendResponse(
          conn,
          code.conflict,
          `User: '${conn.req.body.assignee}' not found`,
        );
      }

      const batch = db.batch();

      const doc = {
        timestamp: conn.req.body.timestamp,
        user: conn.requester.phoneNumber,
        isComment: 1,
        assignee: conn.req.body.assignee,
        comment: conn.req.body.comment,
        geopoint: new admin.firestore.GeoPoint(
          conn.req.body.geopoint.latitude,
          conn.req.body.geopoint.longitude,
        ),
      };

      batch.set(snapShot.docs[0].ref.collection('Addendum').doc(), doc);

      batch.set(
        rootCollections.updates
          .doc(conn.requester.uid)
          .collection('Addendum')
          .doc(),
        doc,
      );

      return batch.commit();
    })
    .then(() => {
      if (failed) {
        return Promise.resolve();
      }

      return sendResponse(conn, code.created);
    })
    .catch(error => handleError(conn, error));
};
