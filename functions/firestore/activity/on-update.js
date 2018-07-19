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

const { filterSchedules, filterVenues, } = require('./helper');

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
 * Commits the batch to the DB.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} locals Object containing local data.
 * @returns {Promise} Batch Object.
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

  commitBatch(conn, locals);
};


/**
 * Updates the activity root and adds the data to the batch.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateActivityDoc = (conn, locals) => {
  /** Stores the objects that are to be updated in the activity root. */
  const update = {};

  if (conn.req.body.hasOwnProperty('title')
    && isNonEmptyString(conn.req.body.title)) {
    update.title = conn.req.body.title;
  }

  if (conn.req.body.hasOwnProperty('description')
    && isNonEmptyString(conn.req.body.description)) {
    update.description = conn.req.body.description;
  }

  if (conn.req.body.hasOwnProperty('schedule')) {
    const scheduleNames = new Set();

    locals.activity.get('schedule').forEach((sch) => {
      if (sch.hasOwnProperty('name')) {
        scheduleNames.add(sch.name);
      }
    });

    update.schedule = filterSchedules(
      conn,
      conn.req.body.schedule,
      [...scheduleNames,]
    );
  }

  if (conn.req.body.hasOwnProperty('venue')) {
    const venueNames = new Set();

    locals.activity.get('venue').forEach((venue) => {
      if (!venue.hasOwnProperty('venueDescriptor')) return;

      venueNames.add(venue.venueDescriptor);
    });

    update.venue = filterVenues(
      conn,
      conn.req.body.venue,
      [...venueNames,]
    );
  }

  update.timestamp = locals.timestamp;

  /** Implementing the `handleAttachment()` method will make this work. */
  if (conn.hasOwnProperty('docRef')) {
    /**
     * The `docRef` is not `undefined` only when a document is updated during
     * the update operation.
     */
    update.docRef = conn.docRef;
  }

  locals.batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId),
    update, {
      /** The activity doc *will* have some of these fields by default. */
      merge: true,
    }
  );

  updateDailyActivities(conn, locals);
};



/**
 * Manages the attachment object.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} locals Fields for the activity root object.
 * @returns {void}
 */
const handleAttachment = (conn, locals) => {
  /** Do stuff */
  updateActivityDoc(conn, locals);
};



/**
 * Adds addendum data for all the assignees in the activity.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addAddendumForAssignees = (conn, locals) => {
  locals.assigneesPhoneNumbersArray.forEach((phoneNumber) => {
    locals.batch.set(rootCollections
      .profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId), {
        timestamp: locals.timestamp,
      }, {
        merge: true,
      }
    );
  });

  Promise
    .all(locals.assigneesArray)
    .then((snapShot) => {
      snapShot.forEach((doc) => {
        if (!doc.get('uid')) return;

        /** Users without `uid` are the ones who don't have
         * signed up. Addemdum is added only for the users who
         * have an account in auth.
         */
        locals.batch.set(rootCollections
          .updates
          .doc(doc.get('uid'))
          .collection('Addendum')
          .doc(),
          locals.addendum
        );
      });

      /** Attachment absent. Skip it. */
      if (!conn.req.body.hasOwnProperty('attachment')) {
        updateActivityDoc(conn, locals);

        return;
      }

      handleAttachment(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handleResult = (conn, result) => {
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

  locals.assigneesArray = [];
  locals.assigneesPhoneNumbersArray = [];

  result[1].forEach((doc) => {
    /** The assigneesArray is required to add addendum. */
    locals.assigneesArray.push(
      rootCollections.profiles.doc(doc.id).get()
    );

    locals.assigneesPhoneNumbersArray.push(doc.id);
  });

  addAddendumForAssignees(conn, locals);
};


/**
 * Fetches the activity, and its assignees from the DB.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
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
 * @param {Object} conn Contains Express' Request and Respone objects.
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
          code.forbidden,
          `An activity with the id: ${conn.req.body.activityId} doesn't exist.`
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
};


const isValidRequestBody = (body) =>
  isValidDate(body.timestamp)
  && isNonEmptyString(body.activityId)
  && isValidGeopoint(body.geopoint);


module.exports = (conn) => {
  if (!isValidRequestBody(conn.req.body)) {
    sendResponse(
      conn,
      code.badRequest,
      'Invalid request body.'
      + ' Make sure to include valid "activityId" (string), "timestamp" (long number),'
      + ' and the "geopoint" (object) are present in the request body.'
    );

    return;
  }

  if (conn.requester.isSupportRequest) {
    fetchDocs(conn);

    return;
  }

  verifyEditPermission(conn);
};
