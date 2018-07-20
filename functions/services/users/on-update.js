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
  users,
  rootCollections,
  db,
  getGeopointObject,
} = require('../../admin/admin');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
  isValidGeopoint,
  isValidDate,
  getISO8601Date,
} = require('../../admin/utils');


const disableOldAccount = (conn, locals) => {
  users.revokeRefreshTokens(conn.requester.uid)
    .then(() => users.deleteUserFromAuth(conn.requester.uid))
    .then(() => locals.batch.commit())
    .catch((error) => handleError(conn, error));
};


const logDailyPhoneNumberChanges = (conn, locals) => {
  const docId = getISO8601Date(conn.req.body.timestamp);

  locals.batch.set(rootCollections
    .dailyPhoneNumberChanges.doc(docId), {
      [conn.requester.phoneNumber]: {
        timestamp: new Date(conn.req.body.timestamp),
        updatedPhoneNumber: conn.req.body.phoneNumber,
      },
    }, {
      merge: true,
    });

  disableOldAccount(conn, locals);
};


const writeAddendumForUsers = (conn, locals) => {
  locals.usersWithUpdatesDoc.forEach((doc) => {
    locals.batch.set(rootCollections
      .updates
      .doc(doc.id)
      .collection('Addendum')
      .doc(), {
        activityId: doc.get('activityId'),
        comment: `${conn.requester.phoneNumber} changed their`
          + ` phone number to ${conn.req.body.phoneNumber}.`,
        location: getGeopointObject(conn.req.body.location),
        timestamp: new Date(conn.req.body.timestamp),
        user: conn.requester.phoneNumber,
      });
  });

  logDailyPhoneNumberChanges(conn, locals);
};


const fetchUsersWithUid = (conn, locals) => {
  const promises = [];
  locals.usersWithUpdatesDoc = [];

  locals.assignees.forEach((userObject) => {
    promises.push(rootCollections
      .updates
      .where('phoneNumber', '==', userObject.phoneNumber)
      .get()
    );
  });

  Promise
    .all(promises)
    .then((usersWithAuth) => {
      usersWithAuth.forEach((snapShot) => {
        if (snapShot.empty) return;

        snapShot.forEach((doc) => {
          if (!doc.exists) return;
          if (!doc.get('uid')) return;

          locals.usersWithUpdatesDoc.push(doc);
        });
      });

      writeAddendumForUsers(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const updateActivityAssignees = (conn, locals) =>
  Promise
    .all(locals.promises)
    .then((snapShots) => {
      locals.assignees = [];

      snapShots.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          const activityId = doc.ref.path.split('/')[1];

          locals.assignees.push({ activityId, phoneNumber: doc.id, });
        });
      });

      fetchUsersWithUid(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


const transferSubscriptions = (conn, locals, snapShots) => {
  const subscriptionsArray = snapShots[1];

  subscriptionsArray.forEach((doc) => {
    const include = doc.get('include');

    const phoneNumberIndex = include.indexOf(conn.requester.phoneNumber);

    include[phoneNumberIndex] = conn.req.body.phoneNumber;

    const docData = doc.data();
    docData.include = include;

    locals.batch.set(rootCollections
      .profiles
      .doc(conn.req.body.phoneNumber)
      .collection('Subscriptions')
      .doc(doc.id),
      docData
    );

    locals.batch.delete(rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Subscriptions')
      .doc(doc.id)
    );
  });

  updateActivityAssignees(conn, locals);
};

const transferActivities = (conn, locals, snapShots) => {
  const activitiesArray = snapShots[0];
  locals.promises = [];

  activitiesArray.forEach((doc) => {
    locals.promises.push(
      rootCollections
        .activities
        .doc(doc.id)
        .collection('Assignees')
        .get()
    );

    /** Copy activities from old profile to the new one. */
    locals.batch.set(rootCollections
      .profiles
      .doc(conn.req.body.phoneNumber)
      .collection('Activities')
      .doc(doc.id),
      doc.data()
    );

    /** Delete the copied activities (from previous step). */
    locals.batch.delete(rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Activities')
      .doc(doc.id)
    );

    /** Add the new `phoneNumber` as an assignee to all the fetched activities. */
    locals.batch.set(rootCollections
      .activities
      .doc(doc.id)
      .collection('Assignees')
      .doc(conn.req.body.phoneNumber), {
        /** Activity root contains `canEdit` field */
        canEdit: doc.get('canEdit'),
      });

    /** Delete old `phoneNumber` from Activity assignees list. */
    locals.batch.delete(rootCollections
      .activities
      .doc(doc.id)
      .collection('Assignees')
      .doc(conn.requester.phoneNumber)
    );
  });

  transferSubscriptions(conn, locals, snapShots);
};


const fetchActivitiesAndSubsriptions = (conn, locals) =>
  Promise
    .all([
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Activities')
        .get(),
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .get(),
    ])
    .then((snapShots) => transferActivities(conn, locals, snapShots))
    .catch((error) => handleError(conn, error));


/**
 * Updates the user profile docs (inside `Updates` and `Profile`)
 * with the phone number from the request body.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const updateUserDocs = (conn) => {
  /** Stores temporary data throughout the code. */
  const locals = {};
  locals.batch = db.batch();

  locals.batch.set(rootCollections
    .profiles
    .doc(conn.req.body.phoneNumber), {
      uid: conn.requester.uid,
    }, {
      merge: true,
    }
  );

  locals.batch.set(rootCollections
    .updates
    .doc(conn.requester.uid), {
      phoneNumber: conn.req.body.phoneNumber,
    }, {
      merge: true,
    }
  );

  fetchActivitiesAndSubsriptions(conn, locals);
};


/**
 * Updates the user's phone number in `auth` using the `phoneNumber`
 * field from the request body.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const updatePhoneNumberInAuth = (conn) =>
  users
    .updateUserPhoneNumberInAuth(
      /** Current `uid` */
      conn.requester.uid,
      /** New phoneNumber to set. */
      conn.req.body.phoneNumber
    )
    .then(() => updateUserDocs(conn))
    .catch((error) => {
      /** @see https://firebase.google.com/docs/auth/admin/errors */
      if (error.code === 'auth/invalid-phone-number') {
        sendResponse(
          conn,
          code.badRequest,
          'Invalid phone number found in the request body.'
        );

        return;
      }

      if (error.code === 'auth/phone-number-already-exists') {
        sendResponse(
          conn,
          code.conflict,
          `Someone is already using the phone number: ${conn.req.body.phoneNumber}.`
        );

        return;
      }

      handleError(conn, error);
    });


/**
 * Validates the request by checking the request body for a valid
 * `timestamp`, `phoneNumber`, and `geopoint`.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
module.exports = (conn) => {
  if (!conn.req.body.hasOwnProperty('phoneNumber')) {
    sendResponse(
      conn,
      code.badRequest,
      'The phoneNumber field is missing from the request body.'
    );

    return;
  }

  if (conn.requester.phoneNumber === conn.req.body.phoneNumber) {
    sendResponse(
      conn,
      code.conflict,
      'The phone number to update cannot be the same as your own phone number.'
    );

    return;
  }

  if (!isE164PhoneNumber(conn.req.body.phoneNumber)) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.phoneNumber} is not a valid phone number.`
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('geopoint')) {
    sendResponse(
      conn,
      code.badRequest,
      'The geopoint field is missing from the request body.'
    );

    return;
  }

  if (!isValidGeopoint(conn.req.body.geopoint)) {
    sendResponse(
      conn,
      code.badRequest,
      'The geopoint is not a valid latitude, longitude object.'
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('timestamp')) {
    sendResponse(
      conn,
      code.badRequest,
      'The timestamp field is missing from the request body.'
    );

    return;
  }

  if (!isValidDate(conn.req.body.timestamp)) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.timestamp} is not a valid timestamp.`
    );

    return;
  }

  updatePhoneNumberInAuth(conn);
};
