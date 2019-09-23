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
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');
const {
  subcollectionNames,
} = require('../admin/constants');
const {
  handleError,
  sendResponse,
  sendJSON,
  isValidDate,
  isNonEmptyString,
  getAttendancesPath,
} = require('../admin/utils');
const admin = require('firebase-admin');
const momentTz = require('moment-timezone');


const validateRequest = conn => {
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

const getAddendumObject = doc => {
  const singleDoc = {
    addendumId: doc.id,
    activityId: doc.get('activityId'),
    comment: doc.get('comment'),
    timestamp: doc.get('timestamp'),
    location: doc.get('location'),
    user: doc.get('user'),
    isComment: doc.get('isComment'),
  };

  if (doc.get('assignee')) {
    singleDoc.assignee = doc.get('assignee');
  }

  return singleDoc;
};

const getAssigneesArray = (arrayOfPhoneNumbers) => {
  // Could be a string (phoneNumber) or an object
  const firstItem = arrayOfPhoneNumbers[0];

  if (typeof firstItem !== 'string') {
    // Items are objects with properties
    // displayName, phoneNumber and photoUrl
    return arrayOfPhoneNumbers;
  }

  const result = [];

  // For compatilility with older activities
  arrayOfPhoneNumbers
    .forEach((phoneNumber) => {
      result
        .push({
          phoneNumber,
          displayName: '',
          photoURL: '',
        });
    });

  return result;
};

const getCreator = phoneNumberOrObject => {
  if (typeof phoneNumberOrObject === 'string') {
    return {
      phoneNumber: phoneNumberOrObject,
      displayName: '',
      photoURL: '',
    };
  }

  return phoneNumberOrObject;
};

const getActivityObject = doc => ({
  activityId: doc.id,
  status: doc.get('status'),
  canEdit: doc.get('canEdit'),
  schedule: doc.get('schedule'),
  venue: doc.get('venue'),
  timestamp: doc.get('timestamp'),
  template: doc.get('template'),
  activityName: doc.get('activityName'),
  office: doc.get('office'),
  attachment: doc.get('attachment'),
  creator: getCreator(doc.get('creator')),
  hidden: doc.get('hidden'),
  /**
   * Activity with template -type or customer/branch might
   * not have an assignee, so this array could be undefined
   */
  assignees: getAssigneesArray(doc.get('assignees') || []),
});


const getSubscriptionObject = doc => ({
  template: doc.get('template'),
  schedule: doc.get('schedule'),
  venue: doc.get('venue'),
  attachment: doc.get('attachment'),
  office: doc.get('office'),
  status: doc.get('status'),
  report: doc.get('report') || null,
});


const getStatusObject = async params => {
  const result = [];
  const parentPromises = [];
  const phoneNumber = params.phoneNumber;
  const employeeOf = params.employeeOf || {};
  const momentToday = momentTz();
  const officeNames = Object.keys(employeeOf);
  const fetchPrevMonth = momentToday.date() <= 10;
  // const fetchPrevMonth = true;

  officeNames
    .forEach(name => {
      const officeId = employeeOf[name];
      const startTime = momentToday.startOf('month').valueOf();
      const endTime = momentToday.endOf('month').valueOf();

      const attendanceDocs = getAttendancesPath({
        officeId,
        phoneNumber,
        startTime,
        endTime,
      });

      const reimbursementDocs = getAttendancesPath({
        officeId,
        phoneNumber,
        startTime,
        endTime,
        collectionName: subcollectionNames.REIMBURSEMENTS,
      });

      const transactionDocs = getAttendancesPath({
        officeId,
        phoneNumber,
        startTime,
        endTime,
        collectionName: subcollectionNames.TRANSACTIONS,
      });

      parentPromises
        .push(
          Promise
            .all(attendanceDocs),
          Promise
            .all(reimbursementDocs),
          Promise
            .all(transactionDocs),
        );

      if (fetchPrevMonth) {
        const momentPrevMonth = momentToday
          .clone()
          .subtract(1, 'month');
        const startTime = momentPrevMonth
          .startOf('month')
          .valueOf();
        const endTime = momentPrevMonth
          .endOf('month')
          .valueOf();

        const prevMonthAttendanceDocs = getAttendancesPath({
          officeId,
          phoneNumber,
          startTime,
          endTime,
        });

        const prevMonthReimbursementDocs = getAttendancesPath({
          officeId,
          phoneNumber,
          startTime,
          endTime,
          collectionName: subcollectionNames.REIMBURSEMENTS,
        });

        const prevMonthTransactionDocs = getAttendancesPath({
          officeId,
          phoneNumber,
          startTime,
          endTime,
          collectionName: subcollectionNames.TRANSACTIONS,
        });

        parentPromises
          .push(
            Promise
              .all(prevMonthAttendanceDocs),
            Promise
              .all(prevMonthReimbursementDocs),
            Promise
              .all(prevMonthTransactionDocs),
          );
      }
    });

  const snaps = await Promise
    .all(parentPromises);

  snaps
    .forEach(snap => {
      snap
        .forEach(doc => {
          if (!doc.exists) {
            return;
          }

          const data = doc.data();

          data
            .date = doc.id;

          result
            .push(data);
        });
    });

  return result;
};


const getCustomerObject = doc => {
  return ({
    activityId: doc.id,
    office: doc.get('office'),
    officeId: doc.get('officeId'),
    status: doc.get('status'),
    template: doc.get('template'),
    timestamp: doc.get('timestamp'),
    address: doc.get('venue')[0].address,
    location: doc.get('venue')[0].location,
    latitude: doc.get('venue')[0].geopoint.latitude,
    longitude: doc.get('venue')[0].geopoint.longitude,
    venueDescriptor: doc.get('venue')[0].venueDescriptor,
  });
};


module.exports = async conn => {
  const result = validateRequest(conn);

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  const batch = db.batch();
  const employeeOf = conn.requester.employeeOf || {};
  const officeList = Object.keys(employeeOf);
  const from = parseInt(conn.req.query.from);
  const jsonObject = {
    from,
    upto: from,
    addendum: [],
    activities: [],
    templates: [],
    locations: [],
    statusObject: [],
  };

  if (conn.requester.profileDoc
    && conn.requester.profileDoc.get('statusObject')) {
    jsonObject
      .statusObject = conn
        .requester
        .profileDoc
        .get('statusObject');
  }

  const promises = [
    rootCollections
      .updates
      .doc(conn.requester.uid)
      .collection(subcollectionNames.ADDENDUM)
      .where('timestamp', '>', from)
      .get(),
    rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection(subcollectionNames.ACTIVITIES)
      .where('timestamp', '>', from)
      .get(),
    rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection(subcollectionNames.SUBSCRIPTIONS)
      .where('timestamp', '>', from)
      .get(),
  ];

  const sendLocations = conn
    .requester
    .profileDoc
    && conn
      .requester
      .profileDoc
      .get('lastLocationMapUpdateTimestamp') > from;

  if (sendLocations) {
    const locationPromises = [];

    officeList.forEach(name => {
      const customers = rootCollections
        .offices
        .doc(employeeOf[name])
        .collection(subcollectionNames.ACTIVITIES)
        .where('status', '==', 'CONFIRMED')
        .where('template', '==', 'customer')
        .get();

      const branches = rootCollections
        .offices
        .doc(employeeOf[name])
        .collection(subcollectionNames.ACTIVITIES)
        .where('status', '==', 'CONFIRMED')
        .where('template', '==', 'branch')
        .get();

      locationPromises
        .push(
          customers,
          branches
        );
    });

    promises
      .push(
        Promise
          .all(locationPromises)
      );
  }

  try {
    const [
      addendum,
      activities,
      subscriptions,
      locationResults,
    ] = await Promise
      .all(promises);

    if (!addendum.empty) {
      jsonObject
        .upto = addendum
          .docs[addendum.size - 1]
          .get('timestamp');
    }

    if (locationResults) {
      locationResults
        .forEach(snap => {
          snap
            .forEach(doc => {
              jsonObject
                .locations
                .push(getCustomerObject(doc));
            });
        });
    }

    addendum
      .forEach(doc => {
        jsonObject
          .addendum
          .push(getAddendumObject(doc));
      });

    activities
      .forEach(doc => {
        jsonObject
          .activities
          .push(getActivityObject(doc));
      });

    subscriptions
      .forEach(doc => {
        /** Client side APIs don't allow admin templates. */
        if (doc.get('canEditRule') === 'ADMIN') {
          return;
        }

        jsonObject
          .templates
          .push(getSubscriptionObject(doc));
      });

    const profileUpdate = {
      lastQueryFrom: from,
    };

    if (conn.requester.profileDoc
      && conn.requester.profileDoc.get('statusObject')) {
      profileUpdate
        .statusObject = admin.firestore.FieldValue.delete();
    }

    if (sendLocations) {
      profileUpdate
        .locationsSentForTimestamp = from;
    }

    batch
      .set(rootCollections
        .profiles
        .doc(conn.requester.phoneNumber), profileUpdate, {
        /** Profile has other stuff too. */
        merge: true,
      });

    if (from === 0) {
      jsonObject
        .statusObject = await getStatusObject({
          employeeOf,
          phoneNumber: conn.requester.phoneNumber,
        });
    }

    await batch
      .commit();

    return sendJSON(conn, jsonObject);
  } catch (error) {
    return handleError(conn, error);
  }
};
