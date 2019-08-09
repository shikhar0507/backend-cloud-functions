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
  code,
} = require('../admin/responses');
const {
  handleError,
  sendResponse,
  sendJSON,
  isValidDate,
  isNonEmptyString,
} = require('../admin/utils');
const {
  dateFormats,
} = require('../admin/constants');
const admin = require('firebase-admin');
const momentTz = require('moment-timezone');


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

const getActivityObject = doc => {
  const singleDoc = {
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
    assignees: getAssigneesArray(doc.get('assignees')),
  };

  return singleDoc;
};

const getSubscriptionObject = doc => {
  const singleDoc = {
    template: doc.get('template'),
    schedule: doc.get('schedule'),
    venue: doc.get('venue'),
    attachment: doc.get('attachment'),
    office: doc.get('office'),
    status: doc.get('status'),
  };

  return singleDoc;
};

const getLocations = ref => new Promise(resolve => ref.on('value', resolve));


const getStatusObject = async profileDoc => {
  const result = [];

  if (!profileDoc) return result;

  const allMonths = {
    'January': 0,
    'February': 1,
    'March': 2,
    'April': 3,
    'May': 4,
    'June': 5,
    'July': 6,
    'August': 7,
    'September': 8,
    'October': 9,
    'November': 10,
    'December': 11,
  };

  const promises = [];
  const phoneNumber = profileDoc.id;
  const employeeOf = profileDoc.get('employeeOf') || {};
  const allOffices = Object.entries(employeeOf);
  const monthYearString = momentTz().format(dateFormats.MONTH_YEAR);
  const officeNamesMap = new Map();

  allOffices.forEach(item => {
    const [name, id] = item;

    officeNamesMap.set(id, name);
  });

  officeNamesMap.forEach((id, name) => {
    const p = rootCollections
      .offices
      .doc(name)
      .collection('Statuses')
      .doc(monthYearString)
      .collection('Employees')
      .doc(phoneNumber)
      .get();

    promises.push(p);
  });

  try {
    const docs = await Promise.all(promises);

    docs.forEach(doc => {
      const statusObject = doc.get('statusObject') || {};
      const { path } = doc.ref;
      const parts = path.split('/');
      const monthYearString = parts[3];
      const [month, year] = monthYearString.split(' ');
      const officeId = parts[1];
      const office = officeNamesMap.get(officeId);

      Object
        .keys(statusObject)
        .forEach(date => {
          const obj = Object.assign({
            date: Number(date),
            month: allMonths[month],
            year,
            office,
          }, statusObject[date]);

          result.push(obj);
        });
    });

    return result;
  } catch (error) {
    console.error(error);
  }
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
      .collection('Addendum')
      .where('timestamp', '>', from)
      .get(),
    rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Activities')
      .where('timestamp', '>', from)
      .get(),
    rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Subscriptions')
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
      const officeId = employeeOf[name];
      const path = `${officeId}/locations`;

      const ref = admin
        .database()
        .ref(path);

      locationPromises.push(getLocations(ref));
    });

    promises.push(Promise.all(locationPromises));
  }

  try {
    const [
      addendum,
      activities,
      subscriptions,
      locationResults,
    ] = await Promise.all(promises);

    if (!addendum.empty) {
      jsonObject.upto = addendum
        .docs[addendum.size - 1]
        .get('timestamp');
    }

    if (locationResults) {
      locationResults.forEach(snapShot => {
        if (!snapShot) return;

        snapShot.forEach(item => {
          jsonObject.locations.push(item.val());
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
        if (doc.get('canEditRule') === 'ADMIN') return;

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

    batch.set(rootCollections
      .profiles
      .doc(conn.requester.phoneNumber), profileUpdate, {
        /** Profile has other stuff too. */
        merge: true,
      });

    if (from === 0) {
      jsonObject
        .statusObject = await getStatusObject(conn.requester.profileDoc);
    }

    await batch.commit();

    return sendJSON(conn, jsonObject);
  } catch (error) {
    return handleError(conn, error);
  }
};
