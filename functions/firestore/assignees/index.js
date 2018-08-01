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
  users,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');


const handleOffice = (result) => {
  const batch = db.batch();

  const activityRef = result[0];
  const activityId = activityRef.id;
  const attachment = activityRef.get('attachment');
  const schedule = activityRef.get('schedule');
  const venue = activityRef.get('venue');

  /** Office ID will always be the ID of the activity
   * used to create that office.
   */
  const docRef = rootCollections.offices.doc(activityId);

  /** Office doc will always have the same data of the
   * activity doc, except `schedule`, `venue`, and `attachment` objects.
   * Those three will have their fields as individual fields in the
   * main office doc.
   */
  const officeDoc = activityRef.data();

  officeDoc.activityId = activityId;
  officeDoc.name = activityRef.get('office');

  delete officeDoc.schedule;
  delete officeDoc.venue;
  delete officeDoc.title;
  delete officeDoc.description;
  delete officeDoc.office;

  Object
    .keys(attachment)
    .forEach((key) => officeDoc[key] = attachment[key]);

  schedule.forEach((scheduleObject) => {
    officeDoc[`${scheduleObject.name}`] = {
      startTime: scheduleObject.startTime,
      endTime: scheduleObject.endTime,
    };
  });

  venue.forEach((venueObject) => {
    officeDoc[`${venueObject.venueDescriptor}`] = {
      address: venueObject.address,
      location: venueObject.location,
      geopoint: getGeopointObject(venueObject.geopoint),
    };
  });

  batch.set(docRef, officeDoc);

  batch.set(activityRef, { docRef, }, { merge: true, });

  return batch.commit();
};


const handleSubscription = (result) => {
  const batch = db.batch();
  const activityRef = result[0];
  const activityId = activityRef.id;
  const subscriberPhoneNumber = activityRef
    .get('attachment')
    .phoneNumber
    .value;
  const docRef = rootCollections
    .profiles
    .doc(subscriberPhoneNumber)
    .collection('Subscriptions')
    .doc(activityId);
  const include = [];
  const assigneeArray = result[1];


  /** Doc-id is the phone number of the assignee. */
  assigneeArray.forEach((doc) => include.push(doc.id));

  const subscriptionData = {
    include,
    activityId,
    canEditRule: activityRef.get('canEditRule'),
    office: activityRef.get('office'),
    status: activityRef.get('status'),
    template: activityRef.get('template'),
    timestamp: activityRef.get('timestamp'),
  };

  batch.set(docRef, subscriptionData);

  batch.set(activityRef, { docRef, }, { merge: true, });

  return batch.commit();
};


const handleAdmin = (result) => {
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


const handleReport = (result) => {
  const batch = db.batch();

  const activityRef = result[0];
  const activityId = activityRef.id;
  const office = activityRef.get('office');
  const template = activityRef.get('template');
  const cc = 'help@growthfile.com';

  const assigneeArray = result[1];

  /** @example For template name: `Daily Activities`
   * the root collection name will be `Daily Activities Mailing List`
  */
  const collectionName = `${template}s Mailing List`;

  const docRef = db
    .collection(collectionName)
    .doc(activityId);

  const to = [];
  /** Doc-id is the phone number of the assignee. */
  assigneeArray.forEach((doc) => to.push(doc.id));

  const reportDoc = { cc, office, to, };

  batch.set(activityRef, { docRef, }, { merge: true, });

  batch.set(docRef, reportDoc, { merge: true, });

  return batch.commit();
};


const addChildToOffice = (result) => {
  const activityRef = result[0];
  const activityId = activityRef.id;

  const office = activityRef.get('office');
  const template = activityRef.get('template');
  const schedule = activityRef.get('schedule');
  const venue = activityRef.get('venue');
  const attachment = activityRef.get('attachment');

  return rootCollections
    .offices
    .where('name', '==', office)
    .limit(1)
    .get()
    .then((snapShot) => {
      const officeDocRef = snapShot.docs[0];
      const officeId = officeDocRef.id;
      /** Mutates the template name such at its first character
       * is capitalized. Collection names in the DB have first
       * character in CAPS.
       * @see https://english.stackexchange.com/a/15914
       */
      const properCaseTemplateName = template
        .replace(/^\w/, (c) => c.toUpperCase());

      /** Collection name is always plural. */
      const pluralizedTemplate = `${properCaseTemplateName}s`;

      const docRef = rootCollections
        .offices
        .doc(officeId)
        .collection(pluralizedTemplate)
        .doc(activityId);

      const docData = activityRef.data();

      delete docData.schedule;
      delete docData.venue;
      delete docData.attachment;
      delete docData.title;
      delete docData.description;

      Object
        .keys(attachment)
        .forEach((key) => docData[key] = attachment[key]);

      schedule.forEach((scheduleObject) => {
        docData[`${scheduleObject.name}`] = {
          startTime: scheduleObject.startTime,
          endTime: scheduleObject.endTime,
        };
      });

      venue.forEach((venueObject) => {
        docData[`${venueObject.venueDescriptor}`] = {
          address: venueObject.address,
          location: venueObject.location,
          geopoint: getGeopointObject(venueObject.geopoint),
        };
      });

      const batch = db.batch();

      batch.set(docRef, docData, { merge: true, });

      batch.set(activityRef, { docRef, }, { merge: true, });

      return batch.commit();
    })
    .catch(console.error);
};


const handleResult = (result) => {
  const activityRef = result[0];
  const template = activityRef.get('template');

  if (template === 'office') {
    return handleOffice(result);
  }

  if (template === 'subscription') {
    return handleSubscription(result);
  }

  if (template === 'admin') {
    return handleAdmin(result);
  }

  if (template === 'report') {
    return handleReport(result);
  }

  return addChildToOffice(result);
};


const updateActivityTimestamp = (result) => {
  const activityRef = result[0];
  const activityId = activityRef.id;
  const assigneeArray = result[1];
  const batch = db.batch();

  assigneeArray.forEach((doc) => {
    batch.set(rootCollections
      .profiles.doc(doc.id)
      .collection('Activities')
      .doc(activityId),
      doc.data(), { merge: true, }
    );
  });

  return batch
    .commit()
    .then(() => handleResult(result))
    .catch(console.error);
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
    .then((result) => updateActivityTimestamp(result))
    .catch(console.error);
};
