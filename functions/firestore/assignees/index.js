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
  db,
  users,
} = require('../../admin/admin');


const handleOffice = (assigneeDoc, context, result) => {
  const batch = db.batch();

  const activityRef = result[0];
  const activityId = activityRef.id;
  const attachment = activityRef.get('attachment');
  const schedule = activityRef.get('schedule');
  const venue = activityRef.get('venue');

  /** Office ID will always be the ID of the activity
   * used to create that office.
   */
  const officeRef = rootCollections.offices.doc(activityId);

  /** Office doc will always have the same data of the
   * activity doc, except `schedule`, `venue`, and `attachment` objects.
   * Those three will have their fields as individual fields in the
   * main office doc.
   */
  const officeData = activityRef.data();

  officeData.activityId = activityId;
  officeData.name = activityRef.get('office');

  delete officeData.schedule;
  delete officeData.venue;
  delete officeData.title;
  delete officeData.description;
  delete officeData.office;

  Object
    .keys(attachment)
    .forEach((key) => officeData[key] = attachment[key]);

  Object
    .keys(schedule)
    .forEach((key) => officeData[key] = schedule[key]);

  Object
    .keys(venue)
    .forEach((key) => officeData[key] = venue[key]);

  batch.set(officeRef, officeData);

  batch.set(activityRef, {
    docRef: officeRef,
  }, {
      merge: true,
    });

  return batch.commit();
};

const handleSubscription = (assigneeDoc, result) => {
  const batch = db.batch();
  const activityRef = result[0];
  const activityId = activityRef.id;
  const subscriberPhoneNumber = activityRef.get('attachment').phoneNumber.value;

  const subscriptionRef = rootCollections
    .profiles
    .doc(subscriberPhoneNumber)
    .collection('Subscriptions')
    .doc(activityId);

  const include = [];

  const assigneeArray = result[1];
  /** Doc-id is the phone number of the assignee. */
  assigneeArray.forEach((doc) => include.push(doc.id));

  const subscriptionData = {
    activityId,
    canEditRule: activityRef.get('canEditRule'),
    include,
    office: activityRef.get('office'),
    status: activityRef.get('status'),
    template: activityRef.get('template'),
    timestamp: activityRef.get('timestamp'),
  };

  batch.set(subscriptionRef, subscriptionData);

  batch.set(activityRef, {
    docRef: subscriptionRef,
  }, {
      merge: true,
    });

  return batch.commit();
};


const handleAdmin = (assigneeDoc, result) => {
  const activityRef = result[0];
  const phoneNumber = activityRef
    .get('attachment')
    .phoneNumber
    .value;

  return users
    .getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      const activityRef = result[0];
      const officeName = activityRef.get('office');
      const uid = userRecord.uid;
      const customClaims = userRecord.customClaims;

      const admin = [];

      if (!userRecord.hasOwnProperty('customClaims')) {
        admin.push(officeName);
      }

      if (!userRecord.customClaims.hasOwnProperty('admin')) {
        admin.concat(userRecord.customClaims.admin);
      }

      customClaims.admin = admin;

      return users
        .setCustomUserClaims(uid, customClaims);
    })
    .catch(console.error);
};


const handleReport = (assigneeDoc, result) => {
  const batch = db.batch();

  const activityRef = result[0];
  const activityId = activityRef.id;
  const office = activityRef.get('office');
  const cc = 'help@growthfile.com';

  const assigneeArray = result[1];
  /** @example For template name: `Daily Activities`
   * the root collection name will be `Daily Activities Mailing List`
  */
  const template = activityRef.get('template');

  const collectionName = `${template}s Mailing List`;

  const mailingListDocRef = db
    .collection(collectionName)
    .doc(activityId);

  const to = [];
  /** Doc-id is the phone number of the assignee. */
  assigneeArray.forEach((doc) => to.push(doc.id));

  const reportDoc = { cc, office, to, };

  batch.set(mailingListDocRef, reportDoc, { merge: true, });

  return batch.commit();
};

const handleResult = (assigneeDoc, result) => {
  const activityRef = result[0];
  const template = activityRef.get('template');

  /** For all other templates, the function doesn't need to do anything */
  if (['office', 'subscription', 'admin', 'report',].indexOf(template) === -1) {
    return Promise.resolve();
  }

  if (template === 'office') {
    return handleOffice(assigneeDoc, result);
  }

  if (template === 'subscription') {
    return handleSubscription(assigneeDoc, result);
  }

  if (template === 'admin') {
    return handleAdmin(assigneeDoc, result);
  }

  if (template === 'report') {
    return handleReport(assigneeDoc, result);
  }
};


module.exports = (assigneeDoc, context) => {
  const activityId = context.params.activityId;
  const activityRef = rootCollections.activities.doc(activityId);

  return Promise
    .all([
      activityRef
        .get(),
      activityRef
        .collection('Assignees')
        .get(),
    ])
    .then((result) => handleResult(assigneeDoc, result))
    .catch(console.error);
};
