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
} = require('./helper');

const {
  code,
} = require('../../admin/responses');

const {
  activities,
  updates,
  profiles,
  dailyActivities,
} = rootCollections;


/**
 * Commits the batch to the Firestore and send a response to the client
 * about the result.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 * @returns {Promise} Batch object.
 */
const commitBatch = (conn) => conn.batch.commit()
  .then(() => sendResponse(
    conn,
    code.created,
    'The comment was successfully added to the activity.'
  ))
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
 * Adds addendum doc for each assignee of the activity for which the comment
 * is being created.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 * @returns {void}
 */
const setAddendumForAssignees = (conn) => {
  conn.assigneesPhoneNumberList.forEach((phoneNumber) => {
    conn.batch.set(profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId), {
        timestamp: conn.data.timestamp,
      }, {
        merge: true,
      });
  });

  Promise
    .all(conn.assigneeDocPromises)
    .then((snapShots) => {
      snapShots.forEach((doc) => {
        /** `uid` shouldn't be `null` OR `undefined` */
        if (!doc.exists) return;

        if (!doc.get('uid')) return;

        conn.batch.set(updates
          .doc(doc.get('uid'))
          .collection('Addendum')
          .doc(), {
            activityId: conn.req.body.activityId,
            user: conn.requester.displayName || conn.requester.phoneNumber,
            comment: conn.req.body.comment,
            location: getGeopointObject(conn.req.body.geopoint),
            timestamp: conn.data.timestamp,
          });
      });

      logLocation(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Fetches all the docs from '/Assignees' subcollection in the activity
 * and creates a list of profiles for which the Addendum are to be written.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 * @returns {void}
 */
const createAssigneePromises = (conn) => {
  conn.assigneeDocPromises = [];
  conn.assigneesPhoneNumberList = [];

  activities
    .doc(conn.req.body.activityId)
    .collection('Assignees')
    .get()
    .then((snapShot) => {
      snapShot.forEach((doc) => {
        conn.assigneeDocPromises.push(profiles.doc(doc.id).get());
        conn.assigneesPhoneNumberList.push(doc.id);
      });

      conn.batch = db.batch();

      setAddendumForAssignees(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Fetches the activity doc from inside the `Activities` root collection.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 * @returns {void}
 */
const checkIfActivityExists = (conn) => {
  activities
    .doc(conn.req.body.activityId)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        sendResponse(
          conn,
          code.conflict,
          `No acivity found with the id: ${conn.req.body.activityId}.`
        );

        return;
      }

      /** Resetting the activity doc data here again for the
       * cases where the activity doc doesn't exist for the
       * support person, but actually exists in the `/Activities`
       * collection.
       */
      conn.data.activity = doc;

      createAssigneePromises(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Checks whether the user is an assignee to an activity which they
 * have sent a request to add a comment to.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 * @returns {void}
 */
const checkCommentPermission = (conn) => {
  if (conn.requester.isSupportRequest) {
    /** The activity may not exist in the `Profiles/(phoneNumber)/Activities`
     * collection, so for the support requests, another check inside the
     * `/Activities` root collection is required.
     */
    checkIfActivityExists(conn);

    return;
  }

  if (!conn.data.profileActivityDoc.exists) {
    sendResponse(
      conn,
      code.conflict,
      `No acivity found with the id: ${conn.req.body.activityId}.`
    );

    return;
  }

  createAssigneePromises(conn);
};


const fetchDocs = (conn) => {
  Promise
    .all([
      profiles
        .doc(conn.requester.phoneNumber)
        .collection('Activities')
        .doc(conn.req.body.activityId)
        .get(),
      activities
        .doc(conn.req.body.activityId)
        .get(),
    ])
    .then((docsArray) => {
      conn.data = {};

      /** Calling new Date() constructor multiple times is wasteful. */
      conn.data.timestamp = new Date(conn.req.body.timestamp);
      conn.data.profileActivityDoc = docsArray[0];
      conn.data.activity = docsArray[1];

      checkCommentPermission(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Checks for `timestamp`, `geopoint`, `activityId` and the `comment` from the
 * request body.
 *
 * @param {Object} body The request body.
 * @returns {boolean} If the request body is valid.
 */
const isValidRequestBody = (body) => {
  return isValidString(body.activityId)
    && isValidDate(body.timestamp)
    && isValidLocation(body.geopoint)
    && isValidString(body.comment);
};


const app = (conn) => {
  if (!isValidRequestBody(conn.req.body)) {
    sendResponse(
      conn,
      code.badRequest,
      'Invalid request body.'
      + ' Make sure to include the "activityId" (string), "timestamp" (long number),'
      + ' "geopoint" (object), and the "comment" (string) fields in the request body.'
    );

    return;
  }

  fetchDocs(conn);
};


module.exports = app;
