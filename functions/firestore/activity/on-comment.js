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
  logDailyActivities,
} = require('../../admin/utils');


/**
 * Updates the `timestamp` field in the activity root object with the `timestamp`
 * sent from the request body.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateActivityRootTimestamp = (conn, locals) => {
  locals.batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
      timestamp: serverTimestamp,
    }, {
      merge: true,
    });

  logDailyActivities(conn, locals, code.noContent);
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
      comment: conn.req.body.comment,
      location: getGeopointObject(conn.req.body.geopoint),
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      timestamp: serverTimestamp,
    }
  );

  updateActivityRootTimestamp(conn, locals);
};



/**
 * Fetches the `activity` doc from inside the `Activities` root collection.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const checkIfActivityExists = (conn, locals) =>
  rootCollections
    .activities
    .doc(conn.req.body.activityId)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        sendResponse(
          conn,
          code.notFound,
          `No activity found with the id: ${conn.req.body.activityId}.`
        );

        return;
      }

      /** Resetting the activity doc data here again for the
       * cases where the activity doc doesn't exist for the
       * support person, but actually exists in the `/Activities`
       * collection.
       */
      locals.activity = doc;

      createAddendumDoc(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


/**
 * Checks whether the user is an assignee to an `activity` which they
 * have sent a request to add a comment to.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const checkCommentPermission = (conn, locals) => {
  if (conn.requester.isSupportRequest) {
    /** The activity may not exist in the `Profiles/(phoneNumber)/Activities`
     * collection, so for the support requests, another check inside the
     * `/Activities` root collection is required.
     */
    checkIfActivityExists(conn, locals);

    return;
  }

  if (!locals.profileActivityDoc.exists) {
    sendResponse(
      conn,
      code.badRequest,
      `No activity found with the id: ${conn.req.body.activityId}.`
    );

    return;
  }

  createAddendumDoc(conn, locals);

  return;
};


/**
 * Fetches the `activity` doc from user's `Subscription` and the
 * `Activities` collection.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @returns {void}
 */
const fetchDocs = (conn) =>
  Promise
    .all([
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Activities')
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
    ])
    .then((docsArray) => {
      const locals = {};
      locals.batch = db.batch();
      locals.profileActivityDoc = docsArray[0];
      locals.activity = docsArray[1];

      checkCommentPermission(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'comment');

  if (!result.isValidBody) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  fetchDocs(conn);
};
