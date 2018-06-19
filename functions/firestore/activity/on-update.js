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
  activityTemplates,
  dailyActivities,
} = rootCollections;


/**
 * Commits the batch to the DB.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const commitBatch = (conn) => conn.batch.commit()
  .then((data) => sendResponse(conn, code.noContent))
  .catch((error) => handleError(conn, error));


/**
 * Adds a doc in `/DailyActivities` collection in the path:
 * `/(office name)/(template name)` with the user's phone number,
 * timestamp of the request and the api used.
 *
* @param {Object} conn Contains Express' Request and Response objects.
 */
const updateDailyActivities = (conn) => {
  conn.batch.set(dailyActivities.doc(new Date().toDateString())
    .collection(conn.data.activity.get('office'))
    .doc(conn.data.activity.get('template')), {
      phoneNumber: conn.requester.phoneNumber,
      url: conn.req.url,
      timestamp: new Date(),
      activityId: conn.req.body.activityId,
    });

  commitBatch(conn);
};


/**
 * Creates a doc inside `/Profiles/(phoneNumber)/Map` for tracking location
 * history of the user.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const logLocation = (conn) => {
  conn.batch.set(profiles.doc(conn.requester.phoneNumber).collection('Map')
    .doc(), {
      geopoint: getGeopointObject(conn.req.body.geopoint),
      timestamp: new Date(conn.req.body.timestamp),
      office: conn.data.activity.get('office'),
      template: conn.data.activity.get('template'),
    });

  updateDailyActivities(conn);
};


/**
 * Updates the activity root and adds the data to the batch.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const updateActivityDoc = (conn) => {
  if (typeof conn.req.body.description === 'string') {
    conn.update.description = conn.req.body.description;
  }

  if (typeof conn.req.body.title === 'string') {
    conn.update.title = conn.req.body.title;
  }

  if (conn.req.body.schedule) {
    conn.update.schedule = filterSchedules(
      conn.req.body.schedule,
      conn.data.activity.get('schedule')
    );
  }

  if (conn.req.body.venue) {
    conn.update.venue = filterVenues(
      conn.req.body.venue,
      conn.data.activity.get('venue')
    );
  }

  conn.update.timestamp = new Date(conn.req.body.timestamp);

  /** Imeplementing the `handleAttachment()` method will make this work. */
  if (conn.docRef) {
    /**
     * docRef is not undefined only when a document is updated during
     * the update operation.
     */
    updates.docRef = conn.docRef;
  }

  conn.batch.set(activities.doc(conn.req.body.activityId), conn.update, {
    merge: true,
  });

  logLocation(conn);
};


/**
 * Manages the attachment object.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const handleAttachment = (conn) => {
  /** do stuff */

  updateActivityDoc(conn);
};


/**
 * Adds addendum data for all the assignees in the activity.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const addAddendumForAssignees = (conn) => {
  conn.data.assigneesPhoneNumbersArray.forEach((phoneNumber) => {
    conn.batch.set(profiles.doc(phoneNumber).collection('Activities')
      .doc(conn.req.body.activityId), {
        timestamp: new Date(conn.req.body.timestamp),
      }, {
        merge: true,
      });
  });

  Promise.all(conn.data.assigneesArray).then((snapShot) => {
    snapShot.forEach((doc) => {
      if (doc.get('uid')) {
        conn.batch.set(updates.doc(doc.get('uid'))
          .collection('Addendum').doc(), conn.addendum);
      }
    });

    /** Stores the objects that are to be updated in the activity root. */
    conn.update = {};

    if (conn.req.body.attachment) {
      handleAttachment(conn);
      return;
    }

    updateActivityDoc(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Gets the template from the activity root.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const fetchTemplate = (conn) => {
  activityTemplates.doc(conn.data.activity.get('template')).get()
    .then((doc) => {
      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: conn.requester.displayName || conn.requester.phoneNumber +
          ' updated ' + doc.get('defaultTitle'),
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: new Date(conn.req.body.timestamp),
      };

      conn.data.template = doc;
      addAddendumForAssignees(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the activity, and its assignees from the DB.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const fetchDocs = (conn) => {
  Promise.all([
    activities.doc(conn.req.body.activityId).get(),
    activities.doc(conn.req.body.activityId).collection('Assignees').get(),
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
    conn.data.activity = result[0];

    conn.data.assigneesArray = [];
    conn.data.assigneesPhoneNumbersArray = [];

    result[1].forEach((doc) => {
      /** The assigneesArray is required to add addendum. */
      conn.data.assigneesArray.push(profiles.doc(doc.id).get());
      conn.data.assigneesPhoneNumbersArray.push(doc.id);
    });

    fetchTemplate(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Checks if the user has permission to update the activity data.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const verifyEditPermission = (conn) => {
  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists) {
        /** The activity doesn't exist for the user */
        sendResponse(
          conn,
          conn.forbidden,
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
    }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp) &&
    isValidString(conn.req.body.activityId) &&
    isValidLocation(conn.req.body.geopoint)) {
    verifyEditPermission(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper' +
    ' values. Please make sure that the timestamp, activityId' +
    ' and the geopoint are included in the request with appropriate values.'
  );
};


module.exports = app;
