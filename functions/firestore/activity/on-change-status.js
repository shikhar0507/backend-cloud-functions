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
  profiles,
  updates,
  activityTemplates,
  enums,
} = rootCollections;


/**
 * Commits the batch to write the documents added to the batch atomically.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 */
const commitBatch = (conn) => conn.batch.commit()
  .then(() => sendResponse(conn, code.noContent))
  .catch((error) => handleError(conn, error));

/**
 * Writes the `addendum` for all the `assignees` of the activity who have
 * signed up.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 */
const addAddendumForAssignees = (conn) => {
  Promise.all(conn.data.Assignees).then((docsArray) => {
    docsArray.forEach((doc) => {
      if (doc.get('uid')) {
        conn.batch.set(updates.doc(doc.get('uid'))
          .collection('Addendum').doc(), conn.addendum);
      }
    });

    commitBatch(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Updates the `status` field in the activity root.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 */
const updateActivityStatus = (conn) => {
  conn.batch.set(activities.doc(conn.req.body.activityId), {
    status: conn.req.body.status,
    timestamp: new Date(conn.req.body.timestamp),
  }, {
      merge: true,
    });

  addAddendumForAssignees(conn);
};


/**
 * Fetches the template from reading the name from the activity root
 * document.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 */
const fetchTemplate = (conn) => {
  activityTemplates.doc(conn.data.activity.get('template')).get()
    .then((doc) => {
      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: conn.requester.displayName || conn.requester.phoneNumber
          + ' updated ' + doc.get('defaultTitle'),
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: new Date(conn.req.body.timestamp),
      };

      updateActivityStatus(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the activity, assignees and the activity status docs from
 * the Firestore.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 */
const fetchDocs = (conn) => {
  Promise.all([
    activities.doc(conn.req.body.activityId).get(),
    activities.doc(conn.req.body.activityId).collection('Assignees').get(),
    enums.doc('ACTIVITYSTATUS').get(),
  ]).then((result) => {
    if (!result[0].exists) {
      /** This case should probably never execute becase there is provision
       * for deleting an activity anywhere. AND, for reaching the fetchDocs()
       * function, the check for the existance of the activity has already
       * been performed in the User's profile.
       */
      sendResponse(
        conn,
        code.conflict,
        `There is no activity with the id: ${conn.req.body.activityId}`
      );
      return;
    }

    conn.batch = db.batch();
    conn.data = {};

    conn.data.Assignees = [];
    conn.data.activity = result[0];

    if (conn.req.body.status === conn.data.activity.get('status')) {
      sendResponse(
        conn,
        code.conflict,
        `The activity status is already ${conn.req.body.status}.`
      );
      return;
    }

    /** The Assignees list is required to add addendum. */
    result[1].forEach((doc) => {
      conn.data.Assignees.push(profiles.doc(doc.id).get());
    });

    if (result[2].get('ACTIVITYSTATUS').indexOf(conn.req.body.status) === -1) {
      sendResponse(
        conn,
        code.badRequest,
        `${conn.req.body.status} is NOT a valid status from the template.`
      );
      return;
    }

    fetchTemplate(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Checks if the *requester* has the *permission* to *edit* the activity
 * during an update.
 *
 * @param {Object } conn Contains Express Request and Response Objects.
 */
const verifyEditPermission = (conn) => {
  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists) {
        /** The activity doesn't exist for the user */
        sendResponse(
          conn,
          code.notFound,
          `An activity with the id: ${conn.req.body.activityId} doesn't exist.`
        );
        return;
      }

      if (!doc.get('canEdit')) {
        /** The `canEdit` flag is false so updating is not allowed */
        sendResponse(
          conn,
          code.forbidden,
          'You do not have the permission to edit this activity.'
        );
        return;
      }

      fetchDocs(conn);
      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Validates the request body to check if it contains a valid `timestamp`,
 * `activityId`, `status` and the `geopoint`.
 *
 * @param {Object } conn Contains Express Request and Response Objects.
 */
const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp)
    && isValidString(conn.req.body.activityId)
    && isValidString(conn.req.body.status)
    && isValidLocation(conn.req.body.geopoint)) {
    verifyEditPermission(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper'
    + ' values. Please make sure that the timestamp, activityId, status'
    + ' and the geopoint are included in the request with appropriate values.'
  );
};


module.exports = app;
