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
  serverTimestamp,
} = require('../../admin/admin');

const { isValidRequestBody, } = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
  logDailyActivities,
} = require('../../admin/utils');


/**
 * Updates the `timestamp` field in the main `activity` document.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
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

  /** Logs the activity and sends a response to the client. */
  logDailyActivities(conn, locals, code.noContent);
};


/**
 * Updates the linked doc in the `docRef` field in the activity based on
 * the template name.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateLinkedDoc = (conn, locals) =>
  db
    .doc(locals.activity.get('docRef'))
    .get()
    .then((doc) => {
      const docData = doc.data();

      if (locals.activity.get('template') === 'subscription') {
        const includeArray = doc.get('include');

        includeArray.forEach((phoneNumber) => {
          const index = conn.req.body.remove.indexOf(phoneNumber);

          if (index > -1) {
            includeArray.splice(index, 1);
          }
        });

        docData.include = includeArray;
      }

      if (locals.activity.get('template') === 'report') {
        const toArray = doc.get('to');

        toArray.forEach((phoneNumber) => {
          const index = conn.req.body.remove.indexOf(phoneNumber);

          if (index > -1) {
            toArray.splice(index, 1);
          }

          docData.to = toArray;
        });
      }

      locals.batch.set(locals
        .activity
        .get('docRef'),
        docData
      );

      updateActivityDoc(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


/**
 * Handles the special case when the template name is 'report' or
 * 'subscription'.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const handleSpecialTemplates = (conn, locals) => {
  if (['subscription', 'report',]
    .indexOf(locals.activity.get('template')) > -1) {
    updateLinkedDoc(conn, locals);

    return;
  }

  updateActivityDoc(conn, locals);
};


/**
 * Creates a document in the path: `/AddendumObjects/(auto-id)`.
 * This will trigger an auto triggering cloud function which will
 * copy this addendum to ever assignee's `/Updates/(uid)/Addendum(auto-id)`
 * doc.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
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

  handleSpecialTemplates(conn, locals);
};


/**
 * Removes the user's from the activity which have been sent in the
 * request body field 'remove'.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const unassignFromTheActivity = (conn, locals) => {
  let index;
  locals.comment = `${conn.requester.phoneNumber} unassigned `;

  locals.validPhoneNumbers = [];

  conn.req.body.remove.forEach((phoneNumber) => {
    if (!isE164PhoneNumber(phoneNumber)) return;

    locals.comment += `${phoneNumber} `;

    locals.validPhoneNumbers.push(phoneNumber);

    /** Deleting from `Assignees` collection inside activity doc */
    locals.batch.delete(rootCollections
      .activities
      .doc(conn.req.body.activityId)
      .collection('Assignees')
      .doc(phoneNumber)
    );

    /** Deleting from `Activities` collection inside user Profile */
    locals.batch.delete(rootCollections
      .profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId)
    );

    index = locals.assigneeArray.indexOf(phoneNumber);

    if (index > -1) {
      locals.assigneeArray.splice(index, 1);
    }
  });

  locals.addendum.comment = `${locals.comment}from the activity.`;

  createAddendumDoc(conn, locals);
};


/**
 * Fetches the template document from the template and validates
 * the request body using it.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const fetchTemplate = (conn, locals) => {
  const template = locals.activity.get('template');

  rootCollections
    .activityTemplates
    .doc(template)
    .get()
    .then((doc) => {
      locals.template = doc;
      unassignFromTheActivity(conn, locals);

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
const handleResult = (conn, result) => {
  if (!result[0].exists) {
    /** This case should probably never execute because there is NO provision
     * for deleting an activity anywhere. AND, for reaching the `fetchDocs()`
     * function, the check for the existence of the activity has already
     * been performed in the `Profiles/(phoneNumber)/Activities(activity-id)`.
     */
    sendResponse(
      conn,
      code.conflict,
      `No activity found with the id: ${conn.req.body.activityId}.`
    );

    return;
  }

  /** Assignees collection in the `Activity/(doc-id)/Assignees` */
  if (result[1].size === 1) {
    /** An activity cannot exist with zero assignees. The person
     * last to stay cannot remove themselves.
     */
    sendResponse(
      conn,
      code.forbidden,
      `Cannot remove the last assignee of the activity.`
    );

    return;
  }

  /** Object for storing local data. */
  const locals = {};

  locals.batch = db.batch();
  locals.activity = result[0];

  /** The `assigneeArray` is required to add addendum.
   * The `doc.id` is the phoneNumber of the assignee.
   */
  locals.assigneeArray = [];
  result[1].forEach((doc) => locals.assigneeArray.push(doc.id));

  if (locals.assigneeArray.length === 1) {
    sendResponse(
      conn,
      code.conflict,
      `Cannot remove the last assignee of this activity.`
    );

    return;
  }

  fetchTemplate(conn, locals);
};


/**
 * Fetches the activity and it's assignees using the `activityId` from
 * the request body.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
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
 * Checks if the requester has edit permissions to the activity.
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
        /** The activity does not exist in the system (OR probably
         * only for the user). */
        sendResponse(
          conn,
          code.notFound,
          `No activity found with the id: '${conn.req.body.activityId}'.`
        );

        return;
      }

      if (!doc.get('canEdit')) {
        /** The `canEdit` flag is false so update is forbidden. */
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
  const result = isValidRequestBody(conn.req.body, 'remove');

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
