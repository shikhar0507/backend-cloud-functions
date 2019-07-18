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
  auth,
  rootCollections,
} = require('../admin/admin');
const {
  getObjectFromSnap,
  filterPhoneNumber,
} = require('../admin/utils');
const {
  reportNames,
} = require('../admin/constants');
const moment = require('moment');
const env = require('../admin/env');


/**
 * Creates new docs inside `Profile` and `Updates` collection in Firestore for
 * a newly signed up user.
 *
 * Adding custom claims here because in the admin panel, chances are that the people
 * getting the admin custom claims *may* not have auth. And when auth doesn't exist,
 * we cannot grant them custom claims.
 *
 * So, we are handling the case here. When the user logs-in the app first time,
 * this function will grant them custom claim of all the offices for which
 * they are an admin of.
 *
 * @param {Object} userRecord Object with user info.
 * @returns {Promise<Object>} Batch object.
 */
module.exports = (userRecord) => {
  const batch = db.batch();
  const momentToday = moment()
    .utc()
    .toObject();

  // Remove this while running a seperate project
  // or set the appropriate project env
  // using `process.env.GCLOUD_PROJECT` in the env.js file.
  if (!env.isProduction) {
    return auth
      .updateUser(userRecord.uid, {
        disabled: true,
      });
  }

  /**
   * Users with anonymous don't get a doc in Profiles/<phoneNumber>
   * and Updates/<uid>
   */
  if (userRecord.isAnonymous) {
    return rootCollections
      .anonymous
      .doc(userRecord.uid)
      .set({
        timestamp: Date.now(),
      }, {
          /** Probably isn't required. Not sure why I'm doing this */
          merge: true,
        });
  }

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', 'counter')
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', momentToday.date)
        .where('month', '==', momentToday.months)
        .where('year', '==', momentToday.years)
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .doc(userRecord.phoneNumber)
        .collection('Activities')
        .where('template', '==', 'admin')
        .where('attachment.Admin.value', '==', userRecord.phoneNumber)
        .get(),
    ])
    .then((result) => {
      const [
        counterDocsQuery,
        initDocsQuery,
        adminActivitiesQuery,
      ] = result;

      const initDoc = getObjectFromSnap(initDocsQuery);
      const counterDoc = getObjectFromSnap(counterDocsQuery);

      const usersAdded = (() => {
        if (initDocsQuery.empty) return 1;

        return initDocsQuery.docs[0].get('usersAdded') || 0;
      })();

      batch.set(initDoc.ref, {
        usersAdded: usersAdded + 1,
      }, {
          merge: true,
        });

      batch.set(counterDoc.ref, {
        totalUsers: counterDocsQuery.docs[0].get('totalUsers') + 1,
      }, {
          merge: true,
        });

      const customClaimsObject = {};

      if (!adminActivitiesQuery.empty) {
        customClaimsObject.admin = [];
      }

      adminActivitiesQuery
        .forEach((doc) => {
          const office = doc.get('office');

          console.log('Admin Of:', office);

          customClaimsObject.admin.push(office);
        });

      const uid = userRecord.uid;
      const phoneNumber = filterPhoneNumber(userRecord.phoneNumber);

      batch.set(rootCollections
        .updates
        .doc(uid), {
          phoneNumber,
        }, {
          merge: true,
        });

      /**
       * Profile *may* exist already, if the user signed
       * up to the platform sometime in the past OR if their
       * phone number was introduced to the system sometime
       * in the past via an activity
       */
      batch.set(rootCollections
        .profiles
        .doc(phoneNumber), {
          uid,
        }, {
          merge: true,
        });

      console.log({ phoneNumber, uid });

      return Promise
        .all([
          auth
            .setCustomUserClaims(uid, customClaimsObject),
          batch
            .commit(),
        ]);
    })
    .catch(console.error);
};
