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
  db,
  serverTimestamp,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');

const { isValidRequestBody, getCanEditValue, } = require('./helper');

const { code, } = require('../../admin/responses');

const { httpsActions, } = require('../../admin/attachment-types');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


/**
 * Processes the `result` from the Firestore and saves the data to variables
 * for use in the function flow.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Array} result Docs fetched from Firestore.
 * @returns {void}
 */
const handleResult = (conn, result) => {
  const profileActivity = result[0];
  const activity = result[1];

  if (!conn.requester.isSupportRequest) {
    if (!profileActivity.exists) {
      sendResponse(
        conn,
        code.badRequest,
        `No activity found with the id: '${conn.req.body.activityId}'.`
      );

      return;
    }

    if (!profileActivity.get('canEdit')) {
      sendResponse(
        conn,
        code.badRequest,
        `You cannot edit this activity.`
      );

      return;
    }
  }

  const locals = {
    objects: {
      permissions: {},
    },
    static: {
      officeId: activity.get('officeId'),
      canEditRule: activity.get('canEditRule'),
    },
  };

  const promises = [];

  /**
   * The `share` array from the request body may not
   * have all valid phone numbers.
   */
  conn.req.body.share.forEach((phoneNumber) => {
    const isRequester = phoneNumber === conn.requester.phoneNumber;

    if (isRequester && conn.requester.isSupportRequest) return;

    locals.objects.permissions[phoneNumber] = {
      isAdmin: false,
      isEmployee: false,
      isCreator: isRequester,
    };

    promises.push(rootCollections
      .offices
      .doc(locals.static.officeId)
      .collection('Activities')
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .where('template', '==', 'employee')
      .limit(1)
      .get()
    );

    promises.push(rootCollections
      .offices
      .doc(locals.static.officeId)
      .collection('Activities')
      .where('attachment."Phone Number".value', '==', phoneNumber)
      .where('template', '==', 'admin')
      .limit(1)
      .get()
    );
  });

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const template = doc.get('template');
        const phoneNumber = doc.get('attachment.Phone Number.value');

        /** The person can either be an `employee` or an `admin`. */
        if (template === 'admin') {
          locals.objects.permissions[phoneNumber].isAdmin = true;

          return;
        }

        locals.objects.permissions[phoneNumber].isEmployee = true;
      });

      const batch = db.batch();

      conn.req.body.share.forEach((phoneNumber) => {
        batch.set(rootCollections
          .activities
          .doc(conn.req.body.activityId)
          .collection('Assignees')
          .doc(phoneNumber), {
            canEdit: getCanEditValue(locals, phoneNumber),
            activityId: conn.req.body.activityId,
          });
      });

      batch.set(rootCollections
        .activities
        .doc(conn.req.body.activityId), {
          timestamp: serverTimestamp,
        }, {
          merge: true,
        });

      batch.set(rootCollections
        .offices
        .doc(activity.get('officeId'))
        .collection('Addendum')
        .doc(), {
          user: conn.requester.phoneNumber,
          share: conn.req.body.share,
          remove: null,
          action: httpsActions.share,
          status: null,
          comment: null,
          template: null,
          location: getGeopointObject(conn.req.body.geopoint),
          timestamp: serverTimestamp,
          userDeviceTimestamp: new Date(conn.req.body.timestamp),
          activityId: conn.req.body.activityId,
          activityName: activity.get('activityName'),
          updatedFields: null,
          updatedPhoneNumber: null,
          isSupportRequest: conn.requester.isSupportRequest,
        });

      return batch.commit();
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  console.log('\n'.repeat(10));

  const result = isValidRequestBody(conn.req.body, 'share');

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  Promise
    .all([
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Activities')
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};
