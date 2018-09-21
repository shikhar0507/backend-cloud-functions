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
  db,
} = require('../admin/admin');
const {
  beautifySchedule,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');
const {
  handleError,
  sendResponse,
  sendJSON,
  isValidDate,
  isNonEmptyString,
} = require('../admin/utils');


const validateRequest = (conn) => {
  if (conn.req.method !== 'GET') {
    return {
      isValid: false,
      message: `'${conn.req.method}' is not allowed for '/read'. Use 'GET'.`,
    };
  }

  if (!conn.req.query.hasOwnProperty('from')) {
    return {
      isValid: false,
      message: `Missing the query param 'from' in the request URL.`,
    };
  }

  if (!isNonEmptyString(conn.req.query.from)) {
    return {
      isValid: false,
      message: `The query param 'from' cannot be an empty string.`,
    };
  }

  if (!isValidDate(conn.req.query.from)) {
    return {
      isValid: false,
      message: `'${conn.req.query.from}' is not a valid unix timestamp.`,
    };
  }

  return {
    isValid: true,
    message: null,
  };
};

const getAddendumObject = (doc) => {
  return {
    addendumId: doc.id,
    activityId: doc.get('activityId'),
    comment: doc.get('comment'),
    timestamp: doc.get('timestamp').toDate(),
    location: doc.get('location'),
    user: doc.get('user'),
    isComment: doc.get('isComment'),
  };
};

const getActivityObject = (doc) => {
  return {
    activityId: doc.id,
    status: doc.get('status'),
    assignees: doc.get('assignees'),
    canEdit: doc.get('canEdit'),
    /**
     * Schedule objects can have `startTime` and `endTime`
     * equal to either empty strings or Firestore `Date` objects.
     * This function converts them to readable JS `Date` objects
     * and also snips out the `Z` (offset) word.
     */
    schedule: beautifySchedule(doc.get('schedule')),
    venue: doc.get('venue'),
    timestamp: doc.get('timestamp').toDate(),
    template: doc.get('template'),
    activityName: doc.get('activityName'),
    office: doc.get('office'),
    attachment: doc.get('attachment'),
    creator: doc.get('creator'),
    hidden: doc.get('hidden'),
  };
};

const getSubscriptionObject = (doc) => {
  return {
    template: doc.get('template'),
    schedule: doc.get('schedule'),
    venue: doc.get('venue'),
    attachment: doc.get('attachment'),
    office: doc.get('office'),
  };
};


module.exports = (conn) => {
  const result = validateRequest(conn);

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  const newQuery = parseInt(conn.req.query.from);
  const from = new Date(newQuery);
  const jsonObject = {
    from,
    upto: from,
    addendum: [],
    activities: [],
    templates: [],
  };

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

      if (!addendum.empty) {
        jsonObject.upto = addendum
          .docs[addendum.size - 1]
          .get('timestamp')
          .toDate();
      }

      addendum.forEach((doc) =>
        jsonObject.addendum.push(getAddendumObject(doc)));

      activities.forEach((doc) =>
        jsonObject.activities.push(getActivityObject(doc)));

      subscriptions.forEach((doc) =>
        jsonObject.templates.push(getSubscriptionObject(doc)));

      const batch = db.batch();

      batch.set(rootCollections
        .profiles
        .doc(conn.requester.phoneNumber), {
          lastQueryFrom: newQuery,
        }, {
          /** Profile has other stuff too. */
          merge: true,
        });

      return batch.commit();
    })
    .then(() => sendJSON(conn, jsonObject))
    .catch((error) => handleError(conn, error));
};
