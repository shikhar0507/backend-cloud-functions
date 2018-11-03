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
} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  sendJSON,
  isNonEmptyString,
  hasAdminClaims,
  convertToDates,
  hasSupportClaims,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');


module.exports = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'GET'`
    );

    return;
  }

  if (!hasAdminClaims(conn.requester.customClaims)
    || hasSupportClaims(conn.requester.customClaims)) {
    sendResponse(
      conn,
      code.forbidden,
      `You are not authorized to access this resource.`
    );

    return;
  }

  if (!conn.req.query.hasOwnProperty('deviceId')
    || !isNonEmptyString(conn.req.query.deviceId)) {
    sendResponse(
      conn,
      code.badRequest,
      `Missing or invalid 'deviceId' in the request url`
    );

    return;
  }

  const responseObject = {
    timestamp: Date.now(),
  };

  if (conn.requester.customClaims.support) {
    sendJSON(conn, responseObject);

    return;
  }

  const officeNamesArray = conn.requester.customClaims.admin;
  const promises = [];
  /** Only admin gets the office docs */
  responseObject.activities = [];

  officeNamesArray.forEach((name) => {
    promises.push(rootCollections
      .offices.where('office', '==', name)
      .get());
  });

  const getActivityObject = (doc) => {
    return {
      activityName: doc.get('activityName'),
      adminsCanEdit: doc.get('adminsCanEdit'),
      attachment: doc.get('attachment'),
      canEditRule: doc.get('canEditRule'),
      creator: doc.get('creator'),
      hidden: doc.get('hidden'),
      office: doc.get('office'),
      officeId: doc.get('officeId'),
      // schedule: convertToDates(doc.get('schedule')),
      schedule: doc.get('schedule'),
      status: doc.get('status'),
      template: doc.get('template'),
      timestamp: doc.get('timestamp'),
      venue: doc.get('venue'),
    };
  };

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        const doc = snapShot.docs[0];

        responseObject.activities.push(getActivityObject(doc));
      });

      // TODO: Log the `deviceId`
      sendJSON(conn, responseObject);

      return;
    })
    .catch((error) => handleError(conn, error));
};
