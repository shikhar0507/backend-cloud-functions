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
} = require('../../firestore/activity/helperLib');

const {
  updateUserPhoneNumberInAuth,
} = users;

const {
  profiles,
  activities,
  updates,
} = rootCollections;

/**
 * Copies the user docs from old profile to the new profile.
 *
 * @param {Object} conn Contains Express Request and Response objects.
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

  const personProfile = profiles.doc(conn.requester.phoneNumber);

  Promise.all([
    personProfile.collection('Activities').get(),
    personProfile.collection('Subscriptions').get(),
  ]).then((snapShotsArray) => {
    snapShotsArray[0].forEach((doc) => {
      /** copy all activities from old profile to the new one */
      batch.set(profiles.doc(conn.req.body.phoneNumber)
        .collection('Activities').doc(doc.id), doc.data());

      /** delete docs from old profile */
      batch.delete(profiles.doc(conn.requester.phoneNumber)
        .collection('Activities').doc(doc.id));

      /** create user doc in Activity/AssignTo for new number */
      batch.set(activities.doc(doc.id).collection('AssignTo')
        .doc(conn.req.body.phoneNumber), {
          canEdit: doc.get('canEdit'),
        });

      /** delete old user doc in Activity/AssignTo */
      batch.delete(activities.doc(doc.id).collection('AssignTo')
        .doc(conn.requester.phoneNumber));
    });

    snapShotsArray[1].forEach((doc) => {
      /** copy subscriptions to new profile */
      batch.set(profiles.doc(conn.req.body.phoneNumber)
        .collection('Subscriptions').doc(doc.id), {
          autoIncludeOnCreate: doc.get('autoIncludeOnCreate'),
          office: doc.get('office'),
          template: doc.get('template'),
          timestamp: doc.get('timestamp'),
        });

      /** delete subscriptions from old profile */
      batch.delete(profiles.doc(conn.requester.phoneNumber)
        .collection('Subscriptions').doc(doc.id));
    });

    return batch.commit();
  }).then(() => sendResponse(conn, 200, 'ACCEPTED'))
    .catch((error) => handleError(conn, error));
};


/**
 * Updates the user's phone number in auth.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 */
const updateUserProfile = (conn) => {
  updateUserPhoneNumberInAuth(conn.requester.uid,
    conn.req.body.phoneNumber).then(() => updateFirestoreWithNewProfile(conn))
    .catch((error) => {
      if (error.code === 'auth/invalid-phone-number') {
        sendResponse(conn, 400, 'Phone number is not valid');
        return;
      } else if (error.code === 'auth/phone-number-already-exists') {
        sendResponse(conn, 409, 'CONFLICT');
        return;
      }

      console.log(error);
      sendResponse(conn, 400, 'BAD REQUEST');
    });
};


const app = (conn) => {
  if (!isValidPhoneNumber(conn.req.body.phoneNumber)) {
    sendResponse(conn, 400, 'Phone number is not valid');
    return;
  }

  updateUserProfile(conn);
};


module.exports = app;
