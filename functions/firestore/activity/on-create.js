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
  activities,
  profiles,
  updates,
  activityTemplates,
  offices,
  dailyActivities,
  enums,
} = rootCollections;

const {
  handleError,
  sendResponse,
  getISO8601Date,
} = require('../../admin/utils');

const {
  code,
} = require('../../admin/responses');

const {
  handleCanEdit,
  isValidDate,
  isValidString,
  isValidPhoneNumber,
  isValidLocation,
  filterSchedules,
  filterVenues,
  filterAttachment,
} = require('./helper');


/**
 * Commits the batch and sends a response to the client.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {Promise} Doc metadata or error object.
 */
const commitBatch = (conn) => conn.batch.commit()
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
 * @returns {void}
 */
const handleAssignedUsers = (conn) => {
  /** The list of assignees *NEEDS* to be an array. */
  if (!Array.isArray(conn.req.body.share)) {
    commitBatch(conn);

    return;
  }

  const promises = [];

  /** Create docs in Assignees collection if share is in the request body.
   * */
  conn.req.body.share.forEach((phoneNumber) => {
    if (!isValidPhoneNumber(phoneNumber)) return;

    /** The requester shouldn't be added to the activity assignee list
     * if the request is of `support` type.
     */
    if (phoneNumber === conn.requester.phoneNumber
      && conn.requester.isSupportRequest) return;

    /** The phone numbers exist uniquely in the `/Profiles` collection. */
    promises.push(profiles.doc(phoneNumber).get());

    conn.batch.set(activities
      .doc(conn.activityRef.id)
      .collection('Assignees')
      .doc(phoneNumber), {
        canEdit: handleCanEdit(
          conn.data.subscription,
          phoneNumber,
          conn.requester.phoneNumber,
          conn.req.body.share
        ),
      }, {
        merge: true,
      });

    conn.batch.set(profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.activityRef.id), {
        canEdit: handleCanEdit(
          conn.data.subscription,
          phoneNumber,
          conn.requester.phoneNumber,
          conn.req.body.share
        ),
        timestamp: conn.data.timestamp,
      });
  });

  Promise
    .all(promises)
    .then((snapShots) => {
      /** The doc exists inside `Profiles` collection. */
      snapShots.forEach((doc) => {
        if (!doc.exists) {
          /** Create profiles for the phone numbers which are not in the DB. */
          conn.batch.set(profiles.doc(doc.id), {
            uid: null,
          });

          conn.batch.set(profiles
            .doc(doc.id)
            .collection('Activities')
            .doc(conn.activityRef.id), {
              canEdit: handleCanEdit(
                conn.data.subscription,
                doc.id,
                conn.requester.phoneNumber,
                conn.req.body.share
              ),
              timestamp: conn.data.timestamp,
            });
        }

        /** The `uid` shouldn't be `null` OR `undefined` */
        if (doc.exists && doc.get('uid')) {
          conn.batch.set(updates
            .doc(doc.get('uid'))
            .collection('Addendum')
            .doc(),
            conn.addendumData
          );
        }
      });

      commitBatch(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Adds activity root doc to batch.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @returns {void}
 */
const createActivity = (conn) => {
  const activityRoot = {};

  activityRoot.title = conn.req.body.title;
  activityRoot.description = conn.req.body.description;

  if (!isValidString(activityRoot.title)) {
    activityRoot.title = '';
  }

  if (!isValidString(activityRoot.description)) {
    activityRoot.description = '';
  }

  if (activityRoot.title === '' && activityRoot.description !== '') {
    activityRoot.title = conn.req.body.description.substring(0, 30);
  }

  if (activityRoot.title === '') {
    activityRoot.tile = conn.data.template.defaultTitle;
  }

  activityRoot.status = conn.data.template.statusOnCreate;
  activityRoot.office = conn.req.body.office;
  activityRoot.template = conn.req.body.template;

  activityRoot.schedule = filterSchedules(
    conn,
    conn.req.body.schedule,
    /** The `schedule` object from the template. */
    conn.data.template.schedule
  );

  activityRoot.venue = filterVenues(
    conn,
    conn.req.body.venue,
    /** The `venue` object from the template. */
    conn.data.template.venue
  );

  activityRoot.timestamp = conn.data.timestamp;

  /** The docRef is the reference to the document which the
    * activity handled in the request. It will ne null for an
    * activity with the template 'plan' with office 'personal'.
    */

  activityRoot.docRef = conn.docRef || null;

  /** The rule is stored here to avoid reading subscriptions during
   * updates.
   */
  activityRoot.canEditRule = conn.data.subscription.canEditRule;

  conn.batch.set(conn.activityRef, activityRoot);

  conn.addendumData = {
    activityId: conn.activityRef.id,
    user: conn.requester.displayName || conn.requester.phoneNumber,
    comment: `${conn.requester.displayName || conn.requester.phoneNumber}` +
      ` created ${conn.data.template.defaultTitle}`,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: conn.data.timestamp,
  };

  /** The addendum doc is always created for the requester */
  conn.batch.set(updates
    .doc(conn.requester.uid)
    .collection('Addendum')
    .doc(),
    conn.addendumData
  );

  /** Subscription may or may not exist (especially when creating an Office). */
  if (conn.data.subscription.hasOwnProperty('include')) {
    /** The 'include' array will always have the requester's
     * phone number, so we don't need to explictly add their number
     * in order to add them to a batch.
     */
    conn.data.subscription.include.forEach((phoneNumber) => {
      /** The requester shouldn't be added to the activity assignee list
       * if the request is of `support` type.
       */
      if (phoneNumber === conn.requester.phoneNumber
        && conn.requester.isSupportRequest) return;

      conn.batch.set(activities
        .doc(conn.activityRef.id)
        .collection('Assignees')
        .doc(phoneNumber), {
          canEdit: handleCanEdit(
            conn.data.subscription,
            phoneNumber,
            conn.requester.phoneNumber,
            conn.req.body.share
          ),
        });
    });
  }

  conn.batch.set(profiles
    .doc(conn.requester.phoneNumber)
    .collection('Activities')
    .doc(conn.activityRef.id), {
      canEdit: handleCanEdit(conn.data.subscription,
        /** The phone Number to check and the one with which we are
         * going to verify the edit rule with are same because this
         * block is writing the doc for the user themselves.
         */
        conn.requester.phoneNumber,
        conn.requester.phoneNumber,
        conn.req.body.share
      ),
      timestamp: conn.data.timestamp,
    });

  handleAssignedUsers(conn);
};


/**
 * Adds a doc in `/DailyActivities` collection in the path:
 * `/(office name)/(template name)` with the user's phone number,
 * timestamp of the request and the api used.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const updateDailyActivities = (conn) => {
  const docId = getISO8601Date(conn.data.timestamp);

  conn.batch.set(dailyActivities
    .doc(docId).collection('Logs').doc(), {
      activityId: conn.activityRef.id,
      office: conn.req.body.office,
      template: conn.req.body.template,
      phoneNumber: conn.requester.phoneNumber,
      url: conn.req.url,
      timestamp: conn.data.timestamp,
      geopoint: getGeopointObject(conn.req.body.geopoint),
    });

  createActivity(conn);
};


/**
 * Creates a *new* `subscription` for the user based on the `office`
 * and the `template` from the request body.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} docData A temp object storing all the fields for the doc to write from the attachment.
 * @returns {void}
 */
const createSubscription = (conn, docData) => {
  if (!conn.data.office.empty) {
    sendResponse(
      conn,
      code.conflict,
      `The office: ${conn.req.body.office} doesn't exist.`
    );

    return;
  }

  docData.canEditRule = conn.req.body.canEditRule;
  docData.timestamp = conn.data.timestamp;

  conn.docRef = profiles
    .doc(conn.requester.phoneNumber)
    .collection('Subscriptions')
    .doc(conn.activityRef.id);

  /** Subscription to the `admin` template
   * is not to be given to anyone.
   */
  delete docData.template;

  // TODO: createDocData.template = conn.req.body.template.value;
  // ? But, this also requires a check if the template exists.

  if (!Array.isArray(conn.req.body.share)) {
    docData.include = [];

    /** All assignees of this activity will be in the `include` array. */
    conn.req.body.share.forEach((phoneNumber) => {
      if (!isValidPhoneNumber(phoneNumber)) return;

      docData.include.push(phoneNumber);
    });
  }

  conn.batch.set(conn.docRef, docData);

  updateDailyActivities(conn);
};


/**
 * Adds a *new* office to the `Offices` collection.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} docData A temp object storing all the fields for the doc to write from the attachment.
 * @returns {void}
 */
const createOffice = (conn, docData) => {
  if (!conn.data.office.empty) {
    sendResponse(
      conn,
      code.conflict,
      `An office with the name: ${conn.req.body.office} already exists.`
    );

    return;
  }

  conn.docRef = offices.doc(conn.activityRef.id);

  conn.batch.set(conn.docRef, docData);

  updateDailyActivities(conn);
};


/**
 * Creates a *new* document inside the `Offices/(office-id)/` path based on
 * the template and `activiy-id`.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} docData A temp object storing all the fields for the doc to write from the attachment.
 * @returns {void}
 */
const createNewEntityInOffice = (conn, docData) => {
  if (conn.data.office.empty) {
    sendResponse(
      conn,
      code.badRequest,
      `An office with the name: ${conn.req.body.office} does not exist.`
    );

    return;
  }

  const officeId = conn.data.office.docs[0].id;

  conn.docRef = offices
    .doc(officeId)
    /** Collection names are `ALWAYS` plural. */
    .collection(`${conn.req.body.template}s`)
    .doc(conn.activityRef.id);

  conn.batch.set(conn.docRef, docData);

  updateDailyActivities(conn);
};


/**
 * Handles the cases where the template is of `subcription` or `office`.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const handleSpecialTemplates = (conn) => {
  /** A temp object storing all the fields for the doc to
   * write from the attachment.
   */
  const docData = {};

  /** Required while reading the attachments in loop for /read API. */
  docData.activityId = conn.activityRef.id;

  const attachment = filterAttachment(
    conn.req.body.attachment,
    conn.data.template.attachment
  );

  /** Add `ALL` fields from the `attachment` to the subscription document. */
  Object
    .keys(attachment)
    .forEach((key) => docData[`${key}`] = attachment[`${key}`]);

  const schedules = filterSchedules(
    conn,
    conn.req.body.schedule,
    /** The `schedule` object from the template. */
    conn.data.template.schedule
  );

  schedules.forEach((schedule) => {
    docData[`${schedule.name}`] = {
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    };
  });

  const venues = filterVenues(
    conn,
    conn.req.body.venue,
    /** The `venue` object from the template. */
    conn.data.template.venue
  );

  venues.forEach((venue) => {
    docData[`${venue.venueDescriptor}`] = {
      address: venue.address,
      location: venue.location,
      geopoint: getGeopointObject(venue.geopoint),
    };
  });

  docData.status = conn.data.template.statusOnCreate;
  docData.office = conn.req.body.office;
  docData.template = conn.req.body.template;

  if (conn.req.body.template === 'office') {
    createOffice(conn, docData);

    return;
  }

  if (conn.req.body.template === 'admin') {
    createSubscription(conn, docData);

    return;
  }

  createNewEntityInOffice(conn, docData);
};


/**
 * Checks the template and office combination and handles the request
 * based on that.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @returns {void}
 */
const processRequestType = (conn) => {
  /** A reference of the batch and the activity instance will be used
   * multiple times throughout the activity creation.
   */
  conn.activityRef = activities.doc();
  conn.batch = db.batch();

  if (conn.req.body.office === 'personal') {
    if (conn.req.body.template === 'plan') {
      updateDailyActivities(conn);

      return;
    }

    sendResponse(
      conn,
      code.badRequest,
      `This combination of office: ${conn.req.body.office} and`
      + ` template: ${conn.req.body.template} does not exist in`
      + ' your subscriptions.'
    );

    return;
  }

  /** For creating a subscription or company, an attachment is required. */
  if (!conn.req.body.hasOwnProperty('attachment')) {
    sendResponse(
      conn,
      code.badRequest,
      'Attachment is not present in the request body'
    );

    return;
  }

  handleSpecialTemplates(conn);
};


/**
 * Adds the `canEditRule` from the request body to a temporary
 * object in `conn.data`.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @returns {void}
 */
const handleSupportRequest = (conn) => {
  if (!conn.req.body.hasOwnProperty('canEditRule')) {
    sendResponse(
      conn,
      code.badRequest,
      'The canEditRule is missing from the request body.'
    );

    return;
  }

  if (
    conn
      .data
      .canEditRules
      .get('CANEDITRULES')
      .indexOf(conn.req.body.canEditRule) === -1
  ) {
    sendResponse(
      conn,
      code.badRequest,
      `The canEditRule in the request body is invalid. Use one of`
      + ` the following: ${conn.data.canEditRules.get('CANEDITRULES')}`
    );

    return;
  }

  /** For support requests, the `canEditRule` will be used from the
   * request body and not from the user's subscription.
   */
  conn.data.subscription.canEditRule = conn.req.body.canEditRule;

  processRequestType(conn);
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
  conn.data = {};

  /** Calling new Date() constructor multiple times is wasteful. */
  conn.data.timestamp = new Date(conn.req.body.timestamp);

  /** A template with the name from the request body doesn't exist. */
  if (result[0].empty) {
    sendResponse(
      conn,
      code.badRequest,
      `Template: ${conn.req.body.template} does not exist.`
    );

    return;
  }

  conn.data.template = result[0].docs[0].data();
  conn.data.subscription = {};

  /** Subscription may or may not exist (especially when creating an `Office`). */
  if (!result[1].empty) {
    conn.data.subscription = result[1].docs[0].data();
    conn.data.subscription.id = result[1].docs[0].id;
  }

  /** Storing office as a reference when the office is not personal,
   * the data and its reference is required fof creating an office.
   */
  conn.data.office = result[2];

  conn.data.canEditRules = result[3];

  /** Handle support requests from here. */
  if (conn.requester.isSupportRequest) {
    /** A person with support privilidge, doesn't need to
     * have the subscription to the template that they want
     * to create the activity with.
     * @see https://github.com/Growthfilev2/backend-cloud-functions/blob/master/docs/support-requests/README.md
     */
    handleSupportRequest(conn);

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
      `Template: ${conn.req.body.template} doesn't exist.`
    );

    return;
  }

  if (result[1].docs[0].get('office') !== conn.req.body.office) {
    /** Template from the request body and the office do not match so,
     * the requester probably doesn't have the permission to create
     * an activity with this template.
     */
    sendResponse(
      conn,
      code.forbidden,
      'You do not have the permission to create'
      + ` an activity with the template: ${conn.req.body.template}`
      + ` for the office: ${conn.req.body.office}.`
    );

    return;
  }

  processRequestType(conn);
};


/**
 * Fetches the template and the subscriptions of the requester form Firestore.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @returns {void}
 */
const fetchDocs = (conn) => {
  Promise
    .all([
      activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get(),
      profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .where('template', '==', conn.req.body.template)
        .limit(1)
        .get(),
      offices
        .where('name', '==', conn.req.body.office)
        .limit(1)
        .get(),
      enums
        .doc('CANEDITRULES')
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};


/**
 * Checks if the request body has `ALL` the *required* fields like `timestamp`,
 * `geopoint`, `office`, and the `template`.
 *
 * @param {Object} body The request body.
* @returns {boolean} If the request body has valid fields.
 */
const isValidRequestBody = (body) => {
  return isValidString(body.template)
    && isValidDate(body.timestamp)
    && isValidString(body.office)
    && isValidLocation(body.geopoint);
};


const app = (conn) => {
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


module.exports = app;
