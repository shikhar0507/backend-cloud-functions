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
  activities,
  profiles,
  updates,
  enums,
  activityTemplates,
  offices,
} = rootCollections;

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  handleCanEdit,
  isValidDate,
  isValidString,
  isValidPhoneNumber,
  isValidLocation,
  scheduleCreator,
  venueCreator,
} = require('./helperLib');


/**
 * Commits the batch and sends a response to the client.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} batch Firestore batch.
 */
const commitBatch = (conn, batch) => batch.commit()
  .then((result) => sendResponse(conn, 201, 'CREATED'))
  .catch((error) => handleError(conn, error));


/**
 * Adds docs for each assignee of the activity to the batch.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} result Contains the fetched documents from Firestore.
 */
const handleAssignedUsers = (conn, result) => {
  const promises = [];

  /** create docs in Assignees collection if assignees is in the
   * reqeuest body
   * */
  conn.req.body.assignees.forEach((val) => {
    if (!isValidPhoneNumber(val)) return;

    conn.batch.set(activities.doc(conn.activityId)
      .collection('Assignees').doc(val), {
        /** template --> result[0] */
        canEdit: handleCanEdit(result[0].get('canEditRule')),
      }, {
        merge: true,
      });

    /** phone numbers exist uniquely in the db */
    promises.push(profiles.doc(val).get());

    conn.batch.set(profiles.doc(val).collection('Activities')
      .doc(conn.activityId), {
        canEdit: handleCanEdit(result[0].get('canEditRule')),
        timestamp: new Date(conn.req.body.timestamp),
      });
  });

  Promise.all(promises).then((snapShots) => {
    /** doc exists inside /Profile collection */
    snapShots.forEach((doc) => {
      if (!doc.exists) {
        /** create profiles for the phone numbers which are not
         * in the database
         * */
        conn.batch.set(profiles.doc(doc.id), {
          uid: null,
        });

        conn.batch.set(profiles.doc(doc.id).collection('Activities')
          .doc(conn.activityId), {
            canEdit: handleCanEdit(result[0].get('canEditRule')),
            timestamp: new Date(conn.req.body.timestamp),
          });
      }

      if (doc.exists && doc.get('uid') !== null) {
        conn.batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), conn.addendumData);
      }
    });

    commitBatch(conn, conn.batch);
    return;
  }).catch((error) => handleError(conn, error));
};

/**
 * Adds activity root doc to batch.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Array} result Fetched docs from Firestore.
 */
const createActivity = (conn, result) => {
  const activityRef = activities.doc();
  conn.activityId = activityRef.id; // used multiple times

  conn.batch = db.batch();

  conn.batch.set(activityRef, {
    title: conn.req.body.title || conn.req.body.description
      .substring(0, 30) || result[0].get('defaultTitle'),
    description: conn.req.body.description || '',
    status: result[0].get('statusOnCreate'),
    office: conn.req.body.office,
    template: conn.req.body.template,
    schedule: scheduleCreator(
      conn.req.body.schedule,
      result[0].get('schedule')
    ),
    venue: venueCreator(
      conn.req.body.venue,
      result[0].get('venue')
    ),
    timestamp: new Date(conn.req.body.timestamp),
    attachment: null,
  });

  conn.addendumData = {
    activityId: conn.activityId,
    user: conn.requester.displayName || conn.requester.phoneNumber,
    comment: `${conn.requester.displayName || conn.requester.phoneNumber}
      created ${result[0].get('name')}`,
    location: getGeopointObject(
      conn.req.body.geopoint[0],
      conn.req.body.geopoint[1]
    ),
    timestamp: new Date(conn.req.body.timestamp),
  };

  /**
   * the include array will always have the requeter's
   * phone number, so we don't need to explictly add their number
   * in order to add them to a batch.
   */
  result[1].docs[0].get('include').forEach((val) => {
    conn.batch.set(activities.doc(conn.activityId)
      .collection('Assignees').doc(val), {
        canEdit: handleCanEdit(result[0].get('canEditRule')),
      });
  });

  conn.batch.set(profiles.doc(conn.requester.phoneNumber)
    .collection('Activities').doc(conn.activityId), {
      canEdit: handleCanEdit(result[0].get('canEditRule')),
      timestamp: new Date(conn.req.body.timestamp),
    });

  /** addendum doc is always created for the requester */
  conn.batch.set(updates.doc(conn.requester.uid)
    .collection('Addendum').doc(), conn.addendumData);

  Array.isArray(conn.req.body.assignees) ?
    handleAssignedUsers(conn, result) : commitBatch(conn);
};


/**
 * Fetches the template and the subscriptions of the requester form Firestore.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 */
const fetchDocs = (conn) => {
  const promises = [];

  promises.push(activityTemplates.doc(conn.req.body.template).get());
  promises.push(profiles.doc(conn.requester.phoneNumber)
    .collection('Subscriptions').where('template', '==', conn.req.body.template)
    .limit(1).get());

  Promise.all(promises).then((result) => {
    /** template sent in the request body is not a valid type */
    if (!result[0].exists) {
      sendResponse(conn, 400, 'BAD REQUEST');
      return;
    }

    if (!result[1].docs[0].exists) {
      /** the requester is not subscribed to this activity */
      sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }

    if (result[1].docs[0].get('office') !== conn.req.body.office) {
      /** template from the request body and the office do not match
       * the requester probably doesn't have the permission to create
       * an activity with this template.
       */
      sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }

    createActivity(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp)
    && isValidString(conn.req.body.template)
    && isValidString(conn.req.body.office)
    && isValidLocation(conn.req.body.geopoint)) {
    fetchDocs(conn);
    return;
  }

  sendResponse(conn, 400, 'BAD REQUEST');
};

module.exports = app;
