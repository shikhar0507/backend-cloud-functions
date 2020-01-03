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

const {db, rootCollections} = require('../admin/admin');
const {code} = require('../admin/responses');
const {subcollectionNames, addendumTypes} = require('../admin/constants');
const {
  sendJSON,
  isValidDate,
  handleError,
  sendResponse,
  isNonEmptyString,
} = require('../admin/utils');
const momentTz = require('moment-timezone');

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

const addendumFilter = doc => {
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

const getAssigneesArray = (arrayOfPhoneNumbers = []) => {
  // Could be a string (phoneNumber) or an object
  const [firstItem] = arrayOfPhoneNumbers;

  if (typeof firstItem !== 'string') {
    // Items are objects with properties
    // displayName, phoneNumber and photoUrl
    return arrayOfPhoneNumbers;
  }

  const result = [];

  // For compatilility with older activities
  arrayOfPhoneNumbers.forEach(phoneNumber => {
    result.push({
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

const getCanEditValue = ({
  canEditRule,
  creator,
  phoneNumber,
  office,
  customClaims,
  employeeOf,
}) => {
  if (canEditRule === 'ALL') {
    return true;
  }

  if (canEditRule === 'CREATOR') {
    return creator === phoneNumber;
  }

  if (canEditRule === 'ADMIN') {
    return (
      customClaims &&
      Array.isArray(customClaims.admin) &&
      customClaims.admin.includes(office)
    );
  }

  if (canEditRule === 'EMPLOYEE') {
    return employeeOf && employeeOf.hasOwnProperty(office);
  }

  // canEditRule => NONE
  return false;
};

const activityFilter = (doc, customClaims, employeeOf, phoneNumber) => {
  const result = {
    /**
     * Activity with template -type or customer/branch might
     * not have an assignee, so this array could be undefined
     */
    assignees: getAssigneesArray(doc.get('assignees')),
    activityId: doc.get('activityId') || doc.id,
    creator: getCreator(doc.get('creator')),
    canEdit: getCanEditValue({
      customClaims,
      employeeOf,
      phoneNumber,
      office: doc.get('office'),
      canEditRule: doc.get('canEditRule'),
      creator: doc.get('creator.phoneNumber') || doc.get('creator'),
    }),
  };

  return [
    'status',
    'schedule',
    'venue',
    'timestamp',
    'template',
    'activityName',
    'office',
    'attachment',
    'hidden',
  ].reduce((prev, curr) => {
    prev[curr] = doc.get(curr);

    return prev;
  }, result);
};

const subscriptionFilter = doc => {
  return [
    'template',
    'schedule',
    'venue',
    'attachment',
    'office',
    'status',
    'report',
  ].reduce((prevObject, currentField) => {
    prevObject[currentField] = doc.get(currentField) || null;

    return prevObject;
  }, {});
};

const locationFilter = doc => {
  return {
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
  };
};

const setAttendanceObjects = (attendanceQueryResult, jsonObject) => {
  const [attendanceDoc] = attendanceQueryResult.docs;

  if (!attendanceDoc) {
    return [];
  }

  const {
    attendance,
    month,
    year,
    office,
    officeId,
    phoneNumber,
  } = attendanceDoc.data();
  const timestamp = Date.now();

  Object.entries(attendance || {}).forEach(entry => {
    const [date, attendanceObjectForDate] = entry;

    // No need to check for missing dates/or the sequence because
    // that data is of the past.
    jsonObject.attendances.push(
      Object.assign({}, attendanceObjectForDate, {
        date,
        month,
        year,
        office,
        officeId,
        phoneNumber,
        timestamp,
        _type: addendumTypes.ATTENDANCE,
        id: `${date}${month}${year}${officeId}`,
        key: momentTz()
          .date(date)
          .month(month)
          .year(year)
          .startOf('date')
          .valueOf(),
      }),
    );
  });
};

const getMonthlyAttendance = async ({officeId, phoneNumber, jsonObject}) => {
  const momentToday = momentTz();
  const momentPrevMonth = momentToday.clone().subtract(1, 'month');

  const [
    currMonthAttendanceQueryResult,
    prevMonthAttendanceQueryResult,
  ] = await Promise.all([
    rootCollections.offices
      .doc(officeId)
      .collection(subcollectionNames.ATTENDANCES)
      .where('month', '==', momentToday.month())
      .where('year', '==', momentToday.year())
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get(),
    rootCollections.offices
      .doc(officeId)
      .collection(subcollectionNames.ATTENDANCES)
      .where('month', '==', momentPrevMonth.month())
      .where('year', '==', momentPrevMonth.year())
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get(),
  ]);

  setAttendanceObjects(prevMonthAttendanceQueryResult, jsonObject);
  setAttendanceObjects(currMonthAttendanceQueryResult, jsonObject);

  return;
};

const read = async conn => {
  const v = validateRequest(conn);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  const batch = db.batch();
  const {
    employeeOf,
    customClaims,
    phoneNumber,
    uid,
    profileDoc,
  } = conn.requester;
  const officeList = Object.keys(employeeOf || {});
  const from = parseInt(conn.req.query.from);
  const isInitRequest = from === 0;
  const locationPromises = [];
  const templatePromises = [];
  const attendancePromises = [];
  const templatesMap = new Map();
  const sendLocations =
    profileDoc && profileDoc.get('lastLocationMapUpdateTimestamp') > from;
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
    rootCollections.updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .where('timestamp', '>', from)
      .orderBy('timestamp', 'asc')
      .get(),
  ];

  if (isInitRequest) {
    promises.push(
      rootCollections.profiles
        .doc(phoneNumber)
        .collection(subcollectionNames.ACTIVITIES)
        .where('timestamp', '>', from)
        .orderBy('timestamp', 'asc')
        .get(),
      rootCollections.profiles
        .doc(phoneNumber)
        .collection(subcollectionNames.SUBSCRIPTIONS)
        .where('timestamp', '>', from)
        .orderBy('timestamp', 'asc')
        .get(),
    );

    officeList.forEach(office => {
      attendancePromises.push(
        getMonthlyAttendance({
          officeId: employeeOf[office],
          phoneNumber,
          jsonObject,
        }),
      );
    });
  }

  if (sendLocations) {
    officeList.forEach(name => {
      locationPromises.push(
        rootCollections.activities
          .where('officeId', '==', employeeOf[name])
          .where('status', '==', 'CONFIRMED')
          .where('template', '==', 'customer')
          .get(),
        rootCollections.activities
          .where('officeId', '==', employeeOf[name])
          .where('status', '==', 'CONFIRMED')
          .where('template', '==', 'branch')
          .get(),
      );
    });
  }

  const [addendum, activities, subscriptions] = await Promise.all(promises);
  const locationResults = await Promise.all(locationPromises);
  await Promise.all(attendancePromises);

  (subscriptions || []).forEach(doc => {
    const {template} = doc.data();

    templatePromises.push(
      rootCollections.activityTemplates
        .where('name', '==', template)
        .limit(1)
        .get(),
    );
  });

  (await Promise.all(templatePromises)).forEach(templatesSnap => {
    const [doc] = templatesSnap.docs;

    if (!doc) {
      return;
    }

    templatesMap.set(doc.get('name'), doc);
  });

  (subscriptions || []).forEach(doc => {
    const {template, canEditRule} = doc.data();

    templatePromises.push(
      rootCollections.activityTemplates
        .where('name', '==', template)
        .limit(1)
        .get(),
    );

    /** Client side APIs don't allow admin templates. */
    if (canEditRule === 'ADMIN') {
      return;
    }

    const templateDoc = templatesMap.get(template);

    if (!templateDoc) {
      return;
    }

    jsonObject.templates.push(
      Object.assign({}, subscriptionFilter(doc), {
        report: templateDoc.get('report') || null,
        schedule: templateDoc.get('schedule'),
        venue: templateDoc.get('venue'),
        attachment: templateDoc.get('attachment'),
        canEditRule: templateDoc.get('canEditRule'),
        hidden: templateDoc.get('hidden'),
        statusOnCreate: templateDoc.get('statusOnCreate'),
      }),
    );
  });

  (activities || []).forEach(doc => {
    jsonObject.activities.push(
      activityFilter(doc, customClaims, employeeOf, phoneNumber),
    );
  });

  locationResults.forEach(snapShot => {
    snapShot.forEach(doc => {
      jsonObject.locations.push(locationFilter(doc));
    });
  });

  addendum.forEach(doc => {
    const type = doc.get('_type') || doc.get('type');

    if (type === addendumTypes.SUBSCRIPTION) {
      const template = doc.get('template');
      const templateDoc = templatesMap.get(template);

      if (!templateDoc) {
        return;
      }

      jsonObject.templates.push(
        Object.assign({}, subscriptionFilter(doc), {
          report: templateDoc.get('report') || null,
          schedule: templateDoc.get('schedule'),
          venue: templateDoc.get('venue'),
          attachment: templateDoc.get('attachment'),
          canEditRule: templateDoc.get('canEditRule'),
          hidden: templateDoc.get('hidden'),
          statusOnCreate: templateDoc.get('statusOnCreate'),
        }),
      );

      return;
    }

    if (type === addendumTypes.ACTIVITY) {
      jsonObject.activities.push(
        activityFilter(doc, customClaims, employeeOf, phoneNumber),
      );

      return;
    }

    if (type === addendumTypes.ATTENDANCE) {
      jsonObject.attendances.push(doc.data());

      return;
    }

    if (type === addendumTypes.PAYMENT) {
      jsonObject.payments.push(doc.data());

      return;
    }

    if (type === addendumTypes.REIMBURSEMENT) {
      jsonObject.reimbursements.push(doc.data());

      return;
    }

    jsonObject.addendum.push(addendumFilter(doc));
  });

  const profileUpdate = {
    lastQueryFrom: from,
  };

  // This is only for keeping the log.
  if (sendLocations) {
    profileUpdate.locationsSentForTimestamp = from;
  }

  batch.set(rootCollections.profiles.doc(phoneNumber), profileUpdate, {
    /** Profile has other stuff too. */
    merge: true,
  });

  await batch.commit();

  if (!addendum.empty) {
    jsonObject.upto = addendum.docs[addendum.size - 1].get('timestamp');
  }

  return sendJSON(conn, jsonObject);
};

module.exports = async conn => {
  try {
    return read(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
