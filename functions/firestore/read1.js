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
  addendumTypes,
} = require('../admin/constants');
const {
  sendJSON,
  isValidDate,
  handleError,
  sendResponse,
  isNonEmptyString,
} = require('../admin/utils');


const validateRequest = conn => {
  if (conn.req.method !== 'GET') {
    return `'${conn.req.method}' is not allowed for '/read'. Use 'GET'.`;
  }

  if (!conn.req.query.hasOwnProperty('from')) {
    return `Missing the query param 'from' in the request URL.`;
  }

  if (!isNonEmptyString(conn.req.query.from)) {
    return `The query param 'from' cannot be an empty string.`;
  }

  if (!isValidDate(conn.req.query.from)) {
    return `'${conn.req.query.from}' is not a valid unix timestamp.`;
  }

  return null;
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

const getAssigneesArray = arrayOfPhoneNumbers => {
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

const getActivityObject = (doc, customClaims, employeeOf, phoneNumber) => {
  const canEditRule = doc.get('canEditRule');
  const office = doc.get('office');
  const creator = doc.get('creator.phoneNumber')
    || doc.get('creator');

  const canEdit = (() => {
    if (canEditRule === 'ALL') {
      return true;
    }

    if (canEditRule === 'CREATOR') {
      return creator === phoneNumber;
    }

    if (canEditRule === 'ADMIN') {
      return customClaims
        && Array.isArray(customClaims.admin)
        && customClaims.admin.includes(office);
    }

    if (canEditRule === 'EMPLOYEE') {
      return employeeOf
        && employeeOf.hasOwnProperty(office);
    }

    // canEditRule => NONE
    return false;
  })();

  return {
    canEdit,
    activityId: doc.id,
    status: doc.get('status'),
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
  };
};


const getSubscriptionObject = doc => ({
  template: doc.get('template'),
  schedule: doc.get('schedule'),
  venue: doc.get('venue'),
  attachment: doc.get('attachment'),
  office: doc.get('office'),
  status: doc.get('status'),
  report: doc.get('report') || null,
});


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
  const v = validateRequest(conn);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  const batch = db.batch();
  const employeeOf = conn.requester.employeeOf || {};
  const customClaims = conn.requester.customClaims || {};
  const phoneNumber = conn.requester.phoneNumber;
  const officeList = Object.keys(employeeOf);
  const from = parseInt(conn.req.query.from);
  const locationPromises = [];
  const jsonObject = {
    from,
    upto: from,
    addendum: [],
    activities: [],
    templates: [],
    locations: [],
    payments: [],
    attendances: [],
    reimbursements: [],
  };

  const promises = [
    rootCollections
      .updates
      .doc(conn.requester.uid)
      .collection(subcollectionNames.ADDENDUM)
      .where('timestamp', '>', from)
      .get(),
  ];

  if (from === 0) {
    promises
      .push(
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
          .get()
      );
  }

  const sendLocations = conn
    .requester
    .profileDoc
    && conn
      .requester
      .profileDoc
      .get('lastLocationMapUpdateTimestamp') > from;

  if (sendLocations) {
    officeList
      .forEach(name => {
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
  }

  try {
    const [
      addendum,
      activities,
      subscriptions,
    ] = await Promise
      .all(promises);

    (subscriptions || [])
      .forEach(doc => {
        /** Client side APIs don't allow admin templates. */
        if (doc.get('canEditRule') === 'ADMIN') {
          return;
        }

        jsonObject
          .templates
          .push(getSubscriptionObject(doc));
      });

    (activities || [])
      .forEach(doc => {
        jsonObject
          .activities
          .push(
            getActivityObject(doc, customClaims, employeeOf, phoneNumber)
          );
      });

    const locationResults = await Promise
      .all(locationPromises);

    locationResults
      .forEach(snapShot => {
        snapShot
          .forEach(doc => {
            jsonObject
              .locations
              .push(getCustomerObject(doc));
          });
      });

    if (!addendum.empty) {
      jsonObject
        .upto = addendum.docs[addendum.size - 1].get('timestamp');
    }

    addendum
      .forEach(doc => {
        const type = doc.get('_type') || doc.get('type');

        if (type === addendumTypes.SUBSCRIPTION) {
          jsonObject
            .templates
            .push(getSubscriptionObject(doc));

          return;
        }

        if (type === addendumTypes.ACTIVITY) {
          jsonObject
            .activities
            .push(getActivityObject(doc, customClaims, employeeOf, phoneNumber));

          return;
        }

        if (type === addendumTypes.ATTENDANCE) {
          jsonObject
            .attendances.push(doc.data());

          return;
        }

        if (type === addendumTypes.PAYMENT) {
          jsonObject
            .payments
            .push(Object.assign({}, doc.data()));

          return;
        }

        if (type === addendumTypes.REIMBURSEMENT) {
          jsonObject
            .reimbursements
            .push(Object.assign({}, doc.data()));

          return;
        }

        jsonObject
          .addendum
          .push(getAddendumObject(doc));
      });

    const profileUpdate = {
      lastQueryFrom: from,
    };

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

    await batch
      .commit();

    return sendJSON(conn, jsonObject);
  } catch (error) {
    return handleError(conn, error);
  }
};
