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
  isValidRequestBody,
  checkActivityAndAssignee,
} = require('./helper');
const { code } = require('../../admin/responses');
const { httpsActions } = require('../../admin/constants');
const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  getAuth,
  handleError,
  sendResponse,
  getCanEditValue,
} = require('../../admin/utils');


/**
 * Processes the `result` from the Firestore and saves the data to variables
 * for use in the function flow.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Array} docs Docs fetched from Firestore.
 * @returns {void}
 */
const handleResult = async (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      result.message
    );
  }

  let allAreNew = true;
  let phoneNumber;

  const [
    activity
  ] = docs;

  if (!getCanEditValue(activity, conn.requester)) {
    return sendResponse(
      conn,
      code.forbidden,
      `You cannot edit this activity`
    );
  }

  const batch = db.batch();
  const template = activity.get('template');
  const isSpecialTemplate = template === 'recipient';

  docs
    .forEach((doc, index) => {
      /**
       * The first two docs are activity doc and the
       * requester's doc. They have already been validated above.
       */
      const isActivityDoc = index === 0;
      const isRequesterAssigneeDoc = index === 1;

      if (isActivityDoc) {
        return;
      }

      if (isRequesterAssigneeDoc) {
        return;
      }

      /**
       * If an `assignee` already exists in the Activity assignee list.
       */
      if (doc.exists) {
        allAreNew = false;
        phoneNumber = doc.id;
      }
    });

  if (!allAreNew
    && !isSpecialTemplate) {
    return sendResponse(
      conn,
      code.badRequest,
      `${phoneNumber} is already an assignee of the activity.`
    );
  }

  const locals = {
    objects: {
      permissions: {},
    },
    static: {
      officeId: activity.get('officeId'),
      canEditRule: activity.get('canEditRule'),
      template: activity.get('template'),
    },
  };

  const promises = [];
  const checkIns = activity.get('checkIns') || {};
  const addendumDocRef = rootCollections
    .offices
    .doc(activity.get('officeId'))
    .collection('Addendum')
    .doc();

  const activityUpdate = {
    addendumDocRef,
    timestamp: Date.now(),
  };

  if (activity.get('template') === 'duty') {
    activityUpdate
      .checkIns = {};
  }

  const authPromises = [];

  /**
   * The `share` array from the request body may not
   * have all valid phone numbers.
   */
  conn.req.body.share.forEach(phoneNumber => {
    const isRequester = phoneNumber === conn.requester.phoneNumber;

    locals
      .objects
      .permissions[phoneNumber] = {
        isAdmin: false,
        isEmployee: false,
        isCreator: isRequester,
      };

    if (activity.get('template') === 'duty'
      && !checkIns.hasOwnProperty(phoneNumber)) {
      activityUpdate
        .checkIns[phoneNumber] = [];

      authPromises.push(getAuth(phoneNumber));
    }

    if (activity.get('canEditRule') === 'EMPLOYEE') {
      promises
        .push(rootCollections
          .offices
          .doc(activity.get('officeId'))
          .collection('Activities')
          .where('attachment.Employee Contact.value', '==', phoneNumber)
          .where('template', '==', 'employee')
          .limit(1)
          .get()
        );
    }

    if (activity.get('canEditRule') === 'ADMIN') {
      promises
        .push(rootCollections
          .offices
          .doc(activity.get('officeId'))
          .collection('Activities')
          .where('attachment.Admin.value', '==', phoneNumber)
          .where('template', '==', 'admin')
          .limit(1)
          .get()
        );
    }
  });

  // All assignees in duty should have `auth`
  if (activity.get('template') === 'duty') {
    const userRecords = await Promise
      .all(authPromises);

    for (const userRecord of userRecords) {
      if (userRecord.uid) {
        continue;
      }

      return sendResponse(
        conn,
        code.conflict,
        `${userRecord.phoneNumber} is not an active user`
      );
    }
  }

  const snapShots = await Promise
    .all(promises);

  snapShots
    .forEach(snapShot => {
      if (snapShot.empty) {
        return;
      }

      let phoneNumber;
      const doc = snapShot.docs[0];
      const template = doc.get('template');
      const isAdmin = template === 'admin';
      const isEmployee = template === 'employee';

      if (isAdmin) {
        phoneNumber = doc.get('attachment.Admin.value');
        locals.objects.permissions[phoneNumber].isAdmin = isAdmin;
      }

      if (isEmployee) {
        phoneNumber = doc.get('attachment.Employee Contact.value');
        locals.objects.permissions[phoneNumber].isEmployee = isEmployee;
      }
    });

  let addToInclude = true;

  conn.req.body.share.forEach(phoneNumber => {
    const isRequester = conn.requester.phoneNumber === phoneNumber;

    if (activity.get('template') === 'subscription'
      && isRequester) {
      addToInclude = false;
    }

    batch
      .set(rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(phoneNumber), { addToInclude });
  });

  batch
    .set(rootCollections
      .activities
      .doc(conn.req.body.activityId), activityUpdate, {
      merge: true,
    });

  const now = new Date();

  batch
    .set(addendumDocRef, {
      date: now.getDate(),
      month: now.getMonth(),
      year: now.getFullYear(),
      dateString: now.toDateString(),
      activityData: activity.data(),
      user: conn.requester.phoneNumber,
      share: conn.req.body.share,
      action: httpsActions.share,
      location: getGeopointObject(conn.req.body.geopoint),
      timestamp: Date.now(),
      userDeviceTimestamp: conn.req.body.timestamp,
      activityId: conn.req.body.activityId,
      activityName: activity.get('activityName'),
      isSupportRequest: conn.requester.isSupportRequest,
      provider: conn.req.body.geopoint.provider || null,
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      userDisplayName: conn.requester.displayName,
    });

  await batch
    .commit();

  return sendResponse(
    conn,
    code.ok,
    ''
  );
};


module.exports = conn => {
  if (conn.req.method !== 'PATCH') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /share endpoint. Use PATCH.`
    );
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.share);

  if (!result.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      result.message
    );
  }

  const activityRef = rootCollections
    .activities
    .doc(conn.req.body.activityId);
  const assigneesCollectionRef = activityRef
    .collection('Assignees');

  const promises = [
    activityRef
      .get(),
    assigneesCollectionRef
      .doc(conn.requester.phoneNumber)
      .get(),
  ];

  // TODO: Handle large number of phone number of phone numbers in the field
  // 'share'. Firestore batch only accepts 500 docs at once.
  conn
    .req
    .body
    .share.forEach(phoneNumber =>
      promises.push(assigneesCollectionRef.doc(phoneNumber).get())
    );

  return Promise
    .all(promises)
    .then(docs => handleResult(conn, docs))
    .catch(error => handleError(conn, error));
};
