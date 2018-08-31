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

        const addToInclude = assignee.get('addToInclude');

        /**
         * For the subscription template, people from
         * the share array are not added to the include array.
         */
        if (!addToInclude) return;

        include.push(assignee.id);
      });

      const template = activityDocNew.get('attachment').Template.value;

      batch.set(rootCollections
        .profiles
        .doc(subscriberPhoneNumber)
        .collection('Subscriptions')
        .doc(activityId), {
          include,
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
  const include = [];

  const collectionName = `${template} Mailing List`;

  return rootCollections
    .activities
    .doc(activityId)
    .collection('Assignees')
    .get()
    .then((snapShot) => snapShot.forEach((doc) => include.push(doc.id)))
    .then(() => {
      batch.set(db
        .collection(collectionName)
        .doc(activityId), { cc, office, include, });

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
      const customClaims = record.customClaims;
      const office = activityDocNew.get('office');
      let newClaims = {
        admin: [office,],
      };

      /**
       * The `statusOnCreate` for `admin` template is `CONFIRMED`.
       * This block should not run when the activity has been
       * created by someone.
       * In the case of `/change-status` however, chances are
       * that the status becomes `CANCELLED`.
       *
       * When that happens, the name of the office from
       * the `admin` array is removed from the `customClaims.admin`
       * of the admin user.
       */
      if (status === 'CANCELLED') {
        const index = customClaims.admin.indexOf(office);
        customClaims.admin.splice(index, 1);

        newClaims = customClaims;
      } else {
        /**
         * The user already is `admin` of another office.
         * Preserving their older permission for that case..
         */
        if (customClaims && customClaims.admin) {
          customClaims.admin.push(office);
          newClaims = customClaims;
        }
      }

      return Promise
        .all([
          users
            .setCustomUserClaims(uid, newClaims),
          batch
            .commit(),
        ]);
    })
    .catch(console.error);
};



/**
 * `Creates` or `Updates` the `activity` doc in the `Profile` of the `Assignees` of
 * an `activity`.
 *
 * Values in this `doc` are `canEdit` and `timestamp` the `onWrite` event.
 * The `id` of this `doc` is the same as the `activity-id`.
 *
 * @Trigger: `onWrite`
 * @Path: `Activities/(activityId)`
 * @WritePath: `Profiles/(assignee phone number)/Activities/(activityId)`
 *
 * @param {Object} change Contains the old and the new doc.
 * @param {Object} context Data related to the `onWrite` event.
 * @returns {Promise<Object>} Firestore batch.
 */
module.exports = (change, context) => {
  const activityDocNew = change.after;
  const activityId = context.params.activityId;
  const assigneeCanEdit = {};

  /**
   * Only for `debugging` purpose. An `activity` will *never* be deleted.
   * But, if this case is not handled, the cloud function will crash since
   * the `activityDocNew` will be `undefined` with the `onDelete` operation.
  */
  if (!activityDocNew) return Promise.resolve('Activity was deleted.');

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
          /** Placeholder `profiles` for the users with no `auth`. */
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
       * Copy the `activity` doc to the path which was created
       * by the `activity` in the `docRef` field.
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
