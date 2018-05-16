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
  handleCanEdit,
  isValidDate,
  isValidString,
  isValidLocation,
  isValidPhoneNumber,
  scheduleCreator,
  venueCreator,
  attachmentCreator,
} = require('./helperLib');

const {
  code,
} = require('../../admin/responses');

const {
  activities,
  profiles,
  updates,
  enums,
  activityTemplates,
  offices,
} = rootCollections;


/**
 * Commits the batch and sends a response to the client of the result.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const commitBatch = (conn) => conn.batch.commit()
  .then((data) => sendResponse(
    conn,
    code.accepted,
    'The activity was successfully updated.'
  )).catch((error) => handleError(conn, error));


/**
 * Adds the activity root data to the batch.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
const writeActivityRoot = (conn, result) => {
  if (!conn.req.body.description) conn.req.body.description = '';

  conn.batch.set(activities.doc(conn.req.body.activityId), {
    title: conn.req.body.title || result[0].get('title'),
    description: conn.req.body.description ||
      result[0].get('description'),
    status: result[1].get('ACTIVITYSTATUS')
      .indexOf(conn.req.body.status) > -1 ?
      conn.req.body.status : result[0].get('status'),
    schedule: scheduleCreator(
      conn.req.body.schedule,
      /** schedule from activity root */
      result[0].get('schedule')
    ),
    venue: venueCreator(
      conn.req.body.schedule,
      /** venue from activity root */
      result[0].get('venue')
    ),
    timestamp: new Date(conn.req.body.timestamp),
  }, {
      /** In some requests, the data coming from the request will be
       * partial, so we are merging instead of overwriting the whole thing.
       */
      merge: true,
    });

  conn.batch.set(updates.doc(conn.requester.uid)
    .collection('Addendum').doc(), conn.addendumData);

  commitBatch(conn);
};


/**
 * Handles the document creation in /Profiles and addition of new documents in
 * /Updates/<uid>/Activities collection for the assigned users of the acivity.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
const processAsigneesList = (conn, result) => {
  if (Array.isArray(conn.req.body.unassign)) {
    conn.req.body.unassign.forEach((val) => {
      if (!isValidPhoneNumber(val)) return;

      conn.batch.delete(activities.doc(conn.req.body.activityId)
        .collection('Assignees').doc(val));

      conn.batch.delete(profiles.doc(val).collection('Activities')
        .doc(conn.req.body.activityId));
    });
  }

  const promises = [];

  if (Array.isArray(conn.req.body.assign)) {
    conn.req.body.assign.forEach((val) => {
      if (!isValidPhoneNumber(val)) return;

      conn.batch.set(activities.doc(conn.req.body.activityId)
        .collection('Assignees').doc(val), {
          canEdit: handleCanEdit(
            conn.templateData.canEditRule,
            result[3].data() /** CANEDITRULES DOC DATA */
          ),
        });

      conn.batch.set(profiles.doc(val).collection('Activities')
        .doc(conn.req.body.activityId), {
          canEdit: handleCanEdit(
            conn.templateData.canEditRule,
            result[3].data() /** CANEDITRULES DOC DATA */
          ),
          timestamp: new Date(conn.req.body.timestamp),
        });

      promises.push(profiles.doc(val).get());
    });
  }

  Promise.all(promises).then((snapShots) => {
    snapShots.forEach((doc) => {
      /** If the request does't have the unassign array, then the updates
       * will be written for all the assignees and the users who have
       * been added in this update.
       */
      if (!conn.req.body.unassign) conn.req.body.unassign = [];

      /** The uid shouldn't be null (or undefined) and the doc shouldn't be of
       * a person who has been unassigned from the activity during the update.
       */
      if (doc.get('uid') && conn.req.body.unassign.indexOf(doc.id) === -1) {
        conn.batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), conn.addendumData);
      }
    });

    writeActivityRoot(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the assignees list and the template from the Activity in context.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
const getTemplateAndAssigneesFromActivity = (conn, result) => {
  const promises = [
    activityTemplates.doc(result[0].get('template')).get(),
    activities.doc(conn.req.body.activityId).collection('AssignTo').get(),
  ];

  Promise.all(promises).then((docsFromFirestore) => {
    conn.templateData = docsFromFirestore[0].data();

    conn.activityAssignees = [];

    docsFromFirestore[1].forEach((doc) =>
      conn.activityAssignees.push(doc.id));

    conn.addendumData = {
      activityId: conn.req.body.activityId,
      user: conn.requester.displayName || conn.requester.phoneNumber,
      comment: conn.requester.displayName || conn.requester.phoneNumber
        /** template name from activity root */
        + ' updated ' + result[0].get('template'),
      location: getGeopointObject(
        conn.req.body.geopoint[0],
        conn.req.body.geopoint[1]
      ),
      timestamp: new Date(conn.req.body.timestamp),
    };

    if (conn.req.body.addAssignTo || conn.req.body.deleteAssignTo) {
      processAsigneesList(conn, result);
      return;
    }

    writeActivityRoot(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the activtiy root and enum/activitytemplates doc.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const fetchDocs = (conn) => {
  const promises = [
    activities.doc(conn.req.body.activityId).get(),
    enums.doc('ACTIVITYSTATUS').get(),
    offices.doc(conn.req.body.office).get(),
    enums.doc('CANEDITRULES').get(),
  ];

  Promise.all(promises).then((result) => {
    if (!result[0].exists) {
      /** the activity with the id from the request body doesn't
       * exist in the Firestore
       * */
      sendResponse(
        conn,
        code.conflict,
        `There is no activity with the id: ${conn.req.body.activityId}.`
      );
      return;
    }

    /** A reference of the batch instance will be used multiple times
      * throughout the update flow.
      */
    conn.batch = db.batch();

    getTemplateAndAssigneesFromActivity(conn, result);
    return;
  }).catch((error) => {
    console.log(error);
    sendResponse(
      conn,
      code.badRequest,
      'Either of the activityId or the office names are invalid in the'
      + ' request body'
    );
  });
};


/**
 * Checks whether the user has the permission to update the activity.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const verifyPermissionToUpdateActivity = (conn) => {
  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists || !doc.get('canEdit')) {
        /** along with having a document in Assignees sub-collection,
         * the user must also have the permission to edit the activity
         */
        sendResponse(
          conn,
          code.forbidden,
          'You need to be either an assignee of the activity or have'
          + ' the edit rights to make a successful update request'
          + ' to an activity.'
        );
        return;
      }

      fetchDocs(conn);
      return;
    }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp)
    && isValidString(conn.req.body.activityId)
    && isValidLocation(conn.req.body.geopoint)) {
    verifyPermissionToUpdateActivity(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper'
    + ' values. Please make sure that the timestamp, activityId'
    + ' and the geopoint are included in the request with appropriate values.'
  );
};

module.exports = app;
