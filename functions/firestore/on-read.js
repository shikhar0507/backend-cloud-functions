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


const { rootCollections, serverTimestamp, db, } = require('../admin/admin');
const { beautifySchedule, } = require('../admin/utils');
const { code, } = require('../admin/responses');
const {
  handleError,
  sendResponse,
  sendJSON,
  isValidDate,
  getISO8601Date,
} = require('../admin/utils');


const validateRequest = (conn) => {
  if (conn.req.method !== 'GET') {
    return {
      isValid: false, message: `'${conn.req.method}' is not allowed for`
        + ` '/read'. Use 'GET'.`,
    };
  }

  if (!conn.req.query.hasOwnProperty('from')) {
    return {
      isValid: false,
      message: `Missing the query param 'from' in the request URL.`,
    };
  }

  if (!isValidDate(conn.req.query.from)) {
    return {
      isValid: false,
      message: `'${conn.req.query.from}' is not a valid unix timestamp.`,
    };
  }

  return { isValid: true, message: null, };
};


const makeLogs = (conn, jsonObject) => {
  const batch = db.batch();

  if (conn.req.query.from === '0') {
    batch.set(rootCollections
      .dailyInits
      .doc(getISO8601Date())
      .collection(conn.requester.phoneNumber)
      .doc(), {
        timestamp: serverTimestamp,
      });
  }

  if (conn.requester.lastFromQuery !== conn.req.query.from) {
    batch.set(rootCollections
      .profiles
      .doc(conn.requester.phoneNumber), {
        lastFromQuery: conn.req.query.from,
      }, {
        merge: true,
      });
  }

  console.log({
    lastFromQuery: conn.requester.lastFromQuery,
    from: conn.req.query.from,
  });

  console.log('batch', batch._writes);

  batch
    .commit()
    .then(() => sendJSON(conn, jsonObject))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  const result = validateRequest(conn);

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  const from = new Date(parseInt(conn.req.query.from));

  Promise
    .all([
      rootCollections
        .updates.doc(conn.requester.uid)
        .collection('Addendum')
        .where('timestamp', '>', from)
        .get(),
      rootCollections
        .profiles.doc(conn.requester.phoneNumber)
        .collection('Activities')
        .where('timestamp', '>', from)
        .get(),
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .where('timestamp', '>', from)
        .get(),
    ])
    .then((result) => {
      const [addendum, activities, subscriptions,] = result;

      const jsonObject = {
        from,
        upto: from,
        addendum: [],
        activities: [],
        templates: [],
      };

      if (!addendum.empty) {
        jsonObject.upto =
          addendum
            .docs[addendum.size - 1]
            .get('timestamp')
            .toDate();
      }

      addendum.forEach((doc) => {
        jsonObject.addendum.push({
          addendumId: doc.id,
          activityId: doc.get('activityId'),
          comment: doc.get('comment'),
          timestamp: doc.get('timestamp').toDate(),
          location: doc.get('location'),
          user: doc.get('user'),
        });
      });

      activities.forEach((doc) => {
        jsonObject.activities.push({
          activityId: doc.id,
          status: doc.get('status'),
          assignees: doc.get('assignees'),
          canEdit: doc.get('canEdit'),
          schedule: beautifySchedule(doc.get('schedule')),
          venue: doc.get('venue'),
          timestamp: doc.get('timestamp').toDate(),
          template: doc.get('template'),
          activityName: doc.get('activityName'),
          office: doc.get('office'),
          attachment: doc.get('attachment'),
          creator: doc.get('creator'),
          hidden: doc.get('hidden'),
        });
      });

      subscriptions.forEach((doc) => {
        jsonObject.templates.push({
          template: doc.get('template'),
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          attachment: doc.get('attachment'),
          office: doc.get('office'),
        });
      });

      makeLogs(conn, jsonObject);

      return;
    })
    .catch((error) => handleError(conn, error));
};
