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


const { rootCollections, getGeopointObject, db, } = require('../../admin/admin');

const { handleCanEdit, } = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  getISO8601Date,
  isValidDate,
  isNonEmptyString,
  isValidGeopoint,
  isE164PhoneNumber,
} = require('../../admin/utils');



/**
 * Commits the batch to the DB.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} locals Object containing local data.
 * @returns {Promise} Batch Object.
 */
const commitBatch = (conn, locals) =>
  locals.batch.commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));


/**
 * Adds a doc in `/DailyActivities` collection in the path:
 * `/(office name)/(template name)` with the user's phone number,
 * timestamp of the request and the api used.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateDailyActivities = (conn, locals) => {
  const docId = getISO8601Date(locals.timestamp);

  locals.batch.set(rootCollections
    .dailyActivities
    .doc(docId)
    .collection('Logs')
    .doc(), {
      office: locals.activity.get('office'),
      timestamp: locals.timestamp,
      template: locals.activity.get('template'),
      phoneNumber: conn.requester.phoneNumber,
      url: conn.req.url,
      activityId: conn.req.body.activityId,
    });

  commitBatch(conn, locals);
};


/**
 * Updates the timestamp in the activity root document.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateActivityDoc = (conn, locals) => {
  locals.batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
      timestamp: locals.timestamp,
    }, {
      merge: true,
    }
  );

  updateDailyActivities(conn, locals);
};


/**
 * Adds the documents to batch for the users who have their `uid` populated
 * inside their profiles.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const setAddendumForUsersWithUid = (conn, locals) => {
  /** Assignee array can have duplicate elements. */
  const assigneeListWithUniques = Array.from(new Set(locals.assigneeArray));
  const promises = [];

  assigneeListWithUniques.forEach((phoneNumber) => {
    promises.push(rootCollections.profiles.doc(phoneNumber).get());

    locals.batch.set(rootCollections
      .profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId), {
        timestamp: locals.timestamp,
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
          locals.batch.set(rootCollections.profiles.doc(doc.id), {
            uid: null,
          });
        }

        if (doc.exists && doc.get('uid')) {
          /** The `uid` is NOT `null` OR `undefined` */
          locals.batch.set(rootCollections.updates
            .doc(doc.get('uid'))
            .collection('Addendum')
            .doc(),
            locals.addendum
          );
        }
      });

      updateActivityDoc(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Adds addendum for all the assignees of the activity.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addAddendumForAssignees = (conn, locals) => {
  conn.req.body.share.forEach((phoneNumber) => {
    if (!isE164PhoneNumber(phoneNumber)) return;

    /** The requester shouldn't be added to the activity assignee list
     * if the request is of `support` type.
     */
    if (phoneNumber === conn.requester.phoneNumber
      && conn.requester.isSupportRequest) return;

    /** Adding a doc with the id = phoneNumber in
     * `Activities/(activityId)/Assignees`
     * */
    locals.batch.set(rootCollections
      .activities
      .doc(conn.req.body.activityId)
      .collection('Assignees')
      .doc(phoneNumber), {
        canEdit: handleCanEdit(
          locals.subscription,
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
    locals.batch.set(rootCollections
      .profiles
      .doc(phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId), {
        canEdit: handleCanEdit(
          locals.subscription,
          phoneNumber,
          conn.requester.phoneNumber
        ),
        timestamp: locals.timestamp,
      }, {
        merge: true,
      }
    );

    locals.assigneeArray.push(phoneNumber);
  });

  setAddendumForUsersWithUid(conn, locals);
};


const fetchTemplateAndSubscriptions = (conn, locals) => {
  Promise
    .all([
      rootCollections
        .activityTemplates
        .doc(locals.activity.get('template'))
        .get(),
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .where('office', '==', locals.activity.get('office'))
        .where('template', '==', locals.activity.get('template'))
        .limit(1)
        .get(),
    ])
    .then((docsArray) => {
      locals.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: `${conn.requester.displayName} || ${conn.requester.phoneNumber}`
          + ` updated ${docsArray[0].get('defaultTitle')}`,
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: locals.timestamp,
      };

      locals.template = docsArray[0];
      locals.subscription = docsArray[1].docs[0];

      if (conn.requester.isSupportRequest) {
        locals.subscription = {};

        locals.subscription
          .canEditRule = locals.activity.get('canEditRule');
      }

      addAddendumForAssignees(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};

const handleResult = (conn, result) => {
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

  const locals = {};
  locals.batch = db.batch();

  /** Calling `new Date()` constructor multiple times is wasteful. */
  locals.timestamp = new Date(conn.req.body.timestamp);

  locals.activity = result[0];

  /** The assigneeArray is required to add addendum.
   * The `doc.id` is the phoneNumber of the assignee.
   */
  locals.assigneeArray = [];
  result[1].forEach((doc) => locals.assigneeArray.push(doc.id));

  fetchTemplateAndSubscriptions(conn, locals);
};


/**
 * Fetches the activity doc, along with all the `assignees` of the activity
 * using the `activityId` from the `request body`.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {void}
 */
const fetchDocs = (conn) =>
  Promise
    .all([
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));


/**
 * Checks if the requester has the permission to perform an update
 * to this activity. For this to happen, the `canEdit` flag is checked.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @returns {void}
 */
const verifyEditPermission = (conn) =>
  rootCollections
    .profiles
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


const isValidRequestBody = (body) => {
  return isValidDate(body.timestamp)
    && isNonEmptyString(body.activityId)
    && Array.isArray(body.share)
    && isValidGeopoint(body.geopoint);
};


module.exports = (conn) => {
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
