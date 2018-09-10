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


const { isValidRequestBody, checkActivityAndAssignee, } = require('./helper');
const { code, } = require('../../admin/responses');
const { httpsActions, } = require('../../admin/constants');
const {
  db,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const createDocs = (conn, activity) => {
  const batch = db.batch();

  const addendumDocRef = rootCollections
    .offices
    .doc(activity.get('officeId'))
    .collection('Addendum')
    .doc();

  batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
      addendumDocRef,
      status: conn.req.body.status,
      timestamp: serverTimestamp,
    }, {
      merge: true,
    });

  batch.set(addendumDocRef, {
    user: conn.requester.phoneNumber,
    action: httpsActions.changeStatus,
    status: conn.req.body.status,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: serverTimestamp,
    userDeviceTimestamp: new Date(conn.req.body.timestamp),
    activityId: conn.req.body.activityId,
    activityName: activity.get('activityName'),
    isSupportRequest: conn.requester.isSupportRequest,
  });

  batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};

const handleResult = (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  const [activity,] = docs;

  if (activity.get('status') === conn.req.body.status) {
    sendResponse(
      conn,
      code.conflict,
      `The activity status is already '${conn.req.body.status}'.`
    );

    return;
  }

  createDocs(conn, activity);
};


module.exports = (conn) => {
  if (conn.req.method !== 'PATCH') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for /change-status`
      + ' endpoint. Use PATCH.'
    );

    return;
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.changeStatus);

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
        .activities
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(conn.requester.phoneNumber)
        .get(),
    ])
    .then((docs) => handleResult(conn, docs))
    .catch((error) => handleError(conn, error));
};
