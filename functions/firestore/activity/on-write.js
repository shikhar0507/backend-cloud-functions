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

  return rootCollections
    .activities
    .doc(activityId)
    .collection('Assignees')
    .get()
    .then((assignees) => {
      const include = [];
      const subscriberPhoneNumber =
        activityDocNew.get('attachment').Subscriber.value;

      /**
       * All assignees of the activity which as subscription are
       * added to the `include` for the doc.
       */
      assignees.forEach((assignee) => {
        /**
         * The user's own phone number should not be added
         * in the include array.
         */
        if (subscriberPhoneNumber === assignee.id) return;

        include.push(assignee.id);
      });

      const template = activityDocNew.get('attachment').Template.value;

      batch.set(rootCollections
        .profiles
        .doc(subscriberPhoneNumber)
        .collection('Subscriptions')
        .doc(activityId), {
          include,
          activityId,
          template,
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

  return rootCollections
    .activities
    .doc(activityId)
    .collection('Assignees')
    .get()
    .then((snapShot) => snapShot.forEach((doc) => to.push(doc.id)))
    .then(() => {
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
  const status = activityDocNew.get('status');
  const phoneNumber = activityDocNew.get('attachment').Admin.value;

  return users
    .getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      const phoneNumber = Object.keys(userRecord)[0];
      const record = userRecord[`${phoneNumber}`];
      const uid = record.uid;
      const office = activityDocNew.get('office');
      const admin = [office,];
      let claims = {};

      if (status === 'CANCELLED') {
        const index = record.customClaims.admin.indexOf(office);
        record.customClaims.admin.splice(index, 1);

        claims = record.customClaims;
      } else {
        if (record.customClaims) {
          if (record.customClaims.admin) {
            record.customClaims.admin.forEach((item) => admin.push(item));

            claims = record.customClaims;
          }
        }
      }

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
    .then((assignees) => {
      const promises = [];

      assignees.forEach((assignee) => {
        const phoneNumber = assignee.id;
        const profileDoc = rootCollections.profiles.doc(phoneNumber);

        promises.push(profileDoc.get());

        assigneeCanEdit[phoneNumber] = assignee.get('canEdit');
      });

      return Promise.all(promises);
    })
    .then((profiles) => {
      const batch = db.batch();

      profiles.forEach((profile) => {
        const phoneNumber = profile.id;

        if (!profile.exists) {
          /** Placeholder `profiles` for the users with no auth. */
          batch.set(profile.ref, { uid: null, });
        }

        batch.set(profile
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

      /**
       * Copy the activity doc to the path which was created
       * by the activity in the `docRef` field.
       */
      batch.set(activityDocNew.get('docRef'), activityDocNew.data());

      if (template === 'subscription') {
        return manageSubscription(activityDocNew, batch);
      }

      if (template === 'report') {
        return manageReport(activityDocNew, batch);
      }

      if (template === 'admin') {
        return manageAdmin(activityDocNew, batch);
      }


      return batch.commit();
    })
    .catch(console.error);
};
