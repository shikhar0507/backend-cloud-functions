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
  isValidPhoneNumber,
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
    }
  );

  updateDailyActivities(conn);
};


const updateActivityDoc = (conn) => {
  conn.batch.set(activities
    .doc(conn.req.body.activityId), {
      timestamp: conn.data.timestamp,
    }, {
      merge: true,
    }
  );

  logLocation(conn);
};


const setAddendumForUsersWithUid = (conn) => {
  const promises = [];

  conn.data.assigneeArray.forEach((phoneNumber) => {
    promises.push(profiles.doc(phoneNumber).get());

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
    .all(promises)
    .then((snapShot) => {
      snapShot.forEach((doc) => {
        /** `uid` is NOT `null` OR `undefined` */
        if (!doc.get('uid')) return;

        conn.batch.set(updates
          .doc(doc.get('uid'))
          .collection('Addendum')
          .doc(),
          conn.addendum
        );

      });

      updateActivityDoc(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const unassignFromTheActivity = (conn) => {
  let index;

  conn.req.body.remove.forEach((phoneNumber) => {
    if (!isValidPhoneNumber(phoneNumber)) return;

    /** Deleting from Assignees collection inside activity doc */
    conn.batch.delete(activities
      .doc(conn.req.body.activityId)
      .collection('Assignees')
      .doc(phoneNumber)
    );

    /** Deleting from Activities collection inside user Profile */
    conn.batch.delete(profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId)
    );

    index = conn.data.assigneeArray.indexOf(phoneNumber);

    if (index > -1) {
      conn.data.assigneeArray.splice(index, 1);
    }
  });

  setAddendumForUsersWithUid(conn);

  return;
};


const fetchTemplate = (conn) => {
  const template = conn.data.activity.get('template');

  activityTemplates
    .doc(template)
    .get()
    .then((doc) => {
      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: `${conn.requester.displayName || conn.requester.phoneNumber}`
          + ` updated ${doc.get('defaultTitle')}`,
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: conn.data.timestamp,
      };

      conn.data.template = doc;
      unassignFromTheActivity(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


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
        /** This case should probably never execute becase there is NO provision
         * for deleting an activity anywhere. AND, for reaching the fetchDocs()
         * function, the check for the existance of the activity has already
         * been performed in the `Profiles/(phoneNumber)/Activities(activity-id)`.
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

      /** Calling new Date() constructor multiple times is wasteful. */
      conn.data.timestamp = new Date(conn.req.body.timestamp);

      conn.data.activity = result[0];
      conn.data.assigneeArray = [];

      /** The `assigneeArray` is required to add addendum. */
      result[1].forEach((doc) => {
        /** The `doc.id` is the phoneNumber of the assignee. */
        conn.data.assigneeArray.push(doc.id);
      });

      fetchTemplate(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const verifyEditPermission = (conn) => {
  profiles
    .doc(conn.requester.phoneNumber)
    .collection('Activities')
    .doc(conn.req.body.activityId)
    .get()
    .then((doc) => {
      if (!doc.exists) {
        /** The activity does not exist in the system (OR probably
         * only for the user). */
        sendResponse(
          conn,
          code.notFound,
          `An activity with the id: ${conn.req.body.activityId} doesn't exist.`
        );

        return;
      }

      if (!doc.get('canEdit')) {
        /** The `canEdit` flag is false so update is forbidden. */
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
    && Array.isArray(conn.req.body.remove)
    && isValidLocation(conn.req.body.geopoint);
};


const app = (conn) => {
  if (!isValidRequestBody(conn)) {
    sendResponse(
      conn,
      code.badRequest,
      'Invalid request body.'
      + ' Make sure to include the "activityId" (string), "timestamp" (long number),'
      + ' "remove" (array) and the "geopoint" (object) fields in the request body.'
    );

    return;
  }

  /** The support person doesn't need to be an assignee
   * of the activity to make changes.
   */
  if (conn.requester.isSupportRequest) {
    fetchDocs(conn);

    return;
  }

  verifyEditPermission(conn);
};


module.exports = app;
