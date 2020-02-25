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

const { isValidRequestBody } = require('./helper');
const { code } = require('../../admin/responses');
const { httpsActions, subcollectionNames } = require('../../admin/constants');
const { db, rootCollections, getGeopointObject } = require('../../admin/admin');
const { getAuth, sendResponse, getCanEditValue } = require('../../admin/utils');
const momentTz = require('moment-timezone');
module.exports = async conn => {
  if (conn.req.method !== 'PATCH') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /share endpoint. Use PATCH.`,
    );
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.share);

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  const activityRef = rootCollections.activities.doc(conn.req.body.activityId);

  const [activityDoc, assigneeSnap] = await Promise.all([
    activityRef.get(),
    activityRef.collection(subcollectionNames.ASSIGNEES).get(),
  ]);

  if (!activityDoc.exists) {
    return sendResponse(conn, code.badRequest, `Activity does not exist`);
  }

  const { template, timezone = 'Asia/Kolkata' } = activityDoc.data();

  const batch = db.batch();
  const activityUpdate = Object.assign({}, activityDoc.data(), {
    timestamp: Date.now(),
    addendumDocRef: rootCollections.offices
      .doc(activityDoc.get('officeId'))
      .collection(subcollectionNames.ADDENDUM)
      .doc(),
  });
  const oldAssigneeSet = new Set(assigneeSnap.docs.map(doc => doc.id));
  const newAssigneeSet = new Set(conn.req.body.share);
  const isSpecialTemplate = new Set(['recipient', 'subscription']).has(
    template,
  );

  if (!getCanEditValue(activityDoc, conn.requester)) {
    return sendResponse(conn, code.forbidden, `You cannot edit this activity`);
  }

  // keep the old and new assignee list in sync
  // else assign all the new numbers
  if (isSpecialTemplate) {
    oldAssigneeSet.forEach(phoneNumber => {
      const shouldUnassign = !newAssigneeSet.has(phoneNumber);

      if (shouldUnassign) {
        batch.delete(
          activityDoc.ref
            .collection(subcollectionNames.ASSIGNEES)
            .doc(phoneNumber),
        );
      }
    });
  }

  newAssigneeSet.forEach(phoneNumber => {
    batch.set(
      activityDoc.ref.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber),
      {},
    );
  });

  if (template === 'duty') {
    const userRecords = await Promise.all([...newAssigneeSet].map(getAuth));
    const withoutAuth = [];
    const usersWithAuth = userRecords.filter(({ uid, phoneNumber }) => {
      const hasAuth = !!uid;

      if (!hasAuth) {
        withoutAuth.push(phoneNumber);
      }

      return hasAuth;
    });

    if (userRecords.length !== usersWithAuth.length) {
      return sendResponse(
        conn,
        code.badRequest,
        `Inactive Phone number(s) ${withoutAuth.toString()} found`,
      );
    }
  }

  batch.set(activityRef, activityUpdate, { merge: true });

  const { date, months: month, years: year, milliseconds } = momentTz()
    .tz(timezone)
    .toObject();

  batch.set(activityUpdate.addendumDocRef, {
    date,
    month,
    year,
    timestamp: milliseconds,
    activityData: Object.assign({}, activityUpdate, { addendumDocRef: null }),
    user: conn.requester.phoneNumber,
    share: conn.req.body.share,
    action: httpsActions.share,
    location: getGeopointObject(conn.req.body.geopoint),
    userDeviceTimestamp: conn.req.body.timestamp,
    activityId: conn.req.body.activityId,
    activityName: activityDoc.get('activityName'),
    isAdminRequest: conn.requester.isAdminRequest,
    isSupportRequest: conn.requester.isSupportRequest,
    provider: conn.req.body.geopoint.provider || null,
    geopointAccuracy: conn.req.body.geopoint.accuracy || null,
    userDisplayName: conn.requester.displayName,
  });

  console.log('no of docs', batch._ops.length);

  await batch.commit();

  return sendResponse(conn, code.ok, '');
};
