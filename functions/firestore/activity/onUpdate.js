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
    'The activity was successfully updated.')
  ).catch((error) => handleError(conn, error));


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
    status: result[1].get(ACTIVITYSTATUS).indexOf(conn.req.body.status) > -1 ?
      conn.req.body.status : result[0].get('status'),
    schedule: scheduleCreator(
      conn.req.body.schedule,
      conn.templateData.schedule
    ),
    venue: venueCreator(
      conn.req.body.schedule,
      conn.templateData.venue
    ),
    timestamp: new Date(conn.req.body.timestamp),
    /** docRef is the the doc which the activity handled in the request */
    docRef: conn.docRef || null,
  }, {
      /** in some requests, the data coming from the request will be
       * partial, so we are merging instead of overwriting
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
          canEdit: handleCanEdit(conn.templateData.canEditRule),
        });

      conn.batch.set(profiles.doc(val).collection('Activities')
        .doc(conn.req.body.activityId), {
          canEdit: handleCanEdit(conn.templateData.canEditRule),
          timestamp: new Date(conn.req.body.timestamp),
        });

      promises.push(profiles.doc(val).get());
    });
  }

  Promise.all(promises).then((snapShots) => {
    snapShots.forEach((doc) => {
      /** If the request does't have unassign array, then the updates
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
      comment: `${conn.requester.displayName || conn.requester.phoneNumber}
        updated ${conn.templateData.name}`,
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


const updateSubscription = (conn, result) => {
  /** The docRef is required in the activity root. */
  conn.docRef = profiles.doc(conn.requester.phoneNumber)
    .collection('Subscriptions').doc();

  conn.batch.set(conn.docRef, {
    include: [conn.requester.phoneNumber],
    timestamp: new Date(conn.req.body.timestamp),
    template: result[1].docs[0].id,
    office: conn.req.body.office,
    activityId: conn.req.body.activityId,
    status: 'CONFIRMED', // ??
  });

  getTemplateAndAssigneesFromActivity(conn, result);
};


const updateCompany = (conn, result) => {
  /** The docRef is required in the activity root. */
  conn.docRef = offices.doc(conn.req.body.office);

  conn.batch.set(offices.doc(conn.req.body.office), {
    activityId: conn.req.body.activityId,
    attachment: attachmentCreator(conn.req.body.attachment),
  });

  getTemplateAndAssigneesFromActivity(conn, result);
};


const addNewEntityInOffice = (conn, result) => {
  /** The docRef is required in the activity root. */
  conn.docRef = office.doc(conn.req.body.office)
    .collection(conn.req.body.template).doc();

  conn.batch.set(conn.docRef, {
    attachment: attachmentCreator(conn.req.body.attachment),
    schedule: scheduleCreator(conn.req.body.schedule),
    venue: venueCreator(conn.req.body.venue),
    activityId: conn.req.body.activityId,
    status: 'PENDING',
  });

  getTemplateAndAssigneesFromActivity(conn, result);
};


const processRequestType = (conn, result) => {
  /** A reference of the batch instance will be used multiple times throughout
   * the update flow.
   */
  conn.batch = db.batch();

  if (conn.req.body.office === 'personal') {
    if (conn.req.body.template === 'plan') {
      sendResponse(
        conn,
        code.unauthorized,
        `You cannot edit the ${conn.req.body.office} Office or
        the ${conn.req.body.template} Template.`
      );
      return;
    }

    sendResponse(conn, code.badRequest, 'The template and office do not have'
      + ' a valid combination');
  } else {
    /** if office is not personal */
    if (!result[2].exists) {
      /** office does not exist with the name from the request */
      sendResponse(
        conn,
        code.badRequest,
        `The office: ${conn.req.body.office} does not exist.`
      );
      return;
    }
    if (conn.req.body.template === 'subscription') {
      updateSubscription(conn, result);
      return;
    }

    if (conn.req.body.template === 'company') {
      updateCompany(conn, result);
      return;
    }

    addNewEntityInOffice(conn, result);
  }
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

    if (conn.req.body.template || conn.req.body.office) {
      processRequestType(conn, result);
      return;
    }

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
    && isValidString(conn.req.body.office)
    && isValidLocation(conn.req.body.geopoint)) {
    verifyPermissionToUpdateActivity(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper'
    + ' values. Please make sure that the timestamp, activityId, office'
    + ' and the geopoint are included in the request with appropriate values.'
  );
};

module.exports = app;
