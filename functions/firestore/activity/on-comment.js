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
  getGeopointObject,
  db,
  serverTimestamp,
} = require('../../admin/admin');

const { isValidRequestBody, } = require('./helper');

const { code, } = require('../../admin/responses');

const { httpsActions, } = require('../../admin/constants');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const createDocs = (conn, activity) => {
  const batch = db.batch();

  batch.set(rootCollections
    .offices
    .doc(activity.get('officeId'))
    .collection('Addendum')
    .doc(), {
      user: conn.requester.phoneNumber,
      share: null,
      remove: null,
      action: httpsActions.comment,
      status: null,
      comment: conn.req.body.comment,
      template: null,
      location: getGeopointObject(conn.req.body.geopoint),
      timestamp: serverTimestamp,
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      activityId: conn.req.body.activityId,
      activityName: null,
      updatedFields: null,
      updatedPhoneNumber: null,
      isSupportRequest: conn.requester.isSupportRequest,
    });

  batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'comment');

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  Promise
    .all([
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Activities')
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
    ])
    .then((result) => {
      const profileActivityDoc = result[1];

      if (!profileActivityDoc.exists) {
        sendResponse(
          conn,
          code.badRequest,
          `No activity found with the id: '${conn.req.body.activityId}'.`
        );

        return;
      }

      const activity = result[1];

      createDocs(conn, activity);

      return;
    })
    .catch((error) => handleError(conn, error));
};
