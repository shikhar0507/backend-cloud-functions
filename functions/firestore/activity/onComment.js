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


const {
  rootCollections,
  users,
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
  isValidPhoneNumber,
} = require('./helperLib');

const {
  activities,
  updates,
  profiles,
} = rootCollections;

/**
 * Commits the batch to the Firestore and send a response to the client
 * about the result.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 */
const commitBatch = (conn) => batch.commit()
  .then((data) => sendResponse(conn, 201, 'CREATED'))
  .catch((error) => handleError(conn, error));

/**
 * Adds addendum doc for each assignee of the activity for which the comment
 * is being created.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 */
const setAddendumForAssignees = (conn) => {
  Promise.all(conn.assigneeDocPromises).then((snapShots) => {
    snapShots.forEach((doc) => {
      /** doc.exists check is redundant here because we are fetching
      documents from firestore itself.
      but for the sake of consistency with the create and update
      function, I'm keeping it here */
      if (doc.exists && doc.get('uid') !== null) {
        conn.batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), {
            activityId: conn.req.body.activityId,
            user: conn.requester.displayName || conn.requester.phoneNumber,
            comment: conn.req.body.comment,
            location: getGeopointObject(
              conn.req.body.geopoint[0],
              conn.req.body.geopoint[1]
            ),
            timestamp: new Date(conn.req.body.timestamp),
          });
      }
    });

    commitBatch(conn);
    return;
  }).catch((error) => handleError(conn, error));
};

/**
 * Fetches all the docs from AssignTo subcollection in the activity
 * and creates a list of profiles for which the Addendum are to be written.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 */
const constructActivityAssigneesPromises = (conn) => {
  conn.assigneeDocPromises = [];

  activities.doc(conn.req.body.activityId).collection('Assignees').get()
    .then((snapShot) => {
      snapShot.forEach((doc) =>
        conn.assigneeDocPromises.push(profiles.doc(doc.id).get()));

      conn.batch = db.batch();

      setAddendumForAssignees(conn);
      return;
    }).catch((error) => handleError(conn, error));
};

/**
 * Checks whether the user is an assignee to an activity which they
 * have sent a request to add a comment to.
 *
 * @param {Object} conn Object with Express Request and Response Objects.
 */
const checkCommentPermission = (conn) => {
  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      /** check if a doc with the activity id from the request
       * body is present in the user profile
       * */
      if (!doc.exists) {
        sendResponse(conn, 403, 'FORBIDDEN');
        return;
      }

      constructActivityAssigneesPromises(conn);
      return;
    }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp)
    && isValidLocation(conn.req.body.geopoint)
    && isValidString(conn.req.body.activityId)) {
    checkCommentPermission(conn);
    return;
  }
  sendResponse(conn, 400, 'BAD REQUEST');
};


module.exports = app;
