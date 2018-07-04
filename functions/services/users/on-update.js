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
  getFormattedDate,
} = require('../../admin/utils');

const {
  isValidPhoneNumber,
  isValidLocation,
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
 * Commits the batch and sends an empty response to the client.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const commitBatch = (conn) =>
  conn.batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));


/**
 * Creates a log of the phone number updates performed by users
 * for daily reports.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const createDailyLog = (conn) => {
  conn.batch.set(
    dailyPhoneNumberChanges
      .doc(getFormattedDate(conn.data.timestamp)), {
      [conn.requester.phoneNumber]: {
        timestamp: conn.data.timestamp,
        newPhoneNumber: conn.req.body.phoneNumber,
      },
    }, {
      /** This doc *may* contain fields with other phone numbers of the
       * users who `disabled` the same day.
       */
      merge: true,
    }
  );

  commitBatch(conn);
};


/**
 * Writes the addendum for each user to notify them of the phone
 * number update.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const writeAddendumForUsers = (conn) => {
  const addendumDoc = {
    /** Phone number update is not an activity. */
    activityId: null,
    comment: `${conn.requester.phoneNumber} updated their phone number`
      + `to ${conn.req.body.phoneNumber}.`,
    location: getGeopointObject(conn.req.body.location),
    timestamp: new Date(conn.req.body.timestamp),
    user: conn.requester.phoneNumber,
  };

  conn.data.usersToWriteAddendumFor.forEach((doc) => {
    conn.batch.set(
      updates.doc(doc.id).collection('Addendum').doc(), addendumDoc
    );
  });

  createDailyLog(conn);
};


/**
 * Filters out the `assignees` of the all the `activities` who don't
 * have a document in the `Updates` collection (i.e., they haven't signed up.).
 * Updates are not created for them.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const fetchUsersWithUids = (conn) => {
  const usersWithAuthPromises = [];
  conn.data.usersToWriteAddendumFor = [];

  conn.data.phoneNumberUniques.forEach((phoneNumber) => {
    usersWithAuthPromises.push(
      updates.where('phoneNumber', '==', phoneNumber).get()
    );
  });

  Promise
    .all(usersWithAuthPromises)
    .then((docSnapShots) => {
      docSnapShots.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          if (!doc.exists) return;

          conn.data.usersToWriteAddendumFor.push(doc.data());
        });
      });

      writeAddendumForUsers(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Gets all the `Assignees` from the `activities` of which the
 * requester is an *assignee* of.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const fetchAssigneesFromAllActivities = (conn) => {
  const promises = [];
  const assignees = [];
  const activitiesArray = conn.data.docsArray[0];

  activitiesArray.forEach((activity) => {
    promises.push(
      activities
        .doc(activity)
        .collection('Assignees')
        .get()
    );
  });

  let phoneNumber;

  Promise
    .all(promises)
    .then((assigneeCollectionSnapShots) => {
      assigneeCollectionSnapShots.forEach((snapShot) => {
        snapShot.forEach((assigneeDoc) => {
          phoneNumber = assigneeDoc.id;
          assignees.push(phoneNumber);
        });
      });

      /** Multiple activities can have the same `assignee`. */
      conn.data.phoneNumberUniques = [
        ...new Set(assignees),
      ];

      fetchUsersWithUids(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Clones all the `subscription` docs from the User `profile` to the new
 * profile.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const cloneSubscriptions = (conn) => {
  const subscriptionsList = conn.data.docsArray[1];
  let include;

  subscriptionsList.forEach((subscription) => {
    include = subscription.get('include');

    /** Handling the default subscription */
    if (subscription.get('template') === 'plan'
      && subscription.get('office') === 'personal') {
      include = [
        conn.req.body.phoneNumber,
      ];
    }

    // FIXME: Not all `include` arrays are being updated. The arrays which are being
    // Copied directly will still have the old `phoneNumber` and NOT the new one.

    /** Copy each `subscription` to new `Updates`. */
    conn.batch.set(
      profiles
        .doc(conn.req.body.phoneNumber)
        .collection('Subscriptions')
        .doc(subscription.id), {
        include,
        office: subscription.get('office'),
        template: subscription.get('timestamp'),
        timestamp: subscription.get('timestamp'),
      }
    );

    /** Delete `subscriptions` from old `Updates`. */
    conn.batch.delete(
      profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .doc(subscription.id)
    );
  });

  fetchAssigneesFromAllActivities(conn);
};


/**
 * Clones all the `activity` docs from the User `profile` to the new
 * profile.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const cloneActivities = (conn) => {
  const activitiesArray = conn.data.docsArray[0];

  activitiesArray.forEach((activity) => {
    /** Copy each activity from old profile to new profile. */
    conn.batch.set(
      profiles
        .doc(conn.req.body.phoneNumber)
        .collection('Activities')
        .doc(activity.id),
      activity.data()
    );

    /** Delete the copied activities from old profile. */
    conn.batch.delete(
      profiles
        .doc(conn.requester.phoneNumber)
        .collection('Activities')
        .doc(activity.id)
    );

    /** Add the new `phoneNumber` as an assignee to all the fetched activities. */
    conn.batch.set(
      activities
        .doc(activity.id)
        .collection('Assignees')
        .doc(conn.req.body.phoneNumber), {
        /** Activity root contains `canEdit` field */
        canEdit: activity.get('canEdit'),
      }
    );

    /** Delete old `phoneNumber` from Activity assignees list. */
    conn.batch.delete(
      activities
        .doc(activity.id)
        .collection('Assignees')
        .doc(conn.requester.phoneNumber)
    );
  });

  cloneSubscriptions(conn);
};


/**
 * Fetches *all* the docs from `Activities` and `Subscriptions` from
 * the `Users/(requester phone number)` collection.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const fetchDocs = (conn) => {
  const userProfile = profiles.doc(conn.requester.phoneNumber);

  Promise
    .all([
      userProfile
        .collection('Activities')
        .get(),
      userProfile
        .collection('Subscriptions')
        .get(),
    ])
    .then((docsArray) => {
      conn.data.docsArray = docsArray;
      conn.data.timestamp = conn.data.timestamp;
      cloneActivities(conn, docsArray);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Updates the `Users` and `Updates` collections for the user with the
 * **new** phone number from the request body.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const updateDocs = (conn) => {
  conn.batch = db.batch();
  /** Stores temporary data throughout the code. */
  conn.data = {};

  conn.batch.set(
    profiles
      .doc(conn.req.body.phoneNumber), {
      uid: conn.requester.uid,
    }, {
      merge: true,
    }
  );

  conn.batch.set(
    updates
      .doc(conn.requester.uid), {
      phoneNumber: conn.req.body.phoneNumber,
    }, {
      merge: true,
    }
  );

  fetchDocs(conn);
};


/**
 * Revokes the current `idToken` of the user and updates their `phoneNumber`
 * in auth.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const updatePhoneNumberInAuth = (conn) => {
  Promise
    .all([
      /** Signs out the user by revoking their session token */
      revokeRefreshTokens(conn.requester.uid),

      updateUserPhoneNumberInAuth(
        /** Current `uid` */
        conn.requester.uid,
        /** New phoneNumber to set. */
        conn.req.body.phoneNumber
      ),
    ])
    .then(() => updateDocs(conn))
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
          'The Phone number is already in use.'
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
 * Verifies the request body to check if the a valid `phoneNumber`,
 * `timestamp` and `geopoint` are present.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
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

  if (!conn.req.body.hasOwnProperty('geopoint')) {
    sendResponse(
      conn,
      code.badRequest,
      `The geopoint is missing from the request body.`
    );

    return;
  }

  if (!isValidLocation(conn.req.body.geopoint)) {
    sendResponse(
      conn,
      code.badRequest,
      `The geopoint is not a valid latitude, longitude pair.`
    );

    return;
  }

  updatePhoneNumberInAuth(conn);
};


module.exports = app;
