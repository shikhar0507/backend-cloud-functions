/**
 * Copyright (c) 2020 GrowthFile
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

const { Attachment, Creator } = require('../../../admin/protos');
const { rootCollections, db } = require('../../../admin/admin');
const {
  httpsActions,
  subcollectionNames,
} = require('../../../admin/constants');
const { isNonEmptyString, sendResponse } = require('../../../admin/utils');
const { code } = require('../../../admin/responses');
const momentTz = require('moment-timezone');

const grantSubscription = async (conn, templateToGrant) => {
  const { phoneNumber, displayName, photoURL, uid } = conn.requester;
  console.log(`grantSubscription`, templateToGrant, conn.requester.phoneNumber);
  const { office } = conn.req.body;

  if (!isNonEmptyString(office)) {
    sendResponse(conn, code.badRequest, `Field 'office' is required`);
    throw new Error();
  }

  const [
    subcriptionDocQuery,
    {
      docs: [officeDoc],
    },
    {
      docs: [templateDoc],
    },
    employeeQuery,
  ] = await Promise.all([
    rootCollections.activities
      .where('office', '==', office)
      .where('template', '==', 'subscription')
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .where('attachment.Template.value', '==', templateToGrant)
      .get(),
    rootCollections.offices.where('office', '==', office).limit(1).get(),
    rootCollections.activityTemplates
      .where('name', '==', 'subscription')
      .limit(1)
      .get(),
    rootCollections.activities
      .where('office', '==', office)
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .get(),
  ]);

  const checkInSubscriptionsMap = new Map();

  subcriptionDocQuery.forEach(doc => {
    checkInSubscriptionsMap.set(office, doc.id);
  });

  const [roleDoc] = employeeQuery.docs.filter(doc => {
    const { template, status } = doc.data();

    return (
      template !== 'subscription' &&
      template !== 'admin' &&
      status !== 'CANCELLED'
    );
  });

  if (!officeDoc) {
    sendResponse(conn, code.conflict, `Office '${office} does not exist'`);
    throw new Error();
  }

  if (officeDoc.get('status') === 'CANCELLED') {
    sendResponse(conn, code.conflict, `Office: '${office}' is inactive`);
    throw new Error();
  }

  if (checkInSubscriptionsMap.size > 1) {
    return true;
  }

  if (checkInSubscriptionsMap.has(office)) {
    const activityId = checkInSubscriptionsMap.get(office);

    await rootCollections.activities.doc(activityId).set(
      {
        timestamp: Date.now(),
        status: 'CONFIRMED',
        addendumDocRef: null,
      },
      { merge: true },
    );
    return true;
  }
  const share = [];
  if (roleDoc) {
    const { attachment } = roleDoc.data();

    Object.keys(attachment).forEach(field => {
      const { value, type } = attachment[field];

      if (type === 'phoneNumber') {
        share.push(value);
      }
    });
  }

  const timezone = officeDoc.get('attachment.Timezone.value');
  const activityRef = rootCollections.activities.doc();
  const batch = db.batch();
  const momentNow = momentTz().tz(timezone);
  const { date, months: month, years: year } = momentNow.toObject();
  const allAssignees = Array.from(share.filter(Boolean));

  allAssignees.forEach(phoneNumber => {
    batch.set(
      activityRef.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber),
      { addToInclude: true },
    );
  });

  const activityData = {
    office,
    timezone,
    addendumDocRef: officeDoc.ref.collection(subcollectionNames.ADDENDUM).doc(),
    officeId: officeDoc.id,
    timestamp: Date.now(),
    creator: new Creator(phoneNumber, displayName, photoURL).toObject(),
    template: templateDoc.get('name'),
    status: templateDoc.get('statusOnCreate'),
    canEditRule: templateDoc.get('canEditRule'),
    activityName: `Subscription ${displayName || phoneNumber}`,
    hidden: templateDoc.get('hidden'),
    createTimestamp: Date.now(),
    venue: templateDoc.get('venue'),
    schedule: templateDoc.get('schedule'),
    report: templateDoc.get('report') || null,
    isCancelled: false,
    attachment: new Attachment(
      {
        'Phone Number': phoneNumber,
        Template: templateToGrant,
      },
      templateDoc.get('attachment'),
    ).toObject(),
  };

  batch.set(activityRef, activityData);
  batch.set(activityData.addendumDocRef, {
    date,
    month,
    year,
    uid,
    activityData,
    user: phoneNumber,
    timestamp: Date.now(),
    userDisplayName: displayName,
    share: allAssignees,
    action: httpsActions.create,
    isSupportRequest: false,
    activityId: activityRef.id,
    activityName: activityData.activityName,
  });

  await batch.commit();
};

module.exports = grantSubscription;
