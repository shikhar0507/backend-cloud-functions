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

const { handleCanEdit, isValidRequestBody, } = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
  logDailyActivities,
} = require('../../admin/utils');


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

  logDailyActivities(conn, locals, code.noContent);
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
          locals.batch.set(rootCollections
            .updates
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
  let comment = `${conn.requester.phoneNumber} shared this activity with: `;

  conn.req.body.share.forEach((phoneNumber) => {
    if (!isE164PhoneNumber(phoneNumber)) return;

    comment += `${phoneNumber}, `;

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
          locals,
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
          locals,
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

  locals.addendum.comment = comment.trim();

  setAddendumForUsersWithUid(conn, locals);
};


/**
 * Fetches the template and subscription docs.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const fetchTemplateAndSubscription = (conn, locals) =>
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
        user: conn.requester.phoneNumber,
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: locals.timestamp,
      };

      locals.template = docsArray[0];
      locals.include = docsArray[1].docs[0].get('include');

      /** No addendum is added for the people in `include`
       * array for a support request.
       */
      if (conn.requester.isSupportRequest) {
        locals.include = [];
      }

      addAddendumForAssignees(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


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

  locals.canEditRule = result[0].get('canEditRule');

  /** The assigneeArray is required to add addendum.
   * The `doc.id` is the phoneNumber of the assignee.
   */
  locals.assigneeArray = [];
  result[1].forEach((doc) => locals.assigneeArray.push(doc.id));

  fetchTemplateAndSubscription(conn, locals);
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


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'share');

  if (!result.isValidBody) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  /** The support person doesn't need to be an assignee
   * of the activity to make changes.
   */
  if (conn.requester.isSupportRequest) {
    fetchTemplateAndSubscription(conn);

    return;
  }

  verifyEditPermission(conn);
};
