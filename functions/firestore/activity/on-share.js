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
  getCanEditValue,
  checkActivityAndAssignee,
} = require('./helper');
const { code } = require('../../admin/responses');
const { httpsActions } = require('../../admin/constants');
const {
  db,
  // serverTimestamp,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

// const serverTimestamp = Date.now();
const moment = require('moment');
const timestamp = Number(moment().utc().format('x'));


/**
 * Processes the `result` from the Firestore and saves the data to variables
 * for use in the function flow.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Array} docs Docs fetched from Firestore.
 * @returns {void}
 */
const handleResult = (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  let allAreNew = true;
  let phoneNumber;

  docs.forEach((doc, index) => {
    /**
     * The first two docs are activity doc and the
     * requester's doc. They have already been validated above.
     */
    if (index === 0) return;
    if (index === 1) return;

    /**
     * If an `assignee` already exists in the Activity assignee list.
     */
    if (doc.exists) {
      allAreNew = false;
      phoneNumber = doc.id;
    }
  });

  if (!allAreNew) {
    sendResponse(
      conn,
      code.badRequest,
      `${phoneNumber} is already an assignee of the activity.`
    );

    return;
  }

  const [activity] = docs;

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

  /**
   * The `share` array from the request body may not
   * have all valid phone numbers.
   */
  conn.req.body.share.forEach((phoneNumber) => {
    const isRequester = phoneNumber === conn.requester.phoneNumber;

    locals.objects.permissions[phoneNumber] = {
      isAdmin: false,
      isEmployee: false,
      isCreator: isRequester,
    };

    if (locals.static.template === 'employee') {
      promises.push(rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection('Activities')
        .where('attachment.Employee Contact.value', '==', phoneNumber)
        .where('template', '==', 'employee')
        .limit(1)
        .get()
      );
    }

    if (locals.static.template === 'admin') {
      promises.push(rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection('Activities')
        .where('attachment.Admin.value', '==', phoneNumber)
        .where('template', '==', 'admin')
        .limit(1)
        .get()
      );
    }
  });

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

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

      const batch = db.batch();
      let addToInclude = true;

      conn.req.body.share.forEach((phoneNumber) => {
        const isRequester = conn.requester.phoneNumber === phoneNumber;

        if (locals.static.template === 'subscription' && isRequester) {
          addToInclude = false;
        }

        batch.set(rootCollections
          .activities
          .doc(conn.req.body.activityId)
          .collection('Assignees')
          .doc(phoneNumber), {
            addToInclude,
            canEdit: getCanEditValue(locals, phoneNumber),
          });
      });

      const addendumDocRef = rootCollections
        .offices
        .doc(activity.get('officeId'))
        .collection('Addendum')
        .doc();

      batch.set(rootCollections
        .activities
        .doc(conn.req.body.activityId), {
          addendumDocRef,
          timestamp,
        }, {
          merge: true,
        });

      batch.set(addendumDocRef, {
        activityData: activity.data(),
        user: conn.requester.phoneNumber,
        share: conn.req.body.share,
        action: httpsActions.share,
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp,
        userDeviceTimestamp: conn.req.body.timestamp,
        activityId: conn.req.body.activityId,
        activityName: activity.get('activityName'),
        isSupportRequest: conn.requester.isSupportRequest,
      });

      return batch.commit();
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  if (conn.req.method !== 'PATCH') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /share endpoint. Use PATCH.`
    );

    return;
  }


  const result = isValidRequestBody(conn.req.body, httpsActions.share);

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  const activityRef = rootCollections.activities.doc(conn.req.body.activityId);
  const assigneesCollectionRef = activityRef.collection('Assignees');

  const promises = [
    activityRef
      .get(),
    assigneesCollectionRef
      .doc(conn.requester.phoneNumber)
      .get(),
  ];

  conn.req.body.share.forEach(
    (phoneNumber) =>
      promises.push(assigneesCollectionRef.doc(phoneNumber).get())
  );

  Promise
    .all(promises)
    .then((docs) => handleResult(conn, docs))
    .catch((error) => handleError(conn, error));
};
