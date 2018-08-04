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
} = require('../../admin/admin');


const manageSubscription = (activityDocNew, batch) => {
  const activityId = activityDocNew.id;
  const subscriberPhoneNumber = activityDocNew.get('attachment').phoneNumber.value;

  const docRef = activityDocNew.get('docRef');
  const include = [];

  rootCollections
    .activities
    .doc(activityId)
    .collection('Assignees')
    .get()
    /** All assignees of the activity which as subscription are
     * added to the `include` for the doc.
     */
    .then((snapShot) => snapShot.forEach((doc) => include.push(doc.id)))
    .then(() => {
      /* Copying the whole activity data... */
      batch.set(docRef, activityDocNew.data());

      batch.set(rootCollections
        .profiles
        .doc(subscriberPhoneNumber)
        .collection('Subscriptions')
        .doc(activityId), {
          include,
          activityId,
          canEditRule: activityDocNew.get('canEditRule'),
          office: activityDocNew.get('office'),
          status: activityDocNew.get('status'),
          template: activityDocNew.get('template'),
          timestamp: activityDocNew.get('timestamp'),
        });

      return batch.commit();
    })
    .catch(console.error);
};

const manageReport = (activityDocNew, batch) => {
  const activityId = activityDocNew.id;
  const template = activityDocNew.get('template');
  const cc = 'help@growthfile.com';
  const office = activityDocNew.get('office');
  const to = [];

  const collectionName = `${template} Mailing List`;

  const docRef = db.collection(collectionName).doc(activityId);

  rootCollections
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

const manageAdmin = (activityDocNew, batch) => {
  const docRef = activityDocNew.get('docRef');
  const phoneNumber = activityDocNew.get('attachment').phoneNumber.value;

  return users
    .getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      const uid = userRecord.uid;
      const claims = userRecord.customClaims;
      const office = activityDocNew.get('office');
      let admin = [];

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

      /** This will create the doc below
       * `Offices/(officeId)/(Activities)/(activityId)` with
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


module.exports = (change, context) => {
  const activityDocNew = change.after;
  const activityId = context.params.activityId;
  const timestamp = activityDocNew.get('timestamp');
  const template = activityDocNew.get('template');
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

      return promises;
    })
    .then((promises) => Promise.all(promises))
    .then((profileDocsSnapshot) => {
      const batch = db.batch();

      profileDocsSnapshot.forEach((profileDoc) => {
        const phoneNumber = profileDoc.id;

        if (!profileDoc.exists) {
          /** Placeholder profiles for the users with no auth. */
          batch.set(profileDoc.ref, { uid: null, });
        }

        batch.set(profileDoc
          .ref
          .collection('Activities')
          .doc(activityId), {
            canEdit: assigneeCanEdit[phoneNumber],
            timestamp,
          });
      });

      return batch;
    })
    .then((batch) => {
      if (template === 'subscription') {
        return manageSubscription(activityDocNew, batch);
      }

      if (template === 'report') {
        return manageReport(activityDocNew, batch);
      }

      if (template === 'admin') {
        return manageAdmin(activityDocNew, batch);
      }

      const docRef = activityDocNew.get('docRef');

      batch.set(docRef, activityDocNew.data());

      return batch.commit();
    })
    .catch(console.error);
};
