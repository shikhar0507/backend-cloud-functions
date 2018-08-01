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
  serverTimestamp,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');

const { handleCanEdit, isValidRequestBody, } = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
  logDailyActivities,
} = require('../../admin/utils');


/**
 * Updates the timestamp in the activity root document.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateActivityDoc = (conn, locals) => {
  locals.batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
      timestamp: serverTimestamp,
    }, {
      merge: true,
    }
  );

  logDailyActivities(conn, locals, code.noContent);
};


/**
 * Adds the documents to batch for the users who have their `uid` populated
 * inside their profiles.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const createAddendumDoc = (conn, locals) => {
  locals.batch.set(rootCollections
    .addendumObjects
    .doc(), {
      activityId: conn.req.body.activityId,
      user: conn.requester.phoneNumber,
      location: getGeopointObject(conn.req.body.geopoint),
      comment: locals.comment,
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      timestamp: serverTimestamp,
    }
  );

  updateActivityDoc(conn, locals);
};


/**
 * Adds `addendum` for all the assignees of the activity.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const handleAssignees = (conn, locals) => {
  locals.comment = `${conn.requester.phoneNumber} shared this activity with: `;

  locals.assigneeArray.forEach((phoneNumber) => {
    locals.comment += `${phoneNumber}, `;

    /** Requester is not added to activity for `support` requests.
     */
    if (phoneNumber === conn.requester.phoneNumber
      && conn.requester.isSupportRequest) return;

    locals.batch.set(rootCollections
      .activities
      .doc(conn.req.body.activityId)
      .collection('Assignees')
      .doc(phoneNumber), {
        canEdit: handleCanEdit(
          locals,
          phoneNumber,
          conn.requester.phoneNumber
        ),
      }, {
        merge: true,
      }
    );
  });

  createAddendumDoc(conn, locals);
};


/**
 * Processes the `result` from the Firestore and saves the data to variables
 * for use in the function flow.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Array} result Docs fetched from Firestore.
 * @returns {void}
 */
const handleResult = (conn, result) => {
  const activityDoc = result[0];
  const assigneesArray = result[1];

  if (!activityDoc.exists) {
    sendResponse(
      conn,
      code.conflict,
      `No activity found with the id: ${conn.req.body.activityId}.`
    );

    return;
  }

  const locals = {
    batch: db.batch(),
    activity: result[0],
    canEditRule: result[0].get('canEditRule'),
    assigneeArray: [],
  };

  /** Activity is only created with valid phone numbers.
   * No validation is required here.
   */
  assigneesArray.forEach((doc) => locals.assigneeArray.push(doc.id));

  /** The `share` array from the request body may not
   * have all valid phone numbers.
   */
  conn.req.body.share.forEach((phoneNumber) => {
    if (!isE164PhoneNumber(phoneNumber)) return;

    locals.assigneeArray.push(phoneNumber);
  });

  handleAssignees(conn, locals);
};


/**
 * Fetches the activity doc, along with all the `assignees` of the activity
 * using the `activityId` from the `request body`.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
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
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));


/**
 * Checks if the requester has the permission to perform an update
 * to this activity. For this to happen, the `canEdit` flag is checked.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
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
        /** The `activity` doesn't exist for the user. */
        sendResponse(
          conn,
          code.notFound,
          `No activity found with the ID: '${conn.req.body.activityId}'.`
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


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'share');

  if (!result.isValidBody) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  /** The support person doesn't need to be an assignee
   * of the activity to make changes.
   */
  if (conn.requester.isSupportRequest) {
    fetchDocs(conn);

    return;
  }

  verifyEditPermission(conn);
};
