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

const { handleCanEdit, filterSchedules, filterVenues, filterAttachment, } = require('./helper');

const {
  isValidDate,
  handleError,
  sendResponse,
  getISO8601Date,
  isValidGeopoint,
  isNonEmptyString,
  isE164PhoneNumber,
} = require('../../admin/utils');


/**
 * Commits the batch and sends a response to the client.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {Promise} Doc metadata or error object.
 */
const commitBatch = (conn, locals) =>
  locals.batch.commit()
    .then(() => sendResponse(
      conn,
      code.created,
      'The activity was successfully created.'
    ))
    .catch((error) => handleError(conn, error));


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
        'Cannot create an activity with zero assignees. Make sure to include someone.'
      );

      return;
    }

    commitBatch(conn, locals);

    return;
  }

  /** When the include array from subscription is empty, AND the
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
      'Cannot create an activity with zero assignees. Make sure to include someone.'
    );

    return;
  }

  const promises = [];

  /** Create docs in Assignees collection if share is in the request body. */
  conn.req.body.share.forEach((phoneNumber) => {
    if (!isE164PhoneNumber(phoneNumber)) return;

    /** The requester shouldn't be added to the activity assignee list
     * if the request is of `support` type.
     */
    if (phoneNumber === conn.requester.phoneNumber
      && conn.requester.isSupportRequest) return;

    /** The phone numbers exist uniquely in the `/Profiles` collection. */
    promises.push(rootCollections.profiles.doc(phoneNumber).get());

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
      .doc(phoneNumber), { canEdit, }, {
        merge: true,
      });

    locals.batch.set(rootCollections
      .profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(locals.activityRef.id), {
        canEdit,
        timestamp: locals.timestamp,
      });
  });

  Promise
    .all(promises)
    .then((snapShot) => {
      /** The doc exists inside `Profiles` collection. */
      snapShot.forEach((doc) => {
        if (!doc.exists) {
          /** Create profiles for the phone numbers which are not in the DB. */
          locals.batch.set(rootCollections
            .profiles
            .doc(doc.id), {
              uid: null,
            }
          );

          locals.batch.set(rootCollections
            .profiles
            .doc(doc.id)
            .collection('Activities')
            .doc(locals.activityRef.id), {
              canEdit: handleCanEdit(
                locals,
                /** Document ID is the phoneNumber */
                doc.id,
                conn.requester.phoneNumber,
                conn.req.body.share
              ),
              timestamp: locals.timestamp,
            });
        }

        /** The `uid` shouldn't be `null` OR `undefined` */
        if (doc.exists && doc.get('uid')) {
          locals.batch.set(rootCollections
            .updates
            .doc(doc.get('uid'))
            .collection('Addendum')
            .doc(),
            locals.addendum
          );
        }
      });

      commitBatch(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Adds a document to the user profile with the `activityId` and `canEdit` rule.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addActivityToUserProfile = (conn, locals) => {
  const canEdit = handleCanEdit(
    locals,
    /** The phone number to check and the one with which we are
     * going to verify the edit rule with are same because this
     * block is writing the doc for the user themselves.
     */
    conn.requester.phoneNumber,
    conn.requester.phoneNumber,
    conn.req.body.share
  );

  /** For support requests, the activity is not to be added to
   * the requester's profile.
   */
  if (!conn.requester.isSupportRequest) {
    locals.batch.set(rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Activities')
      .doc(locals.activityRef.id), {
        canEdit,
        timestamp: locals.timestamp,
      });
  }

  handleAssignedUsers(conn, locals);
};


/**
 * Adds the activity to each user's profile from the `include` array.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const handleIncludesFromSubscriptions = (conn, locals) => {
  /** The 'include' array will always have the requester's
   * phone number, therefore not adding user's number to the batch
   * explicitly.
   */
  locals.include.forEach((phoneNumber) => {
    /** The requester shouldn't be added to the activity assignees
     * for a support request.
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
      .doc(phoneNumber), { canEdit, });
  });

  addActivityToUserProfile(conn, locals);
};


/**
 * Writes the addendum for the requester.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addAddendumForRequester = (conn, locals) => {
  locals.addendum = {
    activityId: locals.activityRef.id,
    user: conn.requester.displayName || conn.requester.phoneNumber,
    comment: `${conn.requester.displayName || conn.requester.phoneNumber}`
      + ` created ${locals.template.defaultTitle}`,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: locals.timestamp,
  };

  /** The addendum doc is always created for the requester.
   * Unless the request type is of `support`.
   */
  if (!conn.requester.isSupportRequest) {
    locals.batch.set(rootCollections
      .updates
      .doc(conn.requester.uid)
      .collection('Addendum')
      .doc(),
      locals.addendum
    );
  }

  handleIncludesFromSubscriptions(conn, locals);
};


/**
 * Adds activity root doc to batch.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const createActivityRoot = (conn, locals) => {
  const activityRoot = {};

  activityRoot.title = conn.req.body.title;
  activityRoot.description = conn.req.body.description;

  if (!isNonEmptyString(activityRoot.title)) {
    activityRoot.title = '';
  }

  if (!isNonEmptyString(activityRoot.description)) {
    activityRoot.description = '';
  }

  if (activityRoot.title === '' && activityRoot.description !== '') {
    activityRoot.title = conn.req.body.description.substring(0, 30);
  }

  if (activityRoot.title === '') {
    activityRoot.tile = locals.template.defaultTitle;
  }

  activityRoot.status = locals.template.statusOnCreate;
  activityRoot.office = conn.req.body.office;
  activityRoot.template = conn.req.body.template;

  activityRoot.schedule = locals.schedule || filterSchedules(
    conn.req.body.schedule,
    /** The `schedule` object from the template. */
    locals.template.schedule
  );

  activityRoot.venue = locals.venue || filterVenues(
    conn.req.body.venue,
    /** The `venue` object from the template. */
    locals.template.venue
  );

  activityRoot.timestamp = locals.timestamp;

  /** The docRef is the reference to the document which the
    * activity handled in the request. It will ne null for an
    * activity with the template 'plan' with office 'personal'.
    */
  activityRoot.docRef = locals.docRef || null;

  /** The rule is stored here to avoid reading subscriptions during
   * updates.
   */
  activityRoot.canEditRule = locals.canEditRule;

  locals.batch.set(locals.activityRef, activityRoot);

  addAddendumForRequester(conn, locals);
};


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
      activityId: locals.activityRef.id,
      office: conn.req.body.office,
      template: conn.req.body.template,
      phoneNumber: conn.requester.phoneNumber,
      url: conn.req.url,
      timestamp: locals.timestamp,
      geopoint: getGeopointObject(conn.req.body.geopoint),
    });

  createActivityRoot(conn, locals);
};


/**
 * Creates a *new* `subscription` for the user based on the `office`
 * and the `template` from the request body.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} docData A temp object storing all the fields for the doc to write from the attachment.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const createSubscription = (conn, docData, locals) => {
  if (!locals.office.empty) {
    sendResponse(
      conn,
      code.conflict,
      `The office: ${conn.req.body.office} doesn't exist.`
    );

    return;
  }

  docData.canEditRule = conn.req.body.canEditRule;
  docData.timestamp = locals.timestamp;

  locals
    .docRef = rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Subscriptions')
      .doc(locals.activityRef.id);

  /** No one subscibes to the `admin` template. */
  delete docData.template;

  // TODO: createDocData.template = conn.req.body.template.value;
  // ? But, this also requires a check if the template exists.

  if (!Array.isArray(conn.req.body.share)) {
    docData.include = [];

    /** All assignees of this activity will be in the `include` array. */
    conn.req.body.share.forEach((phoneNumber) => {
      if (!isE164PhoneNumber(phoneNumber)) return;

      docData.include.push(phoneNumber);
    });
  }

  locals.batch.set(locals.docRef, docData);

  updateDailyActivities(conn);
};


/**
 * Adds a *new* office to the `Offices` collection.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} docData A temp object storing all the fields for the doc
 * to write from the attachment.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const createOffice = (conn, docData, locals) => {
  if (!locals.office.empty) {
    sendResponse(
      conn,
      code.conflict,
      `An office with the name: ${conn.req.body.office} already exists.`
    );

    return;
  }

  if (!conn.req.body.attachment.hasOwnProperty('name')) {
    sendResponse(
      conn,
      code.badRequest,
      `Cannot create an office without the name. Please add one in the attachment.`
    );

    return;
  }

  if (!isNonEmptyString(conn.req.body.attachment.name.value)) {
    sendResponse(
      conn,
      code.badRequest,
      `The Office name cannot be an empty/blank string.`
    );

    return;
  }

  docData.status = locals.template.statusOnCreate;
  docData.name = conn.req.body.office;
  docData.template = conn.req.body.template;

  /** Document created by this activity. */
  locals
    .docRef = rootCollections.offices.doc(locals.activityRef.id);

  locals.batch.set(locals.docRef, docData);

  updateDailyActivities(conn, locals);
};


/**
 * Creates a *new* document inside the `Offices/(office-id)/` path based on
 * the template and `activiy-id`.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} docData A temp object storing all the fields for the doc to write from the attachment.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const createNewEntityInOffice = (conn, docData, locals) => {
  if (locals.office.empty) {
    sendResponse(
      conn,
      code.badRequest,
      `An office with the name: ${conn.req.body.office} does not exist.`
    );

    return;
  }

  const officeId = locals.office.docs[0].id;

  locals.docRef = rootCollections
    .offices
    .doc(officeId)
    /** Collection names are `ALWAYS` plural. */
    .collection(`${conn.req.body.template}s`)
    .doc(locals.activityRef.id);

  locals.batch.set(locals.docRef, docData);

  updateDailyActivities(conn, locals);
};


/**
 * Handles the cases where the template is of `subcription` or `office`.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} docData A temp object storing all the fields for the doc to write from the attachment.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const handleSpecialTemplates = (conn, docData, locals) => {
  locals.schedules = filterSchedules(
    conn.req.body.schedule,
    /** Allowed `schedule` names from the template. */
    locals.template.schedule
  );

  locals.schedules.forEach((schedule) => {
    docData[`${schedule.name}`] = {
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    };
  });

  locals.venues = filterVenues(
    conn.req.body.venue,
    /** Allowed `venue` names from template. */
    locals.template.venue
  );

  locals.venues.forEach((venue) => {
    docData[`${venue.venueDescriptor}`] = {
      address: venue.address,
      location: venue.location,
      geopoint: getGeopointObject(venue.geopoint),
    };
  });

  if (conn.req.body.template === 'office') {
    createOffice(conn, docData, locals);

    return;
  }

  /** Admin template is used to give template
   * subscriptions to the users.
   */
  if (conn.req.body.template === 'admin') {
    createSubscription(conn, docData, locals);

    return;
  }

  /** Any case where the template name is other
   * than `office` or admin will create a document as follows:
   * `Office/(office-id)/(...here...)` path.
   */
  createNewEntityInOffice(conn, docData, locals);
};


/**
 * Goes through all the fields in the attachment and checks their
 * values along with the type supplied from the request and template.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const validateAttachment = (conn, locals) => {
  /** A temp object storing all the fields for the doc to
   * write from the attachment.
   */
  const docData = {};

  /** Required while reading the attachments in loop for /read API. */
  docData.activityId = locals.activityRef.id;

  const attachment = filterAttachment(
    conn.req.body.attachment,
    locals.template.attachment
  );

  /** Add `ALL` fields from the `attachment` to the subscription document. */
  Object
    .keys(attachment)
    .forEach((key) => docData[`${key}`] = attachment[`${key}`]);

  handleSpecialTemplates(conn, docData, locals);
};


/**
 * Checks the template and office combination and handles the request
 * based on that.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const processRequestType = (conn, locals) => {
  /** A reference of the batch and the activity instance will be used
   * multiple times throughout the activity creation.
   */
  locals.activityRef = rootCollections.activities.doc();
  locals.batch = db.batch();

  /** For creating a subscription or company, an attachment is required. */
  if (!conn.req.body.hasOwnProperty('attachment')) {
    sendResponse(
      conn,
      code.badRequest,
      'Attachment is not present in the request body'
    );

    return;
  }

  validateAttachment(conn, locals);
};


/**
 * Adds the `canEditRule` from the request body to a temporary
 * object in `locals` object.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const handleSupportRequest = (conn, locals) => {
  if (!conn.req.body.hasOwnProperty('canEditRule')) {
    sendResponse(
      conn,
      code.badRequest,
      'The canEditRule is missing from the request body.'
    );

    return;
  }

  if (locals.canEditRules.get('CANEDITRULES')
    .indexOf(conn.req.body.canEditRule) === -1) {
    sendResponse(
      conn,
      code.badRequest,
      `The canEditRule in the request body is invalid. Use one of`
      + ` the following: ${locals.canEditRules.get('CANEDITRULES')}`
    );

    return;
  }

  /** For support requests, the `canEditRule` will be used from the
   * request body and not from the user's subscription.
   */
  locals.canEditRule = conn.req.body.canEditRule;

  processRequestType(conn, locals);
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
  /** Stores all the temporary data for creating the activity. */
  const locals = {};

  /** Calling `new Date()` constructor multiple times is wasteful. */
  locals.timestamp = new Date(conn.req.body.timestamp);

  /** A template with the name from the request body doesn't exist. */
  if (result[0].empty) {
    sendResponse(
      conn,
      code.badRequest,
      `Template: ${conn.req.body.template} does not exist.`
    );

    return;
  }

  locals.template = result[0].docs[0].data();
  /** Used by handleCanEdit method for setting up edit permissions.
   * In support requests, the subscription doc may not exist sometimes,
   * so include will be default in that case. An empty array is a fallback.
   */
  locals.include = [];

  /** Subscription may or may not exist (especially when creating an `Office`). */
  if (!result[1].empty) {
    locals.canEditRule = result[1].docs[0].get('canEditRule');
    locals.include = result[1].docs[0].get('include');
  }

  /** Storing office as a reference when the office is not personal,
   * the data and its reference is required fof creating an office.
   */
  locals.office = result[2];
  locals.canEditRules = result[3];

  /** Handle support requests from here. */
  if (conn.requester.isSupportRequest) {
    /** A person with support privilidge, doesn't need to
     * have the subscription to the template that they want
     * to create the activity with.
     * @see https://github.com/Growthfilev2/backend-cloud-functions/blob/master/docs/support-requests/README.md
     */
    // A locals.canEditRule = conn.req.body.canEditRule;
    handleSupportRequest(conn, locals);

    return;
  }

  if (result[1].empty) {
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

  processRequestType(conn, locals);
};


/**
 * Fetches the template and the subscriptions of the requester form Firestore.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @returns {void}
 */
const fetchDocs = (conn) =>
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
      rootCollections
        .enums
        .doc('CANEDITRULES')
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));


/**
 * Checks if the request body has `ALL` the *required* fields like `timestamp`,
 * `geopoint`, `office`, and the `template`.
 *
 * @param {Object} body The request body.
 * @returns {boolean} If the request body has valid fields.
 */
const isValidRequestBody = (body) =>
  isNonEmptyString(body.template)
  && isValidDate(body.timestamp)
  && isNonEmptyString(body.office)
  && isValidGeopoint(body.geopoint);


module.exports = (conn) => {
  if (!isValidRequestBody(conn.req.body)) {
    sendResponse(
      conn,
      code.badRequest,
      'Invalid request body.'
      + ' Make sure to include template (string), timestamp (long number),'
      + ' office (string), and the geopoint (object) in the request body.'
    );

    return;
  }

  fetchDocs(conn);
};
