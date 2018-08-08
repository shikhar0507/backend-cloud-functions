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
  validateVenues,
  getCanEditValue,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
} = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  isNonEmptyString,
} = require('../../admin/utils');


const createDocsWithBatch = (conn, locals) => {
  locals.batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId),
    locals.activityUpdates, { merge: true, });

  locals.batch.set(rootCollections
    .offices
    .doc(locals.activityDocRef.get('officeId'))
    .collection('Addendum')
    .doc(), {
      timestamp: serverTimestamp,
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      activityId: conn.req.body.activityId,
      user: conn.requester.phoneNumber,
      location: getGeopointObject(conn.req.body.geopoint),
      comment: locals.comment,
    });

  /** ENDS the request. */
  locals
    .batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};

const handleAssignees = (conn, locals) => {
  // TODO: Fetch docs from Offices to see which users are employees and 
  // which ones are admin.
  createDocsWithBatch(conn, locals);
};

const queryForNameInOffices = (conn, locals, promise) =>
  promise
    .then((snapShot) => {
      if (!snapShot.empty) {
        const value = conn.req.body.attachment.Name.value;
        const type = conn.req.body.attachment.Name.type;
        const message = `'${value}' already exists in the office`
          + ` '${conn.req.body.office}' with the template '${type}'.`;

        sendResponse(conn, code.conflict, message);

        return;
      }

      handleAssignees(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));



const handleExtra = (conn, locals) => {
  if (conn.req.body.hasOwnProperty('schedule')) {
    const names = [];

    locals
      .activityDocRef
      .get('schedule')
      .forEach((object) => names.push(object.name));

    const result = validateSchedules(conn.req.body.schedule, names);

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    locals.addendum.comment += ' schedule,';
    locals.updatedFields.schedule = conn.req.body.schedule;
  }

  if (conn.req.body.hasOwnProperty('venue')) {
    const descriptors = [];

    locals
      .activityDocRef
      .get('venue')
      .forEach((object) => descriptors.push(object.descriptor));

    const result = validateVenues(conn.req.body.venue, descriptors);

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    locals.addendum.comment += ' venue,';
    locals.updatedFields.venue = conn.req.body.venue;
  }

  if (conn.req.body.hasOwnProperty('attachment')) {
    const attachmentValid = filterAttachment(conn.req.body, locals);

    if (!attachmentValid.isValid) {
      sendResponse(conn, code.badRequest, attachmentValid.message);

      return;
    }

    attachmentValid
      .phoneNumbers
      .forEach((phoneNumber) => locals.allPhoneNumbers.add(phoneNumber));

    locals
      .allPhoneNumbers
      .forEach((phoneNumber) => locals.permissions[phoneNumber] = {
        isAdmin: false,
        isEmployee: false,
        isCreator: conn.requester.phoneNumber === phoneNumber,
      });

    if (!attachmentValid.promise) {
      handleAssignees(conn, locals);

      return;
    }

    queryForNameInOffices(conn, locals);
  }

  handleAssignees(conn, locals);
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
  const [
    activityDocRef,
    assigneesCollectionRef,
  ] = result;

  if (!activityDocRef.exists) {
    sendResponse(
      conn,
      code.conflict,
      `No activity found with the id: '${conn.req.body.activityId}'.`
    );

    return;
  }

  /** For storing local data during the flow. */
  const locals = {
    activityDocRef,
    canEditRule: activityDocRef.get('canEditRule'),
    batch: db.batch(),
    permissions: {},
    allPhoneNumbers: [],
    comment: `${conn.requester.phoneNumber} update the activity`,
    /** Stores the objects that are to be updated in the activity root. */
    updatedFields: { timestamp: serverTimestamp, },
  };

  if (conn.req.body.hasOwnProperty('activityName')) {
    if (!isNonEmptyString(conn.req.body.activityName)) {
      sendResponse(
        conn,
        code.badRequest,
        `The 'activityName' field should be a non-empty string.`
      );

      return;
    }

    locals.addendum.comment += ' activityName, ';
    locals.activityUpdates.activityName = conn.req.body.activityName;
  }

  assigneesCollectionRef
    .forEach((doc) => locals.allPhoneNumbers.push(doc.id));

  handleExtra(conn, locals);
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
        sendResponse(
          conn,
          code.forbidden,
          `No activity found with the id: '${conn.req.body.activityId}'.`
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
