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

const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
  isValidGeopoint,
  isValidDate,
} = require('../../admin/utils');

const {
  code,
} = require('../../admin/responses');

const {
  updateUserPhoneNumberInAuth,
  revokeRefreshTokens,
  deleteUserFromAuth,
} = users;


const commitBatch = (conn, batch) => batch
  .commit()
  .then(() => sendResponse(conn, code.noContent))
  .catch((error) => handleError(conn, error));


const disableOldAccount = (conn, batch) => {
  revokeRefreshTokens(conn.requester.uid)
    .then(() => deleteUserFromAuth(conn.requester.uid))
    .then(() => commitBatch(conn, batch))
    .catch((error) => handleError(conn, error));
};


const logDailyPhoneNumberChanges = (conn, batch) => {
  const moment = require('moment');

  const docId = moment(conn.req.body.timestamp).format('DD-MM-YYYY');

  batch.set(rootCollections
    .dailyPhoneNumberChanges.doc(docId), {
      [conn.requester.phoneNumber]: {
        timestamp: new Date(conn.req.body.timestamp),
        updatedPhoneNumber: conn.req.body.phoneNumber,
      },
    }, {
      merge: true,
    });

  disableOldAccount(conn, batch);
};


const writeAddendumForUsers = (conn, batch) => {
  conn.data.usersWithUpdatesDoc.forEach((doc) => {
    batch.set(rootCollections
      .updates
      .doc(doc.id).collection('Addendum').doc(), {
        activityId: doc.get('activityId'),
        comment: `${conn.requester.phoneNumber} changed their`
          + ` phone number to ${conn.req.body.phoneNumber}.`,
        location: getGeopointObject(conn.req.body.location),
        timestamp: new Date(conn.req.body.timestamp),
        user: conn.requester.phoneNumber,
      });
  });

  logDailyPhoneNumberChanges(conn, batch);
};


const fetchUsersWithUid = (conn, batch) => {
  const promises = [];
  conn.data.usersWithUpdatesDoc = [];

  conn.data.assignees.forEach((userObject) => {
    promises.push(rootCollections
      .updates
      .where('phoneNumber', '==', userObject.phoneNumber).get()
    );
  });

  Promise
    .all(promises)
    .then((usersWithAuth) => {
      usersWithAuth.forEach((snapShot) => {
        if (snapShot.empty) return;

        snapShot.forEach((doc) => {
          if (!doc.exists) return;

          conn.data.usersWithUpdatesDoc.push(doc);
        });
      });

      writeAddendumForUsers(conn, batch);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const updateActivityAssignees = (conn, batch) => {
  conn.data.assignees = [];

  Promise
    .all(conn.data.promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          const activityId = doc.ref.path.split('/')[1];
          const phoneNumber = doc.id;

          conn.data.assignees.push({ activityId, phoneNumber, });
        });
      });

      fetchUsersWithUid(conn, batch);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const transferSubscriptions = (conn, batch) => {
  const subscriptionsArray = conn.data.snapShots[1];

  subscriptionsArray.forEach((doc) => {
    const include = doc.get('include');

    const phoneNumberIndex = include.indexOf(conn.requester.phoneNumber);

    include[phoneNumberIndex] = conn.req.body.phoneNumber;

    const docData = doc.data();
    docData.include = include;

    batch.set(rootCollections
      .profiles
      .doc(conn.req.body.phoneNumber)
      .collection('Subscriptions')
      .doc(doc.id),
      docData
    );

    batch.delete(rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Subscriptions')
      .doc(doc.id)
    );
  });

  updateActivityAssignees(conn, batch);
};

const transferActivities = (conn, batch) => {
  const activitiesArray = conn.data.snapShots[0];
  conn.data.promises = [];

  activitiesArray.forEach((doc) => {
    conn.data.promises.push(
      rootCollections
        .activities
        .doc(doc.id)
        .collection('Assignees')
        .get()
    );

    /** Copy activities from old profile to the new one. */
    batch.set(rootCollections
      .profiles
      .doc(conn.req.body.phoneNumber)
      .collection('Activities')
      .doc(doc.id),
      doc.data()
    );

    /** Delete the copied activities (from previous step). */
    batch.delete(rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Activities')
      .doc(doc.id)
    );

    /** Add the new `phoneNumber` as an assignee to all the fetched activities. */
    batch.set(rootCollections
      .activities
      .doc(doc.id)
      .collection('Assignees')
      .doc(conn.req.body.phoneNumber), {
        /** Activity root contains `canEdit` field */
        canEdit: doc.get('canEdit'),
      });

    /** Delete old `phoneNumber` from Activity assignees list. */
    batch.delete(rootCollections
      .activities
      .doc(doc.id)
      .collection('Assignees')
      .doc(conn.requester.phoneNumber)
    );
  });

  transferSubscriptions(conn, batch);
};


const fetchActivitiesAndSubsriptions = (conn, batch) => {
  const userProfile = rootCollections.profiles.doc(conn.requester.phoneNumber);

  Promise
    .all([
      userProfile
        .collection('Activities')
        .get(),
      userProfile
        .collection('Subscriptions')
        .get(),
    ])
    .then((snapShots) => {
      conn.data.snapShots = snapShots;
      transferActivities(conn, batch);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const updateUserDocs = (conn) => {
  const batch = db.batch();

  /** Stores temporary data throughout the code. */
  conn.data = {};

  batch.set(rootCollections
    .profiles
    .doc(conn.req.body.phoneNumber), {
      uid: conn.requester.uid,
    }, {
      merge: true,
    }
  );

  batch.set(rootCollections
    .updates.
    doc(conn.requester.uid), {
      phoneNumber: conn.req.body.phoneNumber,
    }, {
      merge: true,
    }
  );

  fetchActivitiesAndSubsriptions(conn, batch);
};


const updatePhoneNumberInAuth = (conn) => {
  updateUserPhoneNumberInAuth(
    /** Current `uid` */
    conn.requester.uid,
    /** New phoneNumber to set. */
    conn.req.body.phoneNumber
  )
    .then(() => updateUserDocs(conn))
    .catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (!conn.req.body.hasOwnProperty('phoneNumber')) {
    sendResponse(
      conn,
      code.badRequest,
      'The phoneNumber field is missing from the request body.'
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


module.exports = app;
