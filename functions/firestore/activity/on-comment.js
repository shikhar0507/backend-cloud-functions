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


const { isValidRequestBody } = require('./helper');
const { code } = require('../../admin/responses');
const { httpsActions } = require('../../admin/constants');
const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const createDocs = (conn, activity) => {
  const batch = db.batch();
  const addendumDocRef = rootCollections
    .offices
    .doc(activity.get('officeId'))
    .collection('Addendum')
    .doc();

  batch.set(rootCollections
    .activities
    .doc(conn.req.body.activityId), {
      addendumDocRef,
      timestamp: Date.now(),
    }, {
      merge: true,
    });

  const now = new Date();

  batch.set(addendumDocRef, {
    date: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
    dateString: now.toDateString(),
    user: conn.requester.phoneNumber,
    action: httpsActions.comment,
    comment: conn.req.body.comment,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: Date.now(),
    userDeviceTimestamp: conn.req.body.timestamp,
    activityId: conn.req.body.activityId,
    isSupportRequest: conn.requester.isSupportRequest,
    activityData: activity.data(),
    geopointAccuracy: conn.req.body.geopoint.accuracy || null,
    provider: conn.req.body.geopoint.provider || null,
  });

  batch
    .commit()
    .then(() => sendResponse(conn, code.created))
    .catch((error) => handleError(conn, error));
};

const handleNewCommentFlow = (conn) => {
  const {
    isE164PhoneNumber,
  } = require('../../admin/utils');

  if (!isE164PhoneNumber(conn.req.body.assignee)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Invalid/Missing 'assignee' phone number`
    );
  }

  return rootCollections
    .updates
    .where('phoneNumber', '==', conn.req.body.assignee)
    .limit(1)
    .get()
    .then(docs => {
      if (docs.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `${conn.req.body.assignee}`
        );
      }

      return Promise
        .all([
          docs
            .docs[0]
            .ref
            .collection('Addendum')
            .doc()
            .set({
              user: conn.requester.phoneNumber,
              timestamp: conn.req.body.timestamp,
              comment: conn.req.body.comment,
              geopoint: conn.req.body.geopoint,
            }),
          sendResponse(conn, code.created)
        ]);
    })
    .catch(error => handleError(conn, error));
};


module.exports = (conn) => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for '${conn.req.url}'`
      + ' endpoint. Use POST.'
    );
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.comment);

  if (!result.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      result.message
    );
  }

  if (!conn.req.body.activityId) {
    return handleNewCommentFlow(conn);
  }

  return Promise
    .all([
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(conn.requester.phoneNumber)
        .get(),
    ])
    .then(result => {
      const [activity, assignee] = result;

      if (!activity.exists) {
        return sendResponse(
          conn,
          code.badRequest,
          `The activity does not exist`
        );
      }

      if (!assignee.exists) {
        return sendResponse(
          conn,
          code.forbidden,
          `You cannot edit this activity.`
        );
      }

      return createDocs(conn, activity);
    })
    .catch(error => handleError(conn, error));
};
