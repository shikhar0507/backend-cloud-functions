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


const { rootCollections, getGeopointObject, db, } = require('../../admin/admin');

const { isValidRequestBody, } = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  logDailyActivities,
} = require('../../admin/utils');


/**
 * Writes the `addendum` for all the `assignees` of the activity who have
 * signed up.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addAddendumForAssignees = (conn, locals) =>
  Promise
    .all(locals.assigneeDocPromises)
    .then((docsArray) => {
      /** Adds addendum for all the users who have signed up via auth. */
      docsArray.forEach((doc) => {
        if (!doc.get('uid')) return;

        locals.batch.set(rootCollections
          .updates
          .doc(doc.get('uid'))
          .collection('Addendum')
          .doc(),
          locals.addendum
        );
      });

      logDailyActivities(conn, locals, code.noContent);

      return;
    })
    .catch((error) => handleError(conn, error));


/**
 * Updates the `status` field in the activity root.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateActivityStatus = (conn, locals) => {
  locals.batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
      status: conn.req.body.status,
      timestamp: locals.timestamp,
    }, {
      merge: true,
    }
  );

  locals.addendum.comment = `${conn.requester.phoneNumber} updated the activity`
    + ` status to ${conn.req.body.status}.`;

  addAddendumForAssignees(conn, locals);
};


/**
 * Processes the `result` from the Firestore and saves the data to variables
 * for use in the function flow.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Array} result Array of Documents fetched from Firestore.
 * @returns {void}
 */
const handleResults = (conn, result) => {
  if (!result[0].exists) {
    /** This is the second time we are checking if the activity document
     * exists. This is so, because for the `support` requests, the activity
     * document might not exist in the user's profile. But, in some cases,
     * the activity with the ID from the request body might not itself exist.
     */
    sendResponse(
      conn,
      code.notFound,
      `No activity found with the id: ${conn.req.body.activityId}.`
    );

    return;
  }

  const locals = {};
  locals.batch = db.batch();

  /** Calling new `Date()` constructor multiple times is wasteful. */
  locals.timestamp = new Date(conn.req.body.timestamp);
  locals.activity = result[0];

  if (conn.req.body.status === locals.activity.get('status')) {
    sendResponse(
      conn,
      code.conflict,
      `The activity status is already ${conn.req.body.status}.`
    );

    return;
  }

  locals.assigneeDocPromises = [];

  /** The Assignees list is required to add addendum. */
  result[1].forEach((doc) => {
    locals.assigneeDocPromises.push(rootCollections.profiles.doc(doc.id).get());

    locals.batch.set(rootCollections
      .profiles
      .doc(doc.id)
      .collection('Activities')
      .doc(conn.req.body.activityId), {
        timestamp: locals.timestamp,
      }, {
        merge: true,
      }
    );
  });

  if (result[2].get('ACTIVITYSTATUS').indexOf(conn.req.body.status) === -1) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.status} is not a valid status.`
      + ` Use one of the following values: ${result[2].get('ACTIVITYSTATUS')}.`
    );

    return;
  }

  /** The `comment` field will be added later. */
  locals.addendum = {
    activityId: conn.req.body.activityId,
    user: conn.requester.phoneNumber,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: locals.timestamp,
  };

  updateActivityStatus(conn, locals);
};


/**
 * Fetches the activity, assignees and the activity status docs from
 * the Firestore.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const fetchDocs = (conn) =>
  Promise
    .all([
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .get(),
      rootCollections
        .enums
        .doc('ACTIVITYSTATUS')
        .get(),
    ])
    .then((result) => handleResults(conn, result))
    .catch((error) => handleError(conn, error));


/**
 * Checks if the *requester* has the *permission* to *edit* the activity
 * during an update.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const verifyEditPermission = (conn) =>
  rootCollections
    .profiles
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
          `No activity found with the id: ${conn.req.body.activityId}.`
        );

        return;
      }

      if (!doc.get('canEdit')) {
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


/**
 * Validates the request body to check if it contains a valid `timestamp`,
 * `activityId`, `status` and the `geopoint`.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'change-status');

  if (!result.isValidBody) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
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
