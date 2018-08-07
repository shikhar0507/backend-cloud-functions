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

const {
  filterSchedules,
  filterVenues,
  filterAttachment,
  isValidRequestBody,
} = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  isNonEmptyString,
} = require('../../admin/utils');


/**
 * Creates a document in the path: `/AddendumObjects/(auto-id)`.
 * This will trigger an auto triggering cloud function which will
 * copy this addendum to ever assignee's `/Updates/(uid)/Addendum(auto-id)`
 * doc.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const createAddendumDoc = (conn, locals) => {
  locals.batch.set(rootCollections
    .addendumObjects
    .doc(),
    locals.addendum
  );

  locals
    .batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


/**
 * Updates the activity root and adds the data to the batch.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateActivityDoc = (conn, locals) => {
  /** Stores the objects that are to be updated in the activity root. */
  const activityUpdates = {};

  locals.addendum.comment = `${locals.addendum.user} updated the activity`;

  if (conn.req.body.hasOwnProperty('activityName')
    && isNonEmptyString(conn.req.body.activityName)) {
    locals.addendum.comment += ' activityName, ';
    activityUpdates.activityName = conn.req.body.activityName;
  }

  if (conn.req.body.hasOwnProperty('schedule')) {
    const scheduleNames = new Set();
    locals.addendum.comment += ' schedule, ';

    locals
      .activity
      .get('schedule')
      .forEach((scheduleObject) => scheduleNames.add(scheduleObject.name));

    activityUpdates.schedule = filterSchedules(
      conn.req.body.schedule,
      [...scheduleNames,]
    );
  }

  if (conn.req.body.hasOwnProperty('venue')) {
    locals.addendum.comment += ' venue ';
    const venueNames = new Set();

    locals
      .activity
      .get('venue')
      .forEach((venueObject) => venueNames.add(venueObject.venueDescriptor));

    activityUpdates.venue = filterVenues(
      conn.req.body.venue,
      [...venueNames,]
    );
  }

  activityUpdates.timestamp = serverTimestamp;

  locals.batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId),
    activityUpdates, {
      /** The activity doc *will* have some of these fields by default. */
      merge: true,
    }
  );

  createAddendumDoc(conn, locals);
};


/**
 * Manages the attachment object.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Fields for the activity root object.
 * @returns {void}
 */
const handleAttachment = (conn, locals) => {
  if (!locals.activity.get('docRef')) {
    updateActivityDoc(conn, locals);

    return;
  }

  if (!conn.req.body.hasOwnProperty('attachment')) {
    updateActivityDoc(conn, locals);

    return;
  }

  const attachmentDocRef = db.doc(locals.activity.get('attachment'));
  const templateName = locals.activity.get('template');

  rootCollections
    .activityTemplates
    .doc(templateName)
    .get()
    .then((doc) => {
      const updatedFields = filterAttachment(
        conn.req.body.attachment,
        doc.get('attachment')
      );

      locals.batch.set(
        attachmentDocRef,
        updatedFields, {
          merge: true,
        }
      );

      updateActivityDoc(conn, locals);

      return;
    })
    .catch((error) => handleAttachment(conn, error));
};


/**
 * Updates the activity `timestamp` field for all the assignees
 * of the activity.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateActivityTimestamp = (conn, locals) => {
  locals.assigneePhoneNumberArray.forEach((phoneNumber) => {
    locals.batch.set(rootCollections
      .profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId), {
        timestamp: serverTimestamp,
      }, {
        merge: true,
      }
    );
  });

  handleAttachment(conn, locals);
};


/**
 * Checks if the activity doc exists and creates an array
 * of promises for all assignees.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} result Array of Documents fetched from Firestore.
 * @returns {void}
 */
const handleResult = (conn, result) => {
  const activityDoc = result[0];
  const assigneeDocsArray = result[1];

  if (!activityDoc.exists) {
    /** This case should probably never execute because there is provision
     * for deleting an activity anywhere. AND, for reaching the fetchDocs()
     * function, the check for the existence of the activity has already
     * been performed in the User's profile.
     */
    sendResponse(
      conn,
      code.conflict,
      `This activity (${conn.req.body.activityId}) does not exist.`
    );

    return;
  }

  /** For storing local data during the flow. */
  const locals = {
    batch: db.batch(),
    activity: result[0],
    assigneePhoneNumberArray: [],
    addendum: {
      timestamp: serverTimestamp,
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      activityId: conn.req.body.activityId,
      user: conn.requester.phoneNumber,
      location: getGeopointObject(conn.req.body.geopoint),
    },
  };

  assigneeDocsArray
    .forEach((doc) => locals.assigneePhoneNumberArray.push(doc.id));

  updateActivityTimestamp(conn, locals);
};


/**
 * Fetches the activity, and its assignees from the DB.
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
 * Checks if the user has permission to update the activity data.
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
        /** The activity doesn't exist for the user */
        sendResponse(
          conn,
          code.forbidden,
          `This activity (${conn.req.body.activityId}) does not exist.`
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
  const result = isValidRequestBody(conn.req.body, 'update');

  if (!result.isValidBody) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  if (conn.requester.isSupportRequest) {
    fetchDocs(conn);

    return;
  }

  verifyEditPermission(conn);
};
