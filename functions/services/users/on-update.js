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


const {
  users,
  rootCollections,
  db,
} = require('../../admin/admin');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  isValidPhoneNumber,
} = require('../../firestore/activity/helper');

const {
  code,
} = require('../../admin/responses');

const {
  updateUserPhoneNumberInAuth,
  revokeRefreshTokens,
} = users;

const {
  profiles,
  activities,
  updates,
  dailyPhoneNumberChanges,
} = rootCollections;


/**
 * Copies the user docs from old profile to the new profile.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {Promise} Firestore batch.
 */
const updateFirestoreWithNewProfile = (conn) => {
  const batch = db.batch();

  batch.set(profiles.doc(conn.req.body.phoneNumber), {
    uid: conn.requester.uid,
  }, {
      merge: true,
    });

  batch.set(updates.doc(conn.requester.uid), {
    phoneNumber: conn.req.body.phoneNumber,
  }, {
      merge: true,
    });

  const userProfile = profiles.doc(conn.requester.phoneNumber);

  Promise.all([
    userProfile.collection('Activities').get(),
    userProfile.collection('Subscriptions').get(),
  ]).then((docsArray) => {
    docsArray[0].forEach((doc) => {
      /** Copy all activities from old profile to the new one */
      batch.set(profiles.doc(conn.req.body.phoneNumber)
        .collection('Activities').doc(doc.id), doc.data());

      /** Delete docs from old profile */
      batch.delete(profiles.doc(conn.requester.phoneNumber)
        .collection('Activities').doc(doc.id));

      /** Create user doc in Activity/AssignTo for the new number */
      batch.set(activities.doc(doc.id).collection('Assignees')
        .doc(conn.req.body.phoneNumber), {
          canEdit: doc.get('canEdit'),
        });

      /** Delete old user doc in Activity/AssignTo */
      batch.delete(activities.doc(doc.id).collection('Assignees')
        .doc(conn.requester.phoneNumber));
    });

    docsArray[1].forEach((doc) => {
      let include = doc.get('include');

      if (doc.get('template') === 'plan' && doc.get('office') === 'personal') {
        include = [conn.req.body.phoneNumber];
      }

      /** Copy subscriptions to new profile */
      batch.set(profiles.doc(conn.req.body.phoneNumber)
        .collection('Subscriptions').doc(doc.id), {
          include,
          office: doc.get('office'),
          template: doc.get('template'),
          timestamp: doc.get('timestamp'),
        });

      /** Delete subscriptions from old profile */
      batch.delete(profiles.doc(conn.requester.phoneNumber)
        .collection('Subscriptions').doc(doc.id));
    });

    batch.set(dailyPhoneNumberChanges.doc(new Date().toDateString()), {
      [conn.requester.phoneNumber]: {
        timestamp: new Date(),
        newPhoneNumber: conn.req.body.phoneNumber,
      },
    }, {
        /** This doc *may* contain fields with other phone numbers of the
         * users who `disabled` the same day.
         */
        merge: true,
      });

    return batch.commit();
  }).then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


/**
 * Updates the user's phone number in auth.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 */
const updateUserProfile = (conn) => {
  Promise.all([
    /** Signs out the user by revoking their session token */
    revokeRefreshTokens(conn.requester.uid),

    /** Updates their phone number in auth and copies their
     * data from the old profile to the new one
     */
    updateUserPhoneNumberInAuth(
      conn.requester.uid,
      conn.req.body.phoneNumber
    ),
  ]).then(() => updateFirestoreWithNewProfile(conn))
    .catch((error) => {
      if (error.code === 'auth/invalid-phone-number') {
        sendResponse(
          conn,
          code.badRequest,
          `${conn.req.body.phoneNumber} is not a valid phone number.`
        );
        return;
      }

      if (error.code === 'auth/phone-number-already-exists') {
        sendResponse(
          conn,
          code.conflict,
          'The Phone number is already in use.',
          false
        );
        return;
      }

      console.log(error);
      sendResponse(
        conn,
        code.badRequest,
        'The phone number in the request does not confirm to the E.164' +
        'standard.'
      );
    });
};


/**
 * Validates the `phoneNumber` field form the request body.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 */
const app = (conn) => {
  if (!conn.req.body.hasOwnProperty('phoneNumber')) {
    sendResponse(
      conn,
      code.badRequest,
      'The phoneNumber field is missing from the request body.'
    );
    return;
  }

  if (!isValidPhoneNumber(conn.req.body.phoneNumber)) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.phoneNumber} is not a valid phone number.`
    );
    return;
  }

  updateUserProfile(conn);
};


module.exports = app;
