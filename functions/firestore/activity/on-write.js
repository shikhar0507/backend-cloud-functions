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


const { db, users, rootCollections, } = require('../../admin/admin');


/**
 * Subscribes the assignee from the `attachment` to the `template`
 * and `office`.
 *
 * @param {Object} activityDocNew Reference of the Activity object.
 * @param {Object} batch Firestore batch object.
 * @returns {Promise<Object>} Firestore batch.
 */
const manageSubscription = (activityDocNew, batch) => {
  const activityId = activityDocNew.id;
  const include = [];

  return rootCollections
    .activities
    .doc(activityId)
    .collection('Assignees')
    .get()
    /**
     * All assignees of the activity which as subscription are
     * added to the `include` for the doc.
     */
    .then((snapShot) => snapShot.forEach((doc) => include.push(doc.id)))
    .then(() => {
      const docRef = activityDocNew.get('docRef');
      const subscriberPhoneNumber = activityDocNew.get('attachment')['Phone Number'].value;
      const template = activityDocNew.get('attachment').Template.value;

      /* Copying the whole activity data... */
      batch.set(docRef, activityDocNew.data());

      batch.set(rootCollections
        .profiles
        .doc(subscriberPhoneNumber)
        .collection('Subscriptions')
        .doc(activityId), {
          include,
          activityId,
          template,
          canEditRule: activityDocNew.get('canEditRule'),
          office: activityDocNew.get('office'),
          officeId: activityDocNew.get('officeId'),
          status: activityDocNew.get('status'),
          timestamp: activityDocNew.get('timestamp'),
        });

      return batch.commit();
    })
    .catch(console.error);
};



/**
 * Subscribes the `assignees` of the activity to the mailing list
 * based on the report.
 *
 * @param {Object} activityDocNew Reference of the Activity object.
 * @param {Object} batch Firestore batch object.
 * @returns {Promise<Object>} Firestore batch.
 */
const manageReport = (activityDocNew, batch) => {
  const activityId = activityDocNew.id;
  const template = activityDocNew.get('template');
  const cc = 'help@growthfile.com';
  const office = activityDocNew.get('office');
  const to = [];

  const collectionName = `${template} Mailing List`;

  const docRef = db.collection(collectionName).doc(activityId);

  return rootCollections
    .activities
    .doc(activityId)
    .collection('Assignees')
    .get()
    .then((snapShot) => snapShot.forEach((doc) => to.push(doc.id)))
    .then(() => {
      batch.set(docRef, activityDocNew.data());

      batch.set(db
        .collection(collectionName)
        .doc(activityId), { cc, office, to, });

      return batch.commit();
    })
    .catch(console.error);
};



/**
 * For the template `admin`, adds the office name to the custom
 * claims of the user from attachment.
 *
 * @param {Object} activityDocNew Reference of the Activity object.
 * @param {Object} batch Firestore batch object.
 * @returns {Promise<Object>} Firestore batch.
 */
const manageAdmin = (activityDocNew, batch) => {
  const docRef = activityDocNew.get('docRef');
  const status = activityDocNew.get('status');
  const phoneNumber = activityDocNew.get('attachment')['Phone Number'].value;

  return users
    .getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      const phoneNumber = Object.keys(userRecord)[0];
      const record = userRecord[`${phoneNumber}`];

      const uid = record.uid;
      const claims = record.customClaims;
      const office = activityDocNew.get('office');
      let admin = [];

      if (status !== 'CANCELLED') {
        if (!claims) {
          admin.push(office);
        }

        if (claims && !claims.hasOwnProperty('admin')) {
          admin.push(office);
        }

        if (claims && claims.hasOwnProperty('admin')) {
          admin = claims.admin.push(office);
        }

        claims.admin = admin;
      } else {
        const index = claims.admin.indexOf(office);

        if (index > -1) {
          claims.admin.splice(index, 1);
        }
      }

      /**
       * This will create the doc below
       * `Offices/(officeId)/Activities/(activityId)` with
       * the template `admin`.
       */
      batch.set(docRef, activityDocNew.data());

      return Promise
        .all([
          users
            .setCustomUserClaims(uid, claims),
          batch
            .commit(),
        ]);
    })
    .catch(console.error);
};



/**
 * Triggers on activity `onWrite` event. Adds a `doc` with the `id` = `activityId`,
 * `timestamp` = `timestamp` from activity doc and `canEdit` from the Assignee doc
 * to the respective profiles of the activity assignees.
 *
 * @param {Object} change Contains the old and the new doc.
 * @param {Object} context Data related to the `onWrite` event.
 * @returns {Promise<Object>} Firestore batch.
 */
module.exports = (change, context) => {
  const activityDocNew = change.after;
  const activityId = context.params.activityId;
  const assigneeCanEdit = {};

  return activityDocNew
    .ref
    .collection('Assignees')
    .get()
    .then((assigneeCollectionSnapshot) => {
      const promises = [];

      assigneeCollectionSnapshot.forEach((assignee) => {
        const phoneNumber = assignee.id;
        const profileDoc = rootCollections.profiles.doc(phoneNumber);

        promises.push(profileDoc.get());

        assigneeCanEdit[phoneNumber] = assignee.get('canEdit');
      });

      return Promise.all(promises);
    })
    .then((docs) => {
      const batch = db.batch();

      docs.forEach((doc) => {
        /** The doc id is the phone number of the assignee. */
        const phoneNumber = doc.id;

        if (!doc.exists) {
          /** Placeholder `profiles` for the users with no auth. */
          batch.set(doc.ref, { uid: null, });
        }

        batch.set(doc
          .ref
          .collection('Activities')
          .doc(activityId), {
            canEdit: assigneeCanEdit[phoneNumber],
            timestamp: activityDocNew.get('timestamp'),
          });
      });

      return batch;
    })
    .then((batch) => {
      const template = activityDocNew.get('template');

      if (template === 'subscription') {
        return manageSubscription(activityDocNew, batch);
      }

      if (template === 'report') {
        return manageReport(activityDocNew, batch);
      }

      if (template === 'admin') {
        return manageAdmin(activityDocNew, batch);
      }

      /**
       * Copy the activity doc to the path which was created
       * by the activity in the `docRef` field.
       */
      batch.set(activityDocNew.get('docRef'), activityDocNew.data());

      return batch.commit();
    })
    .catch(console.error);
};
