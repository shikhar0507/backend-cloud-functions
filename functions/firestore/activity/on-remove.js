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

const {
  isValidRequestBody,
  getPhoneNumbersFromAttachment,
} = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const handleResult = (conn, result) => {
  const profileActivity = result[0];
  const activity = result[1];
  const assignees = result[2];

  if (!conn.requester.isSupportRequest) {
    if (!profileActivity.exists) {
      sendResponse(
        conn,
        code.notFound,
        `No activity found with the id: '${conn.req.body.activityId}'.`
      );

      return;
    }

    if (!profileActivity.get('canEdit')) {
      /** The `canEdit` flag is false so update is forbidden. */
      sendResponse(
        conn,
        code.forbidden,
        'You do not have the permission to edit this activity.'
      );

      return;
    }
  }

  if (assignees.size === 1) {
    sendResponse(
      conn,
      code.conflict,
      `Cannot remove an assignee from an activity with only one assignee.`
    );

    return;
  }

  let found = false;

  assignees.forEach((doc) => {
    const phoneNumber = doc.id;

    if (phoneNumber !== conn.req.body.remove) return;

    found = true;
  });

  if (!found) {
    sendResponse(
      conn,
      code.conflict,
      `No assignee found with the phone number: '${conn.req.body.remove}'.`
    );

    return;
  }



  const attachment = activity.get('attachment');

  if (getPhoneNumbersFromAttachment(attachment)
    .has(conn.req.body.remove)
  ) {
    sendResponse(
      conn,
      code.forbidden,
      `Cannot remove the phone number: '${conn.req.body.remove}'`
      + `from the activity. Please use the '/update' endpoint`
      + ` to remove this number from the attachment.`
    );

    return;
  }

  const batch = db.batch();

  batch.delete(rootCollections
    .activities
    .doc(conn.req.body.activityId)
    .collection('Assignees')
    .doc(conn.req.body.remove)
  );

  batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
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
      remove: conn.req.body.remove,
      action: 'remove',
      status: null,
      comment: null,
      template: null,
      location: getGeopointObject(conn.req.body.geopoint),
      timestamp: serverTimestamp,
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      activityId: conn.req.body.activityId,
      activityName: activity.get('activityName'),
      updatedFields: null,
      updatedPhoneNumber: null,
      isSupportRequest: conn.requester.isSupport,
    });

  batch.commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleResult(conn, error));
};


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'remove');

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
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};
