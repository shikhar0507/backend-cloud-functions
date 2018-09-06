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

const { code, } = require('../../admin/responses');
const { httpsActions, } = require('../../admin/constants');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');
const {
  db,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');
const {
  isValidRequestBody,
  checkActivityAndAssignee,
} = require('./helper');


const getPhoneNumbersFromAttachment = (attachment) => {
  const phoneNumbersSet = new Set();

  Object.keys(attachment).forEach((key) => {
    const field = attachment[key];
    const type = field.type;
    const value = field.value;

    if (type !== 'phoneNumber') return;

    phoneNumbersSet.add(value);
  });

  return phoneNumbersSet;
};


const handleResult = (conn, docs) => {
  const [activity, _, removed,] = docs;

  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  if (!removed.exists) {
    sendResponse(
      conn,
      code.conflict,
      `${removed.id} is not an assignee of the activity.`
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
      + ` to remove/change this number from/in the attachment.`
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

  const addendumDocRef = rootCollections
    .offices
    .doc(activity.get('officeId'))
    .collection('Addendum')
    .doc();

  batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
      addendumDocRef,
      timestamp: serverTimestamp,
    }, {
      merge: true,
    });

  batch.set(addendumDocRef, {
    user: conn.requester.phoneNumber,
    remove: conn.req.body.remove,
    action: httpsActions.remove,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: serverTimestamp,
    userDeviceTimestamp: new Date(conn.req.body.timestamp),
    activityId: conn.req.body.activityId,
    activityName: activity.get('activityName'),
    isSupportRequest: conn.requester.isSupportRequest,
  });

  batch.commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleResult(conn, error));
};


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, httpsActions.remove);

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  if (conn.req.body.remove === conn.requester.phoneNumber) {
    sendResponse(
      conn,
      code.forbidden,
      `You cannot unassign yourself from the activity.`
    );

    return;
  }

  const activityRef = rootCollections
    .activities
    .doc(conn.req.body.activityId);

  const assigneesCollectionRef = activityRef.collection('Assignees');

  Promise
    .all([
      activityRef
        .get(),
      assigneesCollectionRef
        .doc(conn.requester.phoneNumber)
        .get(),
      assigneesCollectionRef
        .doc(conn.req.body.remove)
        .get(),
    ])
    .then((docs) => handleResult(conn, docs))
    .catch((error) => handleError(conn, error));
};
