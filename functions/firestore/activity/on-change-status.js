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

const {isValidRequestBody, checkActivityAndAssignee} = require('./helper');
const {code} = require('../../admin/responses');
const {httpsActions} = require('../../admin/constants');
const {db, rootCollections, getGeopointObject} = require('../../admin/admin');
const {
  getCanEditValue,
  handleError,
  sendResponse,
} = require('../../admin/utils');

const createDocs = async (conn, activityDoc) => {
  const batch = db.batch();
  const now = new Date();
  const addendumDocRef = rootCollections.offices
    .doc(activityDoc.get('officeId'))
    .collection('Addendum')
    .doc();

  const activityUpdate = {
    addendumDocRef,
    status: conn.req.body.status,
    timestamp: Date.now(),
    isCancelled: conn.req.body.status === 'CANCELLED',
  };

  batch.set(
    rootCollections.activities.doc(conn.req.body.activityId),
    activityUpdate,
    {
      merge: true,
    },
  );

  const addendumData = {
    timestamp: Date.now(),
    date: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
    activityData: Object.assign({}, activityDoc.data(), activityUpdate),
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

  batch.set(addendumDocRef, addendumData);

  await batch.commit();

  return sendResponse(conn, code.ok);
};

const handleResult = async (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest,
  );

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  const [activityDoc] = docs;

  if (!getCanEditValue(activityDoc, conn.requester)) {
    return sendResponse(conn, code.forbidden, `You cannot edit this activity`);
  }

  if (activityDoc.get('status') === conn.req.body.status) {
    return sendResponse(
      conn,
      code.conflict,
      `The activity status is already '${conn.req.body.status}'.`,
    );
  }

  const attachment = activityDoc.get('attachment');

  if (
    !attachment.hasOwnProperty('Name') ||
    conn.req.body.status !== 'CANCELLED'
  ) {
    return createDocs(conn, activityDoc);
  }

  // name is cancelled and another activity with
  // the same template and name exists, then
  // dont allow setting the status to CONFIRMED.
  const namedActivities = await rootCollections.activities
    .where('template', '==', activityDoc.get('template'))
    .where('officeId', '==', activityDoc.get('officeId'))
    .where(
      'attachment.Name.value',
      '==',
      activityDoc.get('attachment.Name.value'),
    )
    .get();

  if (namedActivities.size > 1) {
    return sendResponse(conn, code.conflict, 'Not allowed');
  }

  return createDocs(conn, activityDoc);
};

module.exports = async conn => {
  if (conn.req.method !== 'PATCH') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for /change-status` +
        ' endpoint. Use PATCH',
    );
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.changeStatus);

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  try {
    return handleResult(
      conn,
      await Promise.all([
        rootCollections.activities.doc(conn.req.body.activityId).get(),
        rootCollections.activities
          .doc(conn.req.body.activityId)
          .collection('Assignees')
          .doc(conn.requester.phoneNumber)
          .get(),
      ]),
    );
  } catch (error) {
    return handleError(conn, error);
  }
};
