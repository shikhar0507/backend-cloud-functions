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
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../admin/admin');

const { getISO8601Date, } = require('../admin/utils');


/**
 * Adds the user's `phoneNumber` to the log for the day.
 *
 * @param {Object} userRecord Object with user info.
 * @param {Object} batch Batch object.
 * @returns {Promise} Batch object.
 */
const updateDailySignups = (userRecord, batch) =>
  rootCollections
    .dailySignUps
    .doc(getISO8601Date())
    .set({
      [userRecord.phoneNumber]: {
        timestamp: serverTimestamp,
      },
    },
      {
        /** Doc will have other phone numbers too. */
        merge: true,
      })
    .then(() => batch.commit())
    /* eslint no-console: "off" */
    .catch(console.error);


/**
 * Adds a _default_ subscription to the user with the template: `plan` and
 * the office: `personal`.
 *
 * @param {Object} userRecord Object with user info.
 * @param {Object} batch Batch object.
 * @param {Object} activityDocRef Reference to the Activity doc.
 * @returns {Promise} Batch object.
 */
const createSubscription = (userRecord, batch, activityDocRef) => {
  /** Default subscription for everyone who signs up */
  batch.set(rootCollections
    .profiles
    .doc(userRecord.phoneNumber)
    .collection('Subscriptions')
    .doc(), {
      office: 'personal',
      template: 'plan',
      include: [
        userRecord.phoneNumber,
      ],
      /** The auth event isn't an activity */
      activityId: activityDocRef.id,
      status: 'CONFIRMED',
      canEditRule: 'ALL',
      timestamp: serverTimestamp,
    }, {
      /** The profile *may* have old data for the user, so
       * replacing the whole document *can* be destructive.
       */
      merge: true,
    }
  );

  return updateDailySignups(userRecord, batch);
};


/**
 * Adds an addendum to the the user's `Updates` collection inside the
 * `Addendum` subcollection.
 *
 * @param {Object} userRecord Object with user info.
 * @param {Object} batch Batch object.
 * @param {Object} activityDocRef Reference to the Activity doc.
 * @returns {Promise} Batch object.
 */
const createAddendum = (userRecord, batch, activityDocRef) => {
  batch.set(rootCollections
    .updates
    .doc(userRecord.uid)
    .collection('Addendum')
    .doc(), {
      activityId: activityDocRef.id,
      comment: 'You signed up.',
      timestamp: serverTimestamp,
      user: userRecord.phoneNumber,
      location: getGeopointObject({
        latitude: 0,
        longitude: 0,
      }),
    });

  return createSubscription(userRecord, batch, activityDocRef);
};


/**
 * Adds a document to the batch for creating a doc in
 * `/Activities` collection for user signup.
 *
 * @param {Object} userRecord Object with user info.
 * @param {Object} batch Batch object.
 * @returns {Promise} Batch object.
 */
const createActivity = (userRecord, batch) => {
  const activityDocRef = rootCollections.activities.doc();

  batch.set(activityDocRef, {
    canEditRule: 'NONE',
    description: `${userRecord.phoneNumber} signed up.`,
    docRef: null,
    office: 'personal',
    schedule: [],
    status: 'CONFIRMED',
    title: 'Welcome to Growthfile.',
    template: 'plan',
    timestamp: serverTimestamp,
    venue: [],
  });

  /** Not creating the `dailyActivities` doc because on-auth is
   * not a user action.
   */

  batch.set(activityDocRef
    .collection('Assignees')
    .doc(userRecord.phoneNumber), {
      canEdit: false,
    });

  return createAddendum(userRecord, batch, activityDocRef);
};


/**
 * Creates new docs inside `Profile` and `Updates` collection in Firestore for
 * a newly signed up user.
 *
 * @param {Object} userRecord Object with user info.
 * @returns {Promise} Batch object.
 */
module.exports = (userRecord) => {
  const batch = db.batch();

  batch.set(rootCollections
    .updates
    .doc(userRecord.uid), {
      phoneNumber: userRecord.phoneNumber,
    });

  batch.set(rootCollections
    .profiles
    .doc(userRecord.phoneNumber), {
      uid: userRecord.uid,
    }, {
      /** Profile *may* exist already, if the user signed
       * up to the platform somtime in the past.
      */
      merge: true,
    });

  return createActivity(userRecord, batch);
};
