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
  isValidRequestBody,
  checkActivityAndAssignee,
  setOnLeaveOrAr,
  cancelLeaveOrDuty,
} = require('./helper');
const { code } = require('../../admin/responses');
const {
  httpsActions,
} = require('../../admin/constants');
const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const handleLeaveAndOnDuty = (conn, activityDoc) => {
  const hasBeenCancelled = activityDoc.get('status') !== 'CANCELLED'
    && conn.req.body.status === 'CANCELLED';
  const isLeaveOrAr = new Set(['leave', 'attendance regularization'])
    .has(activityDoc.get('template'));

  if (!isLeaveOrAr) {
    return Promise.resolve({});
  }

  const schedule = activityDoc.get('schedule')[0];
  const startTime = schedule.startTime;
  const endTime = schedule.endTime;
  const template = activityDoc.get('template');
  const officeId = activityDoc.get('officeId');
  const creator = activityDoc.get('creator');
  const phoneNumber = (() => {
    if (typeof creator === 'string') {
      return creator;
    }

    return creator.phoneNumber;
  })();

  if (hasBeenCancelled) {
    return cancelLeaveOrDuty({
      phoneNumber,
      officeId,
      startTime,
      endTime,
      template
    });
  } else {
    return setOnLeaveOrAr({
      phoneNumber,
      officeId,
      startTime,
      endTime,
      template
    });
  }
};


const createDocs = (conn, activityDoc) => {
  const batch = db.batch();
  const addendumDocRef = rootCollections
    .offices
    .doc(activityDoc.get('officeId'))
    .collection('Addendum')
    .doc();

  batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
    addendumDocRef,
    status: conn.req.body.status,
    timestamp: Date.now(),
  }, {
    merge: true,
  });

  const now = new Date();
  const addendumData = {
    timestamp: Date.now(),
    date: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
    dateString: now.toDateString(),
    activityData: Object.assign({}, activityDoc.data(), {
      addendumDocRef,
      status: conn.req.body.status,
      timestamp: Date.now(),
    }),
    user: conn.requester.phoneNumber,
    action: httpsActions.changeStatus,
    status: conn.req.body.status,
    location: getGeopointObject(conn.req.body.geopoint),
    userDeviceTimestamp: conn.req.body.timestamp,
    activityId: conn.req.body.activityId,
    activityName: activityDoc.get('activityName'),
    isSupportRequest: conn.requester.isSupportRequest,
    geopointAccuracy: conn.req.body.geopoint.accuracy || null,
    provider: conn.req.body.geopoint.provider || null,
    userDisplayName: conn.requester.displayName,
  };

  const hasBeenCancelled = activityDoc.get('status') !== 'CANCELLED'
    && conn.req.body.status === 'CANCELLED';

  return handleLeaveAndOnDuty(conn, activityDoc)
    .then((result) => {
      console.log('result', result);

      if (result.message && hasBeenCancelled) {
        addendumData.cancellationMessage = result.message;
      }

      batch.set(addendumDocRef, addendumData);

      return batch.commit();
    })
    .then(() => sendResponse(conn, code.ok))
    .catch((error) => handleError(conn, error));
};


const handleResult = (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  const [
    activityDoc,
  ] = docs;

  if (activityDoc.get('status') === conn.req.body.status) {
    return sendResponse(
      conn,
      code.conflict,
      `The activity status is already '${conn.req.body.status}'.`
    );
  }

  const template = activityDoc.get('template');
  const attachment = activityDoc.get('attachment');
  const hasName = attachment.hasOwnProperty('Name');
  const officeId = activityDoc.get('officeId');

  if (!hasName || conn.req.body.status !== 'CANCELLED') {
    return createDocs(conn, activityDoc);
  }

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Activities')
    .where('template', '==', template)
    .where('attachment.Name.value', '==', attachment.Name.value)
    .where('isCancelled', '==', false)
    .limit(2)
    .get()
    .then((docs) => {
      if (docs.size > 1) {
        return sendResponse(conn, code.conflict, 'Not allowed');
      }

      return createDocs(conn, activityDoc);
    })
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  if (conn.req.method !== 'PATCH') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for /change-status`
      + ' endpoint. Use PATCH'
    );
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.changeStatus);

  if (!result.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      result.message
    );
  }

  return Promise
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
