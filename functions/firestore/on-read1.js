/**
 * Copyright (c) 2020 GrowthFile
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

const { db, rootCollections } = require('../admin/admin');
const { code } = require('../admin/responses');
const { subcollectionNames, addendumTypes } = require('../admin/constants');
const {
  sendJSON,
  isValidDate,
  handleError,
  sendResponse,
  getNumbersbetween,
  isNonEmptyString,
  getDefaultAttendanceObject,
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

const getAssigneeFromDocRef = async docRef => {
  const { docs: assigneeDocuments } = await docRef
    .collection(subcollectionNames.ASSIGNEES)
    .get();
  return assigneeDocuments.map(document => ({
    phoneNumber: document.id,
    displayName: '',
    photoURL: '',
  }));
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

const subscriptionFilter = doc =>
  [
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

const locationFilter = doc => ({
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

const setAttendanceObjects = (attendanceQueryResult, jsonObject) => {
  const {
    docs: [attendanceDoc],
  } = attendanceQueryResult;

  if (!attendanceDoc) {
    return [];
  }

  const {
    month,
    year,
    office,
    officeId,
    phoneNumber,
    attendance = {},
  } = attendanceDoc.data();
  const timestamp = Date.now();
  const dates = Object.keys(attendance).sort((a, b) => a - b);
  const lastAvailableDate = Number(dates[dates.length - 1] || 1);
  const monthEndMoment = momentTz()
    .month(month)
    .year(year)
    .clone()
    .endOf('month');

  console.log({ lastAvailableDate, date: monthEndMoment.get('date') + 1 });

  const probablyMissingDates = getNumbersbetween(
    lastAvailableDate,
    monthEndMoment.get('date') + 1,
  );

  probablyMissingDates.forEach(
    date =>
      (attendance[date] = attendance[date] || getDefaultAttendanceObject()),
  );

  Object.entries(attendance).forEach(([date, attendanceObjectForDate]) => {
    // No need to check for missing dates/or the sequence because
    // that data is of the past.
    jsonObject.attendances.push(
      Object.assign({}, attendanceObjectForDate, {
        office,
        officeId,
        phoneNumber,
        timestamp,
        date: Number(date),
        month: Number(month),
        year: Number(year),
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

const getMonthlyAttendance = async ({ officeId, phoneNumber, jsonObject }) => {
  const momentToday = momentTz();
  const momentPrevMonth = momentToday.clone().subtract(1, 'month');

  console.log('sending attendances', officeId);

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

const getSingleReimbursement = doc => {
  const { date, month, year } = doc.data();

  const geopointFilter = geopoint => {
    if (!geopoint) {
      return null;
    }

    if (!geopoint.latitude && !geopoint._latitude) {
      return null;
    }

    return {
      latitude: geopoint._latitude || geopoint.latitude,
      longitude: geopoint._longitude || geopoint.longitude,
    };
  };

  return {
    date,
    month,
    year,
    office: doc.get('office'),
    officeId: doc.get('officeId'),
    currency: doc.get('currency'),
    timestamp: Date.now(),
    amount: doc.get('amount'),
    _type: addendumTypes.REIMBURSEMENT,
    key: momentTz().date(date).month(month).year(year).startOf('day').valueOf(),
    id: `${date}${month}${year}${doc.id}`,
    reimbursementType: doc.get('reimbursementType'),
    reimbursementName: doc.get('reimbursementName') || null,
    details: {
      rate: doc.get('rate') || null,
      checkInTimestamp: doc.get('timestamp') || Date.now(),
      startLocation: geopointFilter(doc.get('previousGeopoint')),
      endLocation: geopointFilter(doc.get('currentGeopoint')),
      distanceTravelled: doc.get('distance') || null,
      photoURL: doc.get('photoURL') || null,
      status: doc.get('status') || null,
      claimId: doc.get('claimId') || null,
    },
  };
};

const getMonthlyReimbursement = async ({
  officeId,
  phoneNumber,
  jsonObject,
}) => {
  const momentToday = momentTz();
  const momentPrevMonth = momentToday.clone().subtract(1, 'month');
  const getReimbursementRef = (month, year) => {
    return rootCollections.offices
      .doc(officeId)
      .collection(subcollectionNames.REIMBURSEMENTS)
      .where('phoneNumber', '==', phoneNumber)
      .where('month', '==', month)
      .where('year', '==', year)
      .get();
  };

  const [
    reimbursementsCurrentMonth,
    reimbursementsPrevMonth,
  ] = await Promise.all([
    getReimbursementRef(momentToday.month(), momentToday.year()),
    getReimbursementRef(momentPrevMonth.month(), momentPrevMonth.year()),
  ]);

  reimbursementsCurrentMonth.forEach(doc => {
    jsonObject.reimbursements.push(getSingleReimbursement(doc));
  });

  reimbursementsPrevMonth.forEach(doc => {
    jsonObject.reimbursements.push(getSingleReimbursement(doc));
  });

  return;
};

const sortOfficeActivities = async ({ office, jsonObject }) => {
  const { docs: activities } = await rootCollections.activities
    .where('office', '==', office)
    .where('report', '==', 'type')
    .where('status', '==', 'CONFIRMED')
    .get();
  if (activities.length === 0) {
    return;
  }
  for (let index = 0; index < activities.length; index += 1) {
    const activity = activities[index];
    const venue = activity.get('venue');
    if (venue && Array.isArray(venue) && venue.length > 0) {
      jsonObject.locations.push(
        Object.assign({}, locationFilter(activity), {
          addendumDocRef: null,
          assignees: [],
          activityId: activity.id,
        }),
      );
      continue;
    }
    if (activity.get('template') === 'product') {
      jsonObject.products.push(
        Object.assign(
          {},
          activity.data(),
          { activityId: activity.id },
          {
            addendumDocRef: null,
            assignees: [],
          },
        ),
      );
      continue;
    }
    jsonObject.activities.push(
      Object.assign(
        {},
        activity.data(),
        { activityId: activity.id },
        {
          addendumDocRef: null,
          assignees: await getAssigneeFromDocRef(activity.ref),
        },
      ),
    );
  }
};

const getOfficesFromSubscriptions = async ({ phoneNumber }) => {
  const offices = new Set();
  (
    await rootCollections.profiles
      .doc(phoneNumber)
      .collection(subcollectionNames.SUBSCRIPTIONS)
      .where('status', '==', 'CONFIRMED')
      .get()
  ).forEach(subscription => {
    if (subscription.get('office')) {
      offices.add(subscription.get('office'));
    }
  });
  return Array.from(offices);
};

const getProducts = async ({
  jsonObject,
  phoneNumber,
  officeId,
  customClaims,
  employeeOf,
}) => {
  // If user has subscription of duty OR call, send products from
  // root collection => send products
  const { empty } = await rootCollections.profiles
    .doc(phoneNumber)
    .collection(subcollectionNames.SUBSCRIPTIONS)
    .where('template', 'in', ['duty', 'call'])
    .limit(1)
    .get();

  if (empty) {
    return [];
  }

  (
    await rootCollections.activities
      .where('officeId', '==', officeId)
      .where('template', '==', 'product')
      .where('status', 'in', ['CONFIRMED', 'PENDING'])
      .get()
  ).forEach(doc => {
    jsonObject.products.push(
      activityFilter(doc, customClaims, employeeOf, phoneNumber),
    );
  });

  return;
};

const getActivityQueryByTemplate = ({ template, officeId }) =>
  rootCollections.activities
    .where('officeId', '==', officeId)
    .where('template', '==', template)
    .where('status', '==', 'CONFIRMED')
    .get();

const getProfileSubcollectionPromise = ({ subcollection, phoneNumber, from }) =>
  rootCollections.profiles
    .doc(phoneNumber)
    .collection(subcollection)
    .where('timestamp', '>', from)
    .orderBy('timestamp', 'asc')
    .get();

const read = async conn => {
  const requestTime = Date.now();

  const v = validateRequest(conn);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  const batch = db.batch();
  const { employeeOf, customClaims, phoneNumber, uid } = conn.requester;
  const officeList = Object.keys(employeeOf || {});
  const from = parseInt(conn.req.query.from);
  const isInitRequest = from === 0;
  const locationPromises = [];
  const templatePromises = [];
  const templatesMap = new Map();
  const sendLocations = isInitRequest;
  const jsonObject = {
    from,
    upto: from,
    products: [],
    addendum: [],
    activities: [],
    templates: [],
    locations: [],
    payments: [],
    attendances: [],
    reimbursements: [],
  };
  const promises = [];
  if (isInitRequest) {
    promises.push(Promise.resolve(false));
  } else {
    promises.push(
      rootCollections.updates
        .doc(uid)
        .collection(subcollectionNames.ADDENDUM)
        .where('timestamp', '>', from)
        .orderBy('timestamp', 'asc')
        .get(),
    );
  }

  if (isInitRequest) {
    promises.push(
      getProfileSubcollectionPromise({
        from,
        phoneNumber,
        subcollection: subcollectionNames.ACTIVITIES,
      }),
      getProfileSubcollectionPromise({
        from,
        phoneNumber,
        subcollection: subcollectionNames.SUBSCRIPTIONS,
      }),
    );
  }

  if (sendLocations) {
    officeList.forEach(office => {
      const officeId = employeeOf[office];
      locationPromises.push(
        getActivityQueryByTemplate({ template: 'customer', officeId }),
        getActivityQueryByTemplate({ template: 'branch', officeId }),
      );
    });
  }

  const [
    [addendum, activities, subscriptions],
    locationResults,
    /**
     * attendancePromises, and reimbursementPromises directly
     * modify the jsonObject which is why we are not using their
     * return values to iterate over the objects.
     **/
  ] = await Promise.all([Promise.all(promises), Promise.all(locationPromises)]);

  (subscriptions || []).forEach(doc => {
    const template = doc.get('attachment.Template.value');
    if (!template) {
      return;
    }
    templatePromises.push(
      rootCollections.activityTemplates
        .where('name', '==', template)
        .limit(1)
        .get(),
    );
  });

  (await Promise.all(templatePromises)).forEach(templatesSnap => {
    const {
      docs: [doc],
    } = templatesSnap;

    if (!doc) {
      return;
    }

    templatesMap.set(doc.get('name'), doc);
  });

  (subscriptions || []).forEach(doc => {
    const template = doc.get('attachment.Template.value');
    if (!template) {
      return;
    }
    const templateDoc = templatesMap.get(template);
    if (!templateDoc) {
      return;
    }
    const { canEditRule } = templateDoc;
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

    if (!templateDoc) {
      return;
    }

    jsonObject.templates.push(
      Object.assign({}, subscriptionFilter(doc), {
        template,
        activityId: doc.id,
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

  if (!isInitRequest) {
    addendum.forEach(doc => {
      const type = doc.get('_type') || doc.get('type');

      if (type === addendumTypes.SUBSCRIPTION) {
        jsonObject.templates.push(
          Object.assign({}, subscriptionFilter(doc), {
            activityId: doc.get('activityId'),
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

      if (type === addendumTypes.PRODUCT) {
        jsonObject.products.push(doc.data());

        return;
      }

      jsonObject.addendum.push(addendumFilter(doc));
    });
  }

  const profileUpdate = { lastQueryFrom: from };

  // This is only for keeping the log.
  if (sendLocations) {
    profileUpdate.locationsSentForTimestamp = from;
  }

  batch.set(rootCollections.profiles.doc(phoneNumber), profileUpdate, {
    /** Profile has other stuff too. */
    merge: true,
  });

  await batch.commit();

  if (!isInitRequest) {
    if (!addendum.empty) {
      jsonObject.upto = addendum.docs[addendum.size - 1].get('timestamp');
    }
  } else {
    jsonObject.upto = requestTime;
  }

  /**
   * Get all offices from subscriptions
   * Get all activities from root where report:'type'
   * Sort them into products,locations,activities
   * Also get all respective payments and give it to user
   */
  if (isInitRequest) {
    const officesFromSubscriptions = await getOfficesFromSubscriptions({
      phoneNumber,
    });
    await Promise.all(
      officesFromSubscriptions.map(office =>
        sortOfficeActivities({
          jsonObject,
          office,
        }),
      ),
    );
  }

  if (isInitRequest) {
    await Promise.all(
      officeList.map(office =>
        getProducts({
          jsonObject,
          customClaims,
          employeeOf,
          phoneNumber,
          officeId: employeeOf[office],
        }),
      ),
    );

    const attendancePromises = [];
    const reimbursementPromises = [];

    officeList.forEach(office => {
      const officeId = employeeOf[office];

      attendancePromises.push(
        getMonthlyAttendance({
          phoneNumber,
          jsonObject,
          officeId,
        }),
      );

      reimbursementPromises.push(
        getMonthlyReimbursement({
          jsonObject,
          phoneNumber,
          officeId,
        }),
      );
    });

    await Promise.all([
      Promise.all(attendancePromises),
      Promise.all(reimbursementPromises),
    ]);
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
