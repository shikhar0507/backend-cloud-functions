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
  users,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');

const { code, } = require('../../admin/responses');

const {
  handleCanEdit,
  filterSchedules,
  filterVenues,
  filterAttachment,
  isValidRequestBody,
} = require('./helper');

const {
  handleError,
  sendResponse,
  isNonEmptyString,
  isE164PhoneNumber,
  logDailyActivities,
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
    .doc(), {
      activityId: locals.activityRef.id,
      user: conn.requester.phoneNumber,
      comment: `${conn.requester.phoneNumber}`
        + ` created ${locals.template.defaultTitle}.`,
      location: getGeopointObject(conn.req.body.geopoint),
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      timestamp: serverTimestamp,
    }
  );

  /**
   * Ends the response by committing the batch and logging
   *  the activity data to the `DailyActivities` collection.
   */
  logDailyActivities(conn, locals, code.created);
};


/**
 * Adds docs for each assignee of the activity to the batch.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const handleAssignedUsers = (conn, locals) => {
  /** The list of assignees *NEEDS* to be an array. */
  if (!Array.isArray(conn.req.body.share)) {
    if (locals.include.length === 0) {
      sendResponse(
        conn,
        code.conflict,
        'Cannot create an activity with zero assignees.'
        + ' Please include someone.'
      );

      return;
    }

    createAddendumDoc(conn, locals, code.created);

    return;
  }

  /**
   * When the include array from subscription is empty, AND the
   * `share` array from the request body is also empty, the activity
   * will be created with no assignees.
   * That's not allowed since, no assignee means that it will not reach anyone
   * in a read request.
   */
  if (locals.include.length === 0
    && conn.req.body.share.length === 0) {
    sendResponse(
      conn,
      code.conflict,
      'Cannot create an activity with zero assignees.'
      + ' Please include someone.'
    );

    return;
  }

  /** Create docs in `Assignees` collection if share is in the request body. */
  conn.req.body.share.forEach((phoneNumber) => {
    if (!isE164PhoneNumber(phoneNumber)) return;

    /**
     * The requester shouldn't be added to the activity assignee list
     * if the request is of `support` type.
     */
    if (phoneNumber === conn.requester.phoneNumber
      && conn.requester.isSupportRequest) return;

    const canEdit = handleCanEdit(
      locals,
      phoneNumber,
      conn.requester.phoneNumber,
      conn.req.body.share
    );

    locals.batch.set(rootCollections
      .activities
      .doc(locals.activityRef.id)
      .collection('Assignees')
      .doc(phoneNumber), { canEdit, }, { merge: true, });
  });

  createAddendumDoc(conn, locals, code.created);
};


/**
 * Adds the activity to each user's profile from the `include` array.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addAssigneesFromInclude = (conn, locals) => {
  /**
   * The 'include' array will always have the requester
   * phone number, therefore not adding user's number to the batch
   * explicitly.
   */
  locals.include.forEach((phoneNumber) => {
    /**
     * The `include` array will never have the
     * requester's phone number itself.
     **/
    const canEdit = handleCanEdit(
      locals,
      phoneNumber,
      conn.requester.phoneNumber,
      conn.req.body.share
    );

    locals.batch.set(rootCollections
      .activities
      .doc(locals.activityRef.id)
      .collection('Assignees')
      .doc(phoneNumber), { canEdit, });
  });

  handleAssignedUsers(conn, locals);
};


/**
 * Adds activity root doc to batch.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const createActivityRoot = (conn, locals) => {
  const activityRoot = {
    /**
     * The rule is stored here to avoid reading
     * `subscriptions` for activity updates.
     */
    canEditRule: locals.template.canEditRule,
    timestamp: serverTimestamp,
    status: locals.template.statusOnCreate,
    office: conn.req.body.office,
    template: conn.req.body.template,
    venue: locals.venue,
    schedule: locals.schedule,
    attachment: conn.req.body.attachment || {},
    docRef: locals.docRef,
  };

  if (!conn.req.body.hasOwnProperty('title')) {
    activityRoot.tile = locals.template.defaultTitle;
  }

  if (isNonEmptyString(conn.req.body.title)) {
    activityRoot.title = conn.req.body.title;
  }

  locals.batch.set(locals.activityRef, activityRoot);

  addAssigneesFromInclude(conn, locals);
};


/**
 * Validates the attachment and sends a response message if something is
 * invalid.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const handleAttachment = (conn, locals) => {
  const result = filterAttachment(conn, locals);

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  if (!result.promise) {
    createActivityRoot(conn, locals);

    return;
  }

  result
    .promise
    .then((snapShot) => {
      if (!snapShot.empty) {
        const value = conn.req.body.attachment.Name.value;
        const type = conn.req.body.attachment.Name.type;
        const message = `'${value}' already exists in the office`
          + ` ${conn.req.body.office} with the template ${type}.`;

        sendResponse(
          conn,
          code.conflict,
          message
        );

        return;
      }

      createActivityRoot(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Adds a *new* office to the `Offices` collection.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const handleOfficeTemplate = (conn, locals) => {
  if (!locals.office.empty) {
    sendResponse(
      conn,
      code.conflict,
      `Office: ${conn.req.body.office} already exists.`
    );

    return;
  }

  locals.docRef = rootCollections.offices.doc(locals.activityRef.id);

  handleAttachment(conn, locals);
};


/**
 * Creates a *new* document inside the `Offices/(office-id)/` path based on
 * the template and `activity-id`.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addChildToOffice = (conn, locals) => {
  if (locals.office.empty) {
    sendResponse(
      conn,
      code.badRequest,
      `The office: "${conn.req.body.office}" does not exist.`
    );

    return;
  }

  const officeRef = locals.result[2].docs[0];

  if (officeRef.get('status') === 'CANCELLED') {
    sendResponse(
      conn,
      code.forbidden,
      `This office's status is ${officeRef.get('status')}.`
      + ` Cannot use create ${conn.req.body.template}.`
    );

    return;
  }


  locals.docRef = rootCollections
    .offices
    .doc(officeRef.id)
    .collection('Activities')
    .doc(locals.activityRef.id);

  handleAttachment(conn, locals);
};



const handleAdminTemplate = (conn, locals) => {
  const phoneNumber = conn.req.body.attachment.phoneNumber.value;

  if (!isE164PhoneNumber(phoneNumber)) {
    sendResponse(
      conn,
      code.badRequest,
      `'${phoneNumber}' is not a valid phone number.`
    );

    return;
  }

  users
    .getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      const phoneNumber = Object.keys(userRecord)[0];
      const record = userRecord[`${phoneNumber}`];

      if (!record.uid) {
        sendResponse(
          conn,
          code.forbidden,
          `Cannot grant admin rights to a user who has not signed up.`
        );

        return;
      }

      addChildToOffice(conn, locals);

      return;
    }).catch((error) => handleError(conn, error));
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
  /** A template with the name from the request body doesn't exist. */
  if (result[0].empty) {
    sendResponse(
      conn,
      code.badRequest,
      `Template: ${conn.req.body.template} does not exist.`
    );

    return;
  }

  const template = result[0].docs[0].data();
  const subscription = result[1];

  /** Object for storing local data. */
  const locals = {
    /** Temporary fallback for testing some cases */
    docRef: null,
    template,
    /** A reference of the batch and the activity instance will be used
     * multiple times throughout the activity creation.
     */
    activityRef: rootCollections.activities.doc(),
    batch: db.batch(),
    /** Used by `handleCanEdit` method for getting the `canEdit` permission.
     * In support requests, the subscription doc **may** not exist. For those
     * cases an empty array is a fallback.
     */
    include: [],
    office: result[2],
    schedule: filterSchedules(
      conn.req.body.schedule,
      /** The `schedule` object from the template. */
      template.schedule
    ),
    venue: filterVenues(
      conn.req.body.venue,
      /** The `venue` object from the template. */
      template.venue
    ),
  };

  /** Subscription may not exist for support requests. */
  if (!subscription.empty) {
    locals.include = subscription.docs[0].get('include');
  }

  if (!conn.requester.isSupportRequest) {
    if (subscription.empty) {
      /** The template with that field does not exist in the user's
       * subscriptions. This probably means that they are either
       * not subscribed to the template that they requested
       * to create the activity with, OR the template with
       * that `name` simply does not exist.
       */
      sendResponse(
        conn,
        code.forbidden,
        `No subscription found for the template: ${conn.req.body.template}.`
      );

      return;
    }

    /** Forbidden to use a `cancelled` subscription. */
    if (subscription.docs[0].get('status') === 'CANCELLED') {
      sendResponse(
        conn,
        code.forbidden,
        `Your subscription to the template ${conn.req.body.template} is`
        + ` '${subscription.docs[0].get('status')}'.`
      );

      return;
    }
  }

  if (conn.req.body.template === 'office') {
    handleOfficeTemplate(conn, locals);

    return;
  }

  if (conn.req.body.template === 'admin') {
    handleAdminTemplate(conn, locals);

    return;
  }

  addChildToOffice(conn, locals);
};


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'create');

  if (!result.isValidBody) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .where('template', '==', conn.req.body.template)
        .where('office', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections
        .offices
        .where('name', '==', conn.req.body.office)
        .limit(1)
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};
