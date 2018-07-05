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
  rootCollections,
  getGeopointObject,
  db,
} = require('../../admin/admin');

const {
  handleError,
  sendResponse,
  getFormattedDate,
} = require('../../admin/utils');

const {
  isValidDate,
  isValidString,
  isValidLocation,
} = require('./helper');

const {
  code,
} = require('../../admin/responses');

const {
  activities,
  profiles,
  updates,
  activityTemplates,
  enums,
  dailyActivities,
} = rootCollections;


/**
 * Commits the batch to write the documents added to the batch atomically.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {Promise} Batch object
 */
const commitBatch = (conn) =>
  conn.batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));


/**
 * Adds a doc in `/DailyActivities` collection in the path:
 * `/(office name)/(template name)` with the user's phone number,
 * timestamp of the request and the api used.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const updateDailyActivities = (conn) => {
  const timestamp = conn.data.timestamp;

  const office = conn.data.activity.get('office');

  const dailyActivitiesDoc = dailyActivities
    .doc(getFormattedDate(timestamp))
    .collection(office)
    .doc();

  conn.batch.set(dailyActivitiesDoc, {
    template: conn.data.activity.get('template'),
    phoneNumber: conn.requester.phoneNumber,
    url: conn.req.url,
    activityId: conn.req.body.activityId,
  });

  commitBatch(conn);
};


/**
 * Creates a doc inside `/Profiles/(phoneNumber)/Map` for tracking location
 * history of the user.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
*/
const logLocation = (conn) => {
  const mapDoc = profiles
    .doc(conn.requester.phoneNumber)
    .collection('Map')
    .doc();

  const data = {
    activityId: conn.req.body.activityId,
    geopoint: getGeopointObject(conn.req.body.geopoint),
    timestamp: conn.data.timestamp,
    office: conn.data.activity.get('office'),
    template: conn.data.activity.get('template'),
  };

  conn.batch.set(mapDoc, data);

  updateDailyActivities(conn);
};


/**
 * Writes the `addendum` for all the `assignees` of the activity who have
 * signed up.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const addAddendumForAssignees = (conn) => {
  Promise
    .all(conn.data.assignees)
    .then((docsArray) => {
      /** Adds addendum for all the users who have signed up via auth. */
      docsArray.forEach((doc) => {
        if (!doc.get('uid')) return;

        conn.batch.set(
          updates
            .doc(doc.get('uid'))
            .collection('Addendum')
            .doc(),
          conn.addendum
        );
      });

      logLocation(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Updates the `status` field in the activity root.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const updateActivityStatus = (conn) => {
  conn.batch.set(
    activities
      .doc(conn.req.body.activityId), {
      status: conn.req.body.status,
      timestamp: conn.data.timestamp,
    }, {
      merge: true,
    }
  );

  addAddendumForAssignees(conn);
};


/**
 * Fetches the template from reading the name from the activity root
 * document.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const fetchTemplate = (conn) => {
  activityTemplates
    .doc(conn.data.activity.get('template'))
    .get()
    .then((doc) => {
      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: `${conn.requester.displayName || conn.requester.phoneNumber}`
          + ` updated ${doc.get('defaultTitle')}.`,
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: conn.data.timestamp,
      };

      updateActivityStatus(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the activity, assignees and the activity status docs from
 * the Firestore.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const fetchDocs = (conn) => {
  Promise
    .all([
      activities
        .doc(conn.req.body.activityId)
        .get(),
      activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .get(),
      enums
        .doc('ACTIVITYSTATUS')
        .get(),
    ])
    .then((result) => {
      if (!result[0].exists) {
        /** This case should probably never execute becase there is provision
         * for deleting an activity anywhere. AND, for reaching the fetchDocs()
         * function, the check for the existance of the activity has already
         * been performed in the User's profile.
         */
        sendResponse(
          conn,
          code.conflict,
          `There is no activity with the id: ${conn.req.body.activityId}.`
        );

        return;
      }

      conn.batch = db.batch();
      conn.data = {};

      /** Calling new `Date()` constructor multiple times is wasteful. */
      conn.data.timestamp = new Date(conn.req.body.timestamp);
      conn.data.assignees = [];
      conn.data.activity = result[0];

      if (conn.req.body.status === conn.data.activity.get('status')) {
        sendResponse(
          conn,
          code.conflict,
          `The activity status is already ${conn.req.body.status}.`
        );

        return;
      }

      /** The Assignees list is required to add addendum. */
      result[1].forEach((doc) => {
        conn.data.assignees.push(profiles.doc(doc.id).get());

        conn.batch.set(
          profiles
            .doc(doc.id)
            .collection('Activities')
            .doc(conn.req.body.activityId), {
            timestamp: conn.data.timestamp,
          }, {
            merge: true,
          }
        );
      });

      if (result[2].get('ACTIVITYSTATUS').indexOf(conn.req.body.status) === -1) {
        sendResponse(
          conn,
          code.badRequest,
          `${conn.req.body.status} is NOT a valid status from the template.`
        );

        return;
      }

      fetchTemplate(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Checks if the *requester* has the *permission* to *edit* the activity
 * during an update.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const verifyEditPermission = (conn) => {
  profiles
    .doc(conn.requester.phoneNumber)
    .collection('Activities')
    .doc(conn.req.body.activityId)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        /** The activity doesn't exist for the user */
        sendResponse(
          conn,
          code.notFound,
          `An activity with the id: ${conn.req.body.activityId} doesn't exist.`
        );

        return;
      }

      if (!doc.get('canEdit')) {
        /** The `canEdit` flag is false so updating is not allowed */
        sendResponse(
          conn,
          code.forbidden,
          'You do not have the permission to edit this activity.'
        );

        return;
      }

      fetchDocs(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Checks if the request body has `ALL` the *required* fields like `activityId`,
 * `timestamp`, `geopoint`, and `status`.
 *
 * @param {Object} body The request body.
 * @returns {boolean} If the request body has valid fields.
 */
const isValidRequestBody = (body) => {
  return isValidString(body.activityId)
    && isValidDate(body.timestamp)
    && isValidLocation(body.geopoint)
    && isValidString(body.status);
};


/**
 * Validates the request body to check if it contains a valid `timestamp`,
 * `activityId`, `status` and the `geopoint`.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const app = (conn) => {
  if (!isValidRequestBody(conn.req.body)) {
    sendResponse(
      conn,
      code.badRequest,
      `Request body is invalid. Make sure that the 'activityId', 'timestamp',`
      + ` 'geopoint' and the 'status' fields are present in the request body.`
    );

    return;
  }

  /** The `support` person doesn't need to be an assignee
   * of the activity to make changes.
   */
  if (conn.requester.isSupportRequest) {
    fetchDocs(conn);

    return;
  }

  verifyEditPermission(conn);
};


module.exports = app;
