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
  db,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');

const { isValidRequestBody, } = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const fetchDocs = (conn) => {
  rootCollections
    .activities
    .doc(conn.req.body.activityId)
    .get()
    .then((activity) => {
      if (!activity.exists) {
        sendResponse(
          conn,
          code.badRequest,
          `No activity found with the id: '${conn.req.body.activityId}'.`
        );

        return;
      }

      if (activity.get('status') === conn.req.body.status) {
        sendResponse(
          conn,
          code.conflict,
          `The activity status is already '${conn.req.body.status}'.`
        );

        return;
      }

      const batch = db.batch();

      batch.set(rootCollections
        .activities
        .doc(conn.req.body.activityId), {
          status: conn.req.body.status,
          timestamp: serverTimestamp,
        }, {
          merge: true,
        });

      batch.set(rootCollections
        .offices
        .doc(activity.get('officeId'))
        .collection('Addendum')
        .doc(), {
          user: conn.requester.phoneNumber,
          share: null,
          remove: null,
          action: 'change-status',
          status: conn.req.body.status,
          comment: null,
          template: null,
          location: getGeopointObject(conn.req.body.geopoint),
          timestamp: serverTimestamp,
          userDeviceTimestamp: new Date(conn.req.body.timestamp),
          activityId: conn.req.body.activityId,
          activityName: activity.get('activityName'),
          updatedFields: null,
          updatedPhoneNumber: null,
          isSupportRequest: conn.requester.isSupportRequest,
        });

      batch.commit();

      return;

    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};

const fetchActivityFromProfile = (conn) => {
  rootCollections
    .profiles
    .doc(conn.requester.phoneNumber)
    .collection('Activities')
    .doc(conn.req.body.activityId)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        /** The activity doesn't exist for the user */
        sendResponse(
          conn,
          code.notFound,
          `No activity found with the id: '${conn.req.body.activityId}'.`
        );

        return;
      }

      if (!doc.get('canEdit')) {
        sendResponse(
          conn,
          code.forbidden,
          'You do not have the permission to edit this activity.'
        );

        return;
      }

      fetchDocs(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};

module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'change-status');

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }


  /** The `support` person doesn't need to be an assignee
   * of the activity to make changes.
   */
  if (conn.requester.isSupportRequest) {
    fetchDocs(conn);

    return;
  }

  fetchActivityFromProfile(conn);
};
