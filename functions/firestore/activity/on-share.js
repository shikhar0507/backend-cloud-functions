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
  getISO8601Date,
} = require('../../admin/utils');

const {
  handleCanEdit,
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


/**
 * Commits the batch to the DB.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {Promise} Batch Object.
 */
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
  const docId = getISO8601Date(conn.data.timestamp);

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
    });

  commitBatch(conn);
};


/**
 * Updates the timestamp in the activity root document.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {void}
 */
const updateActivityDoc = (conn) => {
  conn.batch.set(activities
    .doc(conn.req.body.activityId), {
      timestamp: conn.data.timestamp,
    }, {
      merge: true,
    }
  );

  updateDailyActivities(conn);
};


/**
 * Adds the documents to batch for the users who have their `uid` populated
 * inside their profiles.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {void}
 */
const setAddendumForUsersWithUid = (conn) => {
  /** Assignee array can have duplicate elements. */
  const assigneeListWithUniques = Array.from(new Set(conn.data.assigneeArray));
  const promises = [];

  assigneeListWithUniques.forEach((phoneNumber) => {
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
        /** Create Profiles for the users who don't have a profile already. */
        if (!doc.exists) {
          /** The `doc.id` is the `phoneNumber` that doesn't exist */
          conn.batch.set(profiles.doc(doc.id), {
            uid: null,
          });
        }

        if (doc.exists && doc.get('uid')) {
          /** The `uid` is NOT `null` OR `undefined` */
          conn.batch.set(updates
            .doc(doc.get('uid'))
            .collection('Addendum')
            .doc(),
            conn.addendum
          );
        }
      });

      updateActivityDoc(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const addAddendumForAssignees = (conn) => {
  conn.req.body.share.forEach((phoneNumber) => {
    if (!isValidPhoneNumber(phoneNumber)) return;

    /** The requester shouldn't be added to the activity assignee list
     * if the request is of `support` type.
     */
    if (phoneNumber === conn.requester.phoneNumber
      && conn.requester.isSupportRequest) return;

    /** Adding a doc with the id = phoneNumber in
     * `Activities/(activityId)/Assignees`
     * */
    conn.batch.set(activities
      .doc(conn.req.body.activityId)
      .collection('Assignees')
      .doc(phoneNumber), {
        canEdit: handleCanEdit(
          conn.data.subscription,
          phoneNumber,
          conn.requester.phoneNumber
        ),
      }, {
        merge: true,
      }
    );

    /** Adding a doc with the id = activityId inside
     *  Profiles/(phoneNumber)/Activities/(activityId)
     * */
    conn.batch.set(profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId), {
        canEdit: handleCanEdit(
          conn.data.subscription,
          phoneNumber,
          conn.requester.phoneNumber
        ),
        timestamp: conn.data.timestamp,
      }, {
        merge: true,
      }
    );

    conn.data.assigneeArray.push(phoneNumber);
  });

  setAddendumForUsersWithUid(conn);
};


const fetchTemplateAndSubscriptions = (conn) => {
  Promise
    .all([
      activityTemplates
        .doc(conn.data.activity.get('template'))
        .get(),
      profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .where('office', '==', conn.data.activity.get('office'))
        .where('template', '==', conn.data.activity.get('template'))
        .limit(1)
        .get(),
    ])
    .then((docsArray) => {
      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: `${conn.requester.displayName} || ${conn.requester.phoneNumber}`
          + ` updated ${docsArray[0].get('defaultTitle')}`,
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: conn.data.timestamp,
      };

      conn.data.template = docsArray[0];
      conn.data.subscription = docsArray[1].docs[0];

      if (conn.requester.isSupportRequest) {
        conn.data.subscription = {};

        conn.data.subscription.canEditRule
          = conn.data.activity.get('canEditRule');
      }

      addAddendumForAssignees(conn);

      return;
    })
    .catch((error) => handleError(conn, error));
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

      /** Calling new Date() constructor multiple times is wasteful. */
      conn.data.timestamp = new Date(conn.req.body.timestamp);

      conn.data.activity = result[0];
      conn.data.assigneeArray = [];

      /** The assigneeArray is required to add addendum. */
      result[1].forEach((doc) => {
        /** The `doc.id` is the phoneNumber of the assignee. */
        conn.data.assigneeArray.push(doc.id);
      });

      fetchTemplateAndSubscriptions(conn);

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
        /** The activity doesn't exist for the user */
        sendResponse(
          conn,
          code.notFound,
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
    })
    .catch((error) => handleError(conn, error));
};


const isValidRequestBody = (body) => {
  return isValidDate(body.timestamp) &&
    isValidString(body.activityId) &&
    Array.isArray(body.share) &&
    isValidLocation(body.geopoint);
};


const app = (conn) => {
  if (!isValidRequestBody(conn.req.body)) {
    sendResponse(
      conn,
      code.badRequest,
      'Invalid Request body.'
      + ' Make sure to include the "activityId" (string), "timestamp" (long number),'
      + ' "geopoint" (object) and the "share" (array) fields in the request body.'
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
