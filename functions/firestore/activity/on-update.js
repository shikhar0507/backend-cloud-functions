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
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  isValidDate,
  isValidString,
  isValidLocation,
  filterSchedules,
  filterVenues,
} = require('./helper');

const {
  code,
} = require('../../admin/responses');

const {
  activities,
  profiles,
  updates,
  dailyActivities,
} = rootCollections;


/**
 * Commits the batch to the DB.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {Promise} Batch Object.
 */
const commitBatch = (conn) => conn.batch.commit()
  .then(() => sendResponse(conn, code.noContent))
  .catch((error) => handleError(conn, error));


/**
 * Adds a doc in `/DailyActivities` collection in the path:
 * `/(office name)/(template name)` with the user's phone number,
 * timestamp of the request and the api used.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const updateDailyActivities = (conn) => {
  const moment = require('moment');

  const docId = moment(conn.data.timestamp).format('DD-MM-YYYY');

  conn.batch.set(dailyActivities
    .doc(docId)
    .collection('Logs')
    .doc(), {
      office: conn.data.activity.get('office'),
      timestamp: conn.data.timestamp,
      template: conn.data.activity.get('template'),
      phoneNumber: conn.requester.phoneNumber,
      url: conn.req.url,
      activityId: conn.req.body.activityId,
      geopoint: getGeopointObject(conn.req.body.geopoint),
    });

  commitBatch(conn);
};


/**
 * Creates a doc inside `/Profiles/(phoneNumber)/Map` for tracking location
 * history of the user.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const logLocation = (conn) => {
  conn.batch.set(profiles
    .doc(conn.requester.phoneNumber)
    .collection('Map')
    .doc(), {
      activityId: conn.req.body.activityId,
      geopoint: getGeopointObject(conn.req.body.geopoint),
      timestamp: conn.data.timestamp,
      office: conn.data.activity.get('office'),
      template: conn.data.activity.get('template'),
    });

  updateDailyActivities(conn);
};


/**
 * Updates the activity root and adds the data to the batch.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} update Fields for the activity root object.
 * @returns {void}
 */
const updateActivityDoc = (conn) => {
  /** Stores the objects that are to be updated in the activity root. */
  const update = {};

  if (conn.req.body.hasOwnProperty('title')
    && isValidString(conn.req.body.title)) {
    update.title = conn.req.body.title;
  }

  if (conn.req.body.hasOwnProperty('description')
    && isValidString(conn.req.body.description)) {
    update.description = conn.req.body.description;
  }

  if (conn.req.body.hasOwnProperty('schedule')) {
    const scheduleNames = new Set();

    conn.data.activity.get('schedule').forEach((sch) => {
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

    conn.data.activity.get('venue').forEach((venue) => {
      if (!venue.hasOwnProperty('venueDescriptor')) return;

      venueNames.add(venue.venueDescriptor);
    });

    update.venue = filterVenues(
      conn,
      conn.req.body.venue,
      [...venueNames,]
    );
  }

  update.timestamp = conn.data.timestamp;

  /** Imeplementing the `handleAttachment()` method will make this work. */
  if (conn.hasOwnProperty('docRef')) {
    /**
     * The `docRef` is not `undefined` only when a document is updated during
     * the update operation.
     */
    updates.docRef = conn.docRef;
  }

  conn.batch.set(activities
    .doc(conn.req.body.activityId),
    update, {
      /** The activity doc *will* have some of these fields by default. */
      merge: true,
    }
  );

  logLocation(conn);
};



/**
 * Manages the attachment object.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} update Fields for the activity root object.
 * @returns {void}
 */
const handleAttachment = (conn) => {
  /** Do stuff */
  updateActivityDoc(conn);
};



/**
 * Adds addendum data for all the assignees in the activity.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {void}
 */
const addAddendumForAssignees = (conn) => {
  conn.data.assigneesPhoneNumbersArray.forEach((phoneNumber) => {
    conn.batch.set(profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId), {
        timestamp: conn.data.timestamp,
      }, {
        merge: true,
      }
    );
  });

  Promise
    .all(conn.data.assigneesArray)
    .then((snapShot) => {
      snapShot.forEach((doc) => {
        if (!doc.get('uid')) return;

        /** Users without `uid` are the ones who don't have
         * signed up. Addemdum is added only for the users who
         * have an account in auth.
         */
        conn.batch.set(
          updates
            .doc(doc.get('uid'))
            .collection('Addendum')
            .doc(),
          conn.data.addendum
        );
      });

      /** Attachment absent. Skip it. */
      if (!conn.req.body.hasOwnProperty('attachment')) {
        updateActivityDoc(conn);

        return;
      }

      handleAttachment(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Fetches the activity, and its assignees from the DB.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {void}
 */
const fetchDocs = (conn) => {
  Promise
    .all([
      activities
        .doc(conn.req.body.activityId)
        .get(),
      activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .get(),
    ])
    .then((result) => {
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

      conn.batch = db.batch();

      conn.data = {};

      /** Calling new `Date()` constructor multiple times is wasteful. */
      conn.data.timestamp = new Date(conn.req.body.timestamp);
      conn.data.activity = result[0];

      conn.data.assigneesArray = [];
      conn.data.assigneesPhoneNumbersArray = [];

      result[1].forEach((doc) => {
        /** The assigneesArray is required to add addendum. */
        conn.data.assigneesArray.push(profiles.doc(doc.id).get());
        conn.data.assigneesPhoneNumbersArray.push(doc.id);
      });

      addAddendumForAssignees(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Checks if the user has permission to update the activity data.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {void}
 */
const verifyEditPermission = (conn) => {
  profiles
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


const isValidRequestBody = (conn) => {
  return isValidDate(conn.req.body.timestamp)
    && isValidString(conn.req.body.activityId)
    && isValidLocation(conn.req.body.geopoint);
};


const app = (conn) => {
  if (!isValidRequestBody(conn)) {
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


module.exports = app;
