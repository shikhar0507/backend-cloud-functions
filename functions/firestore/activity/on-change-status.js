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

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  getISO8601Date,
  isValidDate,
  isNonEmptyString,
  isValidGeopoint,
} = require('../../admin/utils');



/**
 * Commits the batch to write the documents added to the batch atomically.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {Promise} Batch object
 */
const commitBatch = (conn, locals) =>
  locals.batch.commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));


/**
 * Adds a doc in `/DailyActivities` collection in the path:
 * `/(office name)/(template name)` with the user's phone number,
 * timestamp of the request and the api used.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateDailyActivities = (conn, locals) => {
  const docId = getISO8601Date(locals.timestamp);

  locals.batch.set(rootCollections
    .dailyActivities
    .doc(docId)
    .collection('Logs')
    .doc(), {
      office: locals.activity.get('office'),
      timestamp: locals.timestamp,
      template: locals.activity.get('template'),
      phoneNumber: conn.requester.phoneNumber,
      url: conn.req.url,
      activityId: conn.req.body.activityId,
      geopoint: getGeopointObject(conn.req.body.geopoint),
    });

  commitBatch(conn);
};


/**
 * Writes the `addendum` for all the `assignees` of the activity who have
 * signed up.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addAddendumForAssignees = (conn, locals) => {
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
          conn.addendum
        );
      });

      updateDailyActivities(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


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

  addAddendumForAssignees(conn);
};


/**
 * Fetches the template from reading the name from the activity root
 * document.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const fetchTemplate = (conn, locals) => {
  rootCollections
    .activityTemplates
    // .doc(conn.data.activity.get('template'))
    .doc(locals.activity.get('template'))
    .get()
    .then((doc) => {
      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: `${conn.requester.displayName || conn.requester.phoneNumber}`
          + ` updated ${doc.get('defaultTitle')}.`,
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: locals.timestamp,
      };

      updateActivityStatus(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
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

  if (
    result[2]
      .get('ACTIVITYSTATUS')
      .indexOf(conn.req.body.status) === -1
  ) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.status} is NOT a valid status from the template.`
    );

    return;
  }

  fetchTemplate(conn, locals);
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
};


/**
 * Checks if the *requester* has the *permission* to *edit* the activity
 * during an update.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const verifyEditPermission = (conn) => {
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
  return isNonEmptyString(body.activityId)
    && isValidDate(body.timestamp)
    && isValidGeopoint(body.geopoint)
    && isNonEmptyString(body.status);
};


/**
 * Validates the request body to check if it contains a valid `timestamp`,
 * `activityId`, `status` and the `geopoint`.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
module.exports = (conn) => {
  if (!isValidRequestBody(conn.req.body)) {
    sendResponse(
      conn,
      code.badRequest,
      'Invalid request body.'
      + ' Make sure to include the "activityId" (string), "timestamp" (long number)'
      + ' "geopoint" (object) and the "status" (string) in the request body.'
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
