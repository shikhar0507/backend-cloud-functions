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
 */
const commitBatch = (conn) => batch.commit()
  .then((result) => sendResponse(conn, 201, 'CREATED'))
  .catch((error) => handleError(conn, error));


/**
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} result Contains the fetched documents from Firestore.
 */
const handleAssignedUsers = (conn, result) => {
  const promises = [];

  // create docs in AssignTo collection if assignTo is in the reqeuest body
  conn.req.body.assignTo.forEach((val) => {
    // TODO: add a method for verifying a valid mobile
    if (!isValidPhoneNumber(val)) return;

    conn.batch.set(activities.doc(conn.activityId)
      .collection('AssignTo').doc(val), {
        // template --> result[1].data()
        canEdit: handleCanEdit(result[1].get('canEditRule')),
      }, {
        merge: true,
      });

    // phone numbers exist uniquely in the db
    // promises.push(updates.where('phoneNumber', '==', val).limit(1).get());
    promises.push(profiles.doc(val).get());

    conn.batch.set(profiles.doc(val).collection('Activities')
      .doc(conn.activityId), {
        canEdit: handleCanEdit(result[1].get('canEditRule')),
        timestamp: new Date(conn.req.body.timestamp),
      });
  });

  Promise.all(promises).then((snapShots) => {
    snapShots.forEach((doc) => {
      if (doc.exists && doc.get('uid') !== null) {
        conn.batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), conn.addendumData);
      }
    });

    commitBatch(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


const createActivity = (conn, result) => {
  const activityRef = activities.doc();
  conn.activityId = activityRef.id; // used multiple times

  conn.batch = db.batch();

  conn.batch.set(activityRef, {
    title: conn.req.body.title || conn.req.body.description
      .substring(0, 30) || result[1].get('defaultTitle'),
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

  result[2].docs[0].get('autoIncludeOnCreate').forEach((val) => {
    conn.batch.set(activities.doc(conn.activityId)
      .collection('AssignTo').doc(val), {
        canEdit: handleCanEdit(result[0].get('canEditRule')),
      });
  });

  Array.isArray(conn.req.body.assignTo) ?
    handleAssignedUsers(conn, result) : commitBatch(conn);
};


const fetchDocs = (conn) => {
  const promises = [];

  promises.push(activityTemplates.doc(conn.req.body.template).get());
  promises.push(profiles.doc(conn.requester.phoneNumber).get());
  promises.push(profiles.doc(conn.requester.phoneNumber)
    .collection('Subscriptions')
    .where('template', '==', conn.req.body.template).limit(1).get());

  Promise.all(promises).then((result) => {
    // template sent in the request body is not a valid type
    if (!result[0].exists) {
      sendResponse(conn, 400, 'BAD REQUEST');
      return;
    }

    if (!result[1].exists) {
      // profile doesn't exist
      sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }

    if (!result[2].docs[0].exists) {
      // the requester is not allowed to create an activity
      // with the requested template
      sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }

    if (result[2].docs[0].get('office') !== conn.req.body.office) {
      console.log('result[2] compare');
      // template from the request body and the office do not match
      sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }

    createActivity(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp) &&
    isValidString(conn.req.body.template) &&
    isValidString(conn.req.body.office) && // officeId --> office
    isValidLocation(conn.req.body.geopoint)) {
    fetchDocs(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

module.exports = app;
