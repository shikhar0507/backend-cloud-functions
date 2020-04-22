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

const { code } = require('../../admin/responses');
const {
  httpsActions,
  subcollectionNames,
  dateFormats,
} = require('../../admin/constants');
const { db, rootCollections, getGeopointObject } = require('../../admin/admin');
const {
  activityName,
  haversineDistance,
  validateVenues,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
  checkLimitHelper,
} = require('./helper');
const {
  millitaryToHourMinutes,
  handleError,
  getCustomerName,
  sendResponse,
  getRelevantTime,
  getScheduleDates,
  getAdjustedGeopointsFromVenue,
  enumerateDaysBetweenDates,
  getCanEditValue,
} = require('../../admin/utils');
const env = require('../../admin/env');
const momentTz = require('moment-timezone');
const fs = require('fs');
const currencyJs = require('currency.js');
const admin = require('firebase-admin');
const googleMapsClient = require('@google/maps').createClient({
  key: env.mapsApiKey,
  Promise: Promise,
});
const url = require('url');

const getCustomerVenue = ({ templateDoc, firstResult, placeApiResult }) => {
  return templateDoc.get('venue').map((venueDescriptor, index) => {
    const result = {
      venueDescriptor,
      location: '',
      address: '',
      geopoint: {
        latitude: '',
        longitude: '',
      },
    };

    if (index === 0) {
      result.geopoint.latitude = firstResult.geometry.location.lat;
      result.geopoint.longitude = firstResult.geometry.location.lng;
      result.address = placeApiResult.json.result.formatted_address;
      result.placeId = firstResult.place_id;
    }

    return result;
  });
};

const getDailyStartTimeFromPlaces = ({ placeApiResult }) => {
  const { opening_hours: openingHours } = placeApiResult.json.result;

  if (!openingHours) {
    return '';
  }

  const { periods } = openingHours;

  const [relevantObject] = periods.filter(item => {
    return item.open && item.open.day === 1;
  });

  return relevantObject ? relevantObject.open.time : '';
};

const getDailyEndTimeFormPlaces = ({ placeApiResult }) => {
  const { opening_hours: openingHours } = placeApiResult.json.result;

  if (!openingHours) {
    return '';
  }

  const { periods } = openingHours;
  const [relevantObject] = periods.filter(item => {
    return item.close && item.close.day === 1;
  });

  return relevantObject ? relevantObject.close.time : '';
};

const getWeeklyOffFromPlaces = ({ placeApiResult }) => {
  const { opening_hours: openingHours } = placeApiResult.json.result;

  if (!openingHours) {
    return '';
  }

  const weekdayText = openingHours.weekday_text;

  if (!weekdayText) {
    return '';
  }

  const [closedWeekday] = weekdayText
    // ['Sunday: Closed']
    .filter(str => str.includes('Closed'));

  if (!closedWeekday) {
    return '';
  }

  const parts = closedWeekday.split(':');

  if (!parts[0]) {
    return '';
  }

  // ['Sunday' 'Closed']
  return parts[0].toLowerCase();
};

const getCustomerSchedule = ({ templateDoc }) => {
  return templateDoc.get('schedule').map(name => {
    return {
      name,
      startTime: '',
      endTime: '',
    };
  });
};

const getCustomerAttachment = ({ templateDoc, placeApiResult, location }) => {
  const { attachment } = templateDoc.data();

  attachment.Name.value = getCustomerName(
    placeApiResult.json.result.address_components,
    location,
  );

  const dailyStartTime = getDailyStartTimeFromPlaces({
    placeApiResult,
  });
  const dailyEndTime = getDailyEndTimeFormPlaces({
    placeApiResult,
  });
  const weeklyOff = getWeeklyOffFromPlaces({
    placeApiResult,
  });

  attachment['Daily Start Time'].value = millitaryToHourMinutes(dailyStartTime);
  attachment['Daily End Time'].value = millitaryToHourMinutes(dailyEndTime);
  attachment['Weekly Off'].value = weeklyOff;
  attachment['First Contact'].value = '';

  return attachment;
};

const getCustomerObject = async ({ address, location }) => {
  try {
    const placesApiResponse = await googleMapsClient
      .places({
        query: address,
      })
      .asPromise();

    const [firstResult] = placesApiResponse.json.results;

    if (!firstResult) {
      return {
        failed: true,
      };
    }

    const placeApiResult = await googleMapsClient
      .place({
        placeid: firstResult.place_id,
      })
      .asPromise();
    const [templateDoc] = (
      await rootCollections.activityTemplates
        .where('name', '==', 'customer')
        .limit(1)
        .get()
    ).docs;

    const activityObject = {
      placeId: firstResult.place_id,
      schedule: getCustomerSchedule({
        templateDoc,
        firstResult,
      }),
      venue: getCustomerVenue({
        templateDoc,
        firstResult,
        placeApiResult,
      }),
      attachment: getCustomerAttachment({
        templateDoc,
        placeApiResult,
        location,
      }),
    };

    activityObject.venue[0].location = activityObject.attachment.Name.value;

    return activityObject;
  } catch (error) {
    console.error(error);

    return {
      failed: true,
    };
  }
};

const getRoleObject = subscriptionDoc => {
  if (subscriptionDoc) {
    return subscriptionDoc.get('roleDoc') || null;
  }

  return null;
};

const getRoleDocument = locals => {
  const office = locals.mainActivityData.office;
  if (
    locals.profileDoc.get('roleReferences') &&
    locals.profileDoc.get('roleReferences')[office]
  ) {
    return locals.profileDoc.get('roleReferences')[office];
  } else {
    return getRoleObject(locals.subscriptionDoc);
  }
};

const getAction = locals => {
  switch (locals.method) {
    case 'create':
      return httpsActions.create;
    case 'share':
      return httpsActions.share;
    case 'update':
      return httpsActions.update;
    case 'change-status':
      return httpsActions.changeStatus;
    default:
      throw new Error('Not allowed');
  }
};

const createDocsWithBatch = async (conn, locals) => {
  const batch = db.batch();
  const canEditMap = {};
  const activityRef = rootCollections.activities.doc();
  const { value: timezone } = locals.officeDoc.get('attachment.Timezone');
  const { id: activityId } = activityRef;
  const { date, months: month, years: year } = momentTz()
    .tz(timezone)
    .toObject();

  locals.mainActivityData.share.forEach(phoneNumber => {
    const addToInclude = true;
    canEditMap[phoneNumber] = null;
    batch.set(
      activityRef.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber),
      { addToInclude },
    );
  });

  const addendumDocRef = rootCollections.offices
    .doc(locals.officeDoc.id)
    .collection(subcollectionNames.ADDENDUM)
    .doc();
  let activityObject = {
    template: locals.mainActivityData.template,
    timestamp: Date.now(),
    venue: locals.mainActivityData.venue,
    schedule: locals.mainActivityData.schedule,
    attachment: locals.mainActivityData.attachment,
    dates: locals.mainActivityData.dates,
    report: locals.templateDoc.get('report') || null,
  };
  if (locals.templateDoc.get('dateConflict') === true) {
    activityObject.dateConflict = true;
  }
  if (locals.templateDoc.get('checkLimit')) {
    activityObject.checkLimit = locals.templateDoc.get('checkLimit');
  }

  if (locals.mainActivityData.template === 'customer') {
    const { address } = locals.mainActivityData.venue[0];

    const placesQueryResult = await getCustomerObject({
      address,
      location: locals.mainActivityData.attachment.Name.value,
    });

    activityObject = placesQueryResult;

    if (placesQueryResult.failed) {
      return sendResponse(
        conn,
        code.conflict,
        `'${address}' doesn't look like a real address`,
      );
    }

    const {
      docs: [probablyExistingCustomer],
    } = await rootCollections.activities
      .where('office', '==', locals.mainActivityData.office)
      .where('template', '==', 'customer')
      .where('status', '==', 'CONFIRMED')
      .where(
        'attachment.Name.value',
        '==',
        locals.mainActivityData.attachment.Name.value,
      )
      .limit(1)
      .get();

    if (probablyExistingCustomer) {
      return sendResponse(
        conn,
        code.conflict,
        `Customer with the name` +
          ` '${activityObject.attachment.Name.value} already exists'`,
      );
    }
  }
  console.log(activityObject.schedule, `schedule`);
  if (activityObject.schedule.length > 0) {
    activityObject.relevantTime = getRelevantTime(activityObject.schedule);
    activityObject.scheduleDates = getScheduleDates(activityObject.schedule);
  }

  // The field `Location` should exist.
  if (
    activityObject.attachment.Location &&
    activityObject.attachment.Location.value &&
    activityObject.relevantTime
  ) {
    activityObject.relevantTimeAndVenue =
      `${activityObject.attachment.Location.value}` +
      ` ${activityObject.relevantTime}`;
  }

  activityObject.createTimestamp = Date.now();
  activityObject.timestamp = Date.now();
  activityObject.timezone = timezone;
  activityObject.office = locals.mainActivityData.office;
  activityObject.addendumDocRef = addendumDocRef;
  activityObject.template = locals.mainActivityData.template;
  activityObject.status = locals.templateDoc.get('statusOnCreate');
  activityObject.canEditRule = locals.templateDoc.get('canEditRule');
  activityObject.officeId = locals.officeDoc.id;
  activityObject.hidden = locals.templateDoc.get('hidden');
  activityObject.activityName = activityName({
    requester: conn.requester,
    attachmentObject: locals.mainActivityData.attachment,
    templateName: locals.mainActivityData.template,
  });
  activityObject.creator = {
    phoneNumber: conn.requester.phoneNumber,
    displayName: conn.requester.displayName,
    photoURL: conn.requester.photoURL,
  };

  const adjustedGeopoints = getAdjustedGeopointsFromVenue(locals.mainActivityData.venue);

  const templatesToSkip = new Set([
    'check-in',
    'attendance regularization',
    'leave',
  ]);

  if (
    !templatesToSkip.has(locals.mainActivityData.template) &&
    adjustedGeopoints.length > 0
  ) {
    activityObject.adjustedGeopoints = adjustedGeopoints[0];
  }

  delete activityObject.relevantTime;
  const addendumDocObject = {
    date,
    month,
    year,
    activityData: activityObject,
    user: conn.requester.phoneNumber,
    userDisplayName: conn.requester.displayName,
    uid: conn.requester.uid,
    /**
     * Numbers from `attachment`, and all other places will always
     * be present in the `allPhoneNumbers` set. Using that instead of
     * the request body `share` to avoid some users being missed
     * in the `comment`.
     */
    share: Array.from(new Set(locals.mainActivityData.share)),
    action: getAction(locals),
    template: locals.mainActivityData.template,
    location: getGeopointObject(locals.mainActivityData.geopoint),
    timestamp: Date.now(),
    userDeviceTimestamp: locals.mainActivityData.timestamp,
    /** The `activityId` field is required by `addendumOnCreate` */
    activityId: activityRef.id,
    activityName: activityObject.activityName,
    isAdminRequest: conn.requester.isAdminRequest,
    isSupportRequest: conn.requester.isSupportRequest,
    geopointAccuracy: locals.mainActivityData.geopoint.accuracy || null,
    provider: locals.mainActivityData.geopoint.provider || null,
    roleDoc: getRoleDocument(locals),
  };

  if (
    locals.mainActivityData.template === 'check-in' &&
    locals.subscriptionDoc &&
    locals.subscriptionDoc.get('roleDoc')
  ) {
    addendumDocObject.roleDoc = locals.subscriptionDoc.get('roleDoc');
  }

  if (
    locals.mainActivityData.template === 'check-in' &&
    locals.subscriptionDoc &&
    locals.subscriptionDoc.get('lastGeopoint')
  ) {
    addendumDocObject.subscriptionDocId = locals.subscriptionDoc.id;
    addendumDocObject.lastGeopoint = locals.subscriptionDoc.get('lastGeopoint');
    addendumDocObject.lastTimestamp = locals.subscriptionDoc.get(
      'lastTimestamp',
    );
  }
  console.log({
    activity: JSON.stringify(activityObject),
  });

  batch.set(addendumDocRef, addendumDocObject);
  batch.set(activityRef, activityObject);

  // handle new assignees
  const newAssigneeSet = new Set(locals.mainActivityData.share);
  newAssigneeSet.forEach(assignee => {
    batch.set(
      activityRef.collection(subcollectionNames.ASSIGNEES).doc(assignee),
      { merge: true },
    );
  });

  /** For base64 images, upload the json file to bucket */
  if (conn.isBase64 && conn.base64Field) {
    delete activityObject.addendumDocRef;
    delete addendumDocObject.activityData.addendumDocRef;

    const json = {
      canEditMap,
      activityId,
      activityData: activityObject,
      addendumDocObject,
      addendumId: addendumDocRef.id,
      base64Field: conn.base64Field,
      requestersPhoneNumber: conn.requester.phoneNumber,
    };

    const storage = admin.storage();
    const bucket = storage.bucket(env.tempBucketName);
    const fileName = `${activityId}.json`;
    const filePath = `/tmp/${fileName}`;
    fs.writeFileSync(filePath, JSON.stringify(json));

    await bucket.upload(filePath);

    /**
     * Returning here since we want to skip activity
     * creation via the batch.
     */
    return sendResponse(conn, code.created);
  }

  await batch.commit();

  /** ENDS the response. */
  return sendResponse(conn, code.created);
};

const handleAssignees = async (conn, locals) => {
  if (locals.mainActivityData.share.length === 0) {
    return sendResponse(conn, code.badRequest, `No assignees found`);
  }
  return createDocsWithBatch(conn, locals);
};

const checkDbReadsII = async (conn, locals, result) => {
  let proceed = true;
  if (locals.dbReadsII.hasOwnProperty('dateConflict')) {
    const dateConflictResults = locals.dbReadsII.dateConflict;
    dateConflictResults.forEach(dateConflictResult => {
      if (!dateConflictResult.empty) {
        proceed = false;
        const day =
          dateConflictResult.query._queryOptions.fieldFilters[2].value;
        return sendResponse(
          conn,
          code.conflict,
          'An Attendance Regularisation or Leave has already been marked on ' +
            day,
        );
      }
    });
  }
  if (!proceed) return;
  // will also add check for checklimit under Db Reads II
  if (locals.dbReadsII.hasOwnProperty('shouldExist')) {
    const shouldExist = locals.dbReadsII.shouldExist;
    shouldExist.forEach(snapShot => {
      if (snapShot.empty) {
        proceed = false;
        const [{ value: name }] = snapShot.query._queryOptions.fieldFilters;
        sendResponse(
          conn,
          code.conflict,
          `${name} should be present in activity`,
        );
      }
    });
  }
  if (!proceed) return;
  if (locals.mainActivityData.template === 'leave') {
    locals.maxLeavesAllowed = Number.POSITIVE_INFINITY;
    locals.leavesTakenThisYear = 0;

    if (!locals.mainActivityData.attachment['Leave Type'].value) {
      locals.maxLeavesAllowed = 20;
    }

    const [leaveTypeQuery, leaveActivityQuery] = [
      locals.dbReadsII.limitDocument,
      locals.dbReadsII.limitQuery,
    ];

    if (!leaveTypeQuery.empty) {
      locals.maxLeavesAllowed = Number(
        leaveTypeQuery.docs[0].get('attachment.Annual Limit.value') || 0,
      );
    }

    leaveActivityQuery.forEach(doc => {
      const [{ startTime, endTime }] = doc.get('schedule');
      locals.leavesTakenThisYear += momentTz(
        momentTz(endTime)
          .endOf('day')
          .valueOf(),
      ).diff(
        momentTz(startTime)
          .startOf('day')
          .valueOf(),
        'days',
      );
    });
    const leavesTakenThisTime = locals.mainActivityData.dates.length;
    if (
      locals.leavesTakenThisYear + leavesTakenThisTime >
      locals.maxLeavesAllowed
    ) {
      return sendResponse(
        conn,
        code.conflict,
        `Cannot create leave` +
          ` You have exceeded the limit for leave` +
          ` application under ${locals.mainActivityData.attachment['Leave Type'].value}` +
          ` by ${locals.maxLeavesAllowed -
            (locals.leavesTakenThisYear + leavesTakenThisTime)}`,
      );
    }

    const [firstSchedule] = locals.mainActivityData.schedule;
    const { startTime } = firstSchedule;

    // leave is for a date which is 2 months back => don't allow
    const differenceInMonths = momentTz().diff(
      momentTz(startTime),
      'months',
      true,
    );

    if (differenceInMonths > 2) {
      proceed = false;
      return sendResponse(
        conn,
        code.badRequest,
        `Leave cannot be applied for more than two months in the past`,
      );
    }
  }
  if (locals.mainActivityData.template === 'claim') {
    const claimType = locals.mainActivityData.attachment['Claim Type'].value;
    const amount = locals.mainActivityData.attachment.Amount.value;

    if (!claimType) {
      proceed = true;
    } else {
      if (Number(amount || 0) < 1) {
        proceed = false;
        return sendResponse(
          conn,
          code.badRequest,
          `Amount should be a positive number`,
        );
      }

      const timezone = locals.officeDoc.get('attachment.Timezone.value');
      const momentNow = momentTz().tz(timezone);
      const monthStart = momentNow
        .clone()
        .startOf('month')
        .valueOf();
      const monthEnd = momentNow
        .clone()
        .endOf('month')
        .valueOf();

      const [
        claimActivities,
        {
          docs: [claimTypeDoc],
        },
      ] = locals.dbReadsII.claimChecks;

      const monthlyLimit = claimTypeDoc.get('attachment.Monthly Limit.value');
      let claimsThisMonth = currencyJs(0);

      claimActivities.forEach(doc => {
        // Start Time of the schedule has a higher priority.
        const isCancelled = doc.get('status') === 'CANCELLED';
        const [{ startTime }] = doc.get('schedule');
        const createTime = momentTz(startTime || doc.createTime.toMillis()).tz(
          timezone,
        );

        const createdThisMonth = createTime.isBetween(monthStart, monthEnd);
        if (createdThisMonth && !isCancelled) {
          const amount = parseInt(doc.get('attachment.Amount.value') || 0);
          claimsThisMonth = claimsThisMonth.add(amount);
        }
      });

      if (
        currencyJs(claimsThisMonth).add(amount).value >
        currencyJs(monthlyLimit).value
      ) {
        proceed = false;
        return sendResponse(
          conn,
          code.conflict,
          `Cannot create a claim. Max Claims (${monthlyLimit}) amount this month.`,
        );
      }
    }
  }
  if (!proceed) return;
  return handleAssignees(conn, locals, result);
};
/**
 *
 * @param conn
 * @param locals {{ activityId:any, dbReadsII: {shouldExist: []}, officeDoc: *, conn: *, method: *, templateDoc: *, subscriptionDoc: *, profileDoc: *, mainActivityData: *}}
 * @param result
 * @returns {Promise<undefined|void|*>}
 */
const handleDbReadsII = async (conn, locals, result) => {
  let stageTwo = false;
  if (
    locals.dbReadsII.hasOwnProperty('shouldExist') ||
    locals.dbReadsII.hasOwnProperty('dateConflict') ||
    locals.dbReadsII.hasOwnProperty('limitDocument') ||
    locals.dbReadsII.hasOwnProperty('limitQuery') ||
    locals.dbReadsII.hasOwnProperty('claimChecks')
  ) {
    stageTwo = true;
  }
  if (stageTwo) {
    // finish for queries to process
    const queryPromisesList = [];
    if (locals.dbReadsII.hasOwnProperty('shouldExist')) {
      queryPromisesList.push(locals.dbReadsII.shouldExist);
    }
    if (locals.dbReadsII.hasOwnProperty('dateConflict')) {
      queryPromisesList.push(locals.dbReadsII.dateConflict);
    }
    if (locals.dbReadsII.hasOwnProperty('limitDocument')) {
      queryPromisesList.push(locals.dbReadsII.limitDocument);
    }
    if (locals.dbReadsII.hasOwnProperty('limitQuery')) {
      queryPromisesList.push(locals.dbReadsII.limitQuery);
    }
    if (locals.dbReadsII.hasOwnProperty('claimChecks')) {
      queryPromisesList.push(locals.dbReadsII.claimChecks);
    }
    await Promise.all(queryPromisesList);
    if (locals.dbReadsII.hasOwnProperty('shouldExist')) {
      locals.dbReadsII.shouldExist = await Promise.all(
        locals.dbReadsII.shouldExist,
      );
    }
    if (locals.dbReadsII.hasOwnProperty('dateConflict')) {
      locals.dbReadsII.dateConflict = await Promise.all(
        locals.dbReadsII.dateConflict,
      );
    }
    if (locals.dbReadsII.hasOwnProperty('limitDocument')) {
      locals.dbReadsII.limitDocument = await Promise.all(
        locals.dbReadsII.limitDocument,
      );
    }
    if (locals.dbReadsII.hasOwnProperty('limitQuery')) {
      locals.dbReadsII.limitQuery = await Promise.all(
        locals.dbReadsII.limitQuery,
      );
    }
    if (locals.dbReadsII.hasOwnProperty('claimChecks')) {
      locals.dbReadsII.claimChecks = await Promise.all(
        locals.dbReadsII.claimChecks,
      );
    }
    return checkDbReadsII(conn, locals, result);
  }
  return handleAssignees(conn, locals, result);
};
const handleAttachmentArrays = async (conn, locals, result) => {
  const { attachment } = locals.mainActivityData;

  for (const [, { value: values, type }] of Object.entries(attachment)) {
    if (!Array.isArray(values)) {
      continue;
    }

    for (const value of values) {
      const { name, quantity, rate, date } = value;

      // date is a unix timestamp
      if (date !== '' && !momentTz.isDate(new Date(date))) {
        return sendResponse(
          conn,
          code.badRequest,
          `Invalid date found in ${locals.mainActivityData.template}`,
        );
      }

      if (quantity && !Number.isInteger(quantity)) {
        return sendResponse(
          conn,
          code.badRequest,
          `Invalid quantity found in ${locals.mainActivityData.template}`,
        );
      }

      if (rate !== '' && typeof rate !== 'number') {
        return sendResponse(
          conn,
          code.badRequest,
          `Invalid rate found in ${locals.mainActivityData.template}`,
        );
      }
      locals.dbReadsII.shouldExist.push(
        rootCollections.activities
          .where('attachment.Name.value', '==', name)
          .where('template', '==', type)
          .where('officeId', '==', locals.officeDoc.id)
          .limit(1)
          .get(),
      );
    }
  }
  return handleDbReadsII(conn, locals, result);
};
/**
 *
 * @param conn
 * @param locals {{ activityId:any, dbReadsII: {shouldExist: []}, officeDoc: *, conn: *, method: *, templateDoc: *, subscriptionDoc: *, profileDoc: *, mainActivityData: *}}
 * @returns {Promise<void|undefined|*>|void}
 */
const handleAttachment = (conn, locals) => {
  const options = {
    dbReadsII: locals.dbReadsII,
    bodyAttachment: locals.mainActivityData.attachment,
    templateAttachment: locals.templateDoc.get('attachment'),
    template: locals.mainActivityData.template,
    officeId: locals.officeDoc.id,
    office: locals.mainActivityData.office,
  };

  const result = filterAttachment(options);

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  /**
   * All phone numbers in the attachment are added to the
   * activity assignees.
   */
  locals.mainActivityData.share = locals.mainActivityData.share || [];
  locals.mainActivityData.share.push(...result.phoneNumbers);

  const { isBase64, base64Field } = result;

  conn.isBase64 = isBase64;
  conn.base64Field = base64Field;

  return handleAttachmentArrays(conn, locals, result);
};

const logInvaliCheckIn = async ({
  lastTimestamp,
  lastGeopoint,
  currentGeopoint,
  checkInTimestampDifferenceInMinutes,
  checkInTimestampDifferenceInHours,
  distance,
  speed,
  phoneNumber,
}) => {
  const { date, months: month, years: year } = momentTz().toObject();
  const message = 'Invalid CheckIn';
  const {
    docs: [errorDoc],
  } = await rootCollections.errors
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('message', '==', message)
    .limit(1)
    .get();

  const data = errorDoc ? errorDoc.data() : {};
  const newUpdate = Object.assign({}, data, {
    date,
    month,
    year,
    message,
  });

  newUpdate.affectedUsers = newUpdate.affectedUsers || {};
  newUpdate.affectedUsers[phoneNumber] =
    newUpdate.affectedUsers[phoneNumber] || 0;
  newUpdate.affectedUsers[phoneNumber]++;
  newUpdate.deviceObject = newUpdate.deviceObject || {};
  newUpdate.deviceObject[phoneNumber] =
    newUpdate.deviceObject[phoneNumber] || {};
  newUpdate.bodyObject = newUpdate.bodyObject || {};
  newUpdate.bodyObject[phoneNumber] = newUpdate.bodyObject[phoneNumber] || [];
  newUpdate.bodyObject[phoneNumber].push({
    lastTimestamp,
    lastGeopoint,
    currentGeopoint,
    checkInTimestampDifferenceInMinutes,
    checkInTimestampDifferenceInHours,
    distance,
    speed,
  });

  const ref = errorDoc ? errorDoc.ref : rootCollections.errors.doc();

  return ref.set(
    Object.assign({}, newUpdate, {
      timestamp: Date.now(),
    }),
    {
      merge: true,
    },
  );
};

const isInvalidCheckIn = async ({
  subscriptionDoc,
  currentGeopoint,
  provider,
  phoneNumber,
}) => {
  if (!subscriptionDoc) {
    return false;
  }

  const { template, lastGeopoint, lastTimestamp } = subscriptionDoc.data();

  if (template !== 'check-in') {
    return false;
  }

  if (typeof lastGeopoint !== 'object') {
    return false;
  }

  if (typeof lastTimestamp !== 'number') {
    return false;
  }

  if (provider !== 'HTML5') {
    return false;
  }

  const momentNow = momentTz();
  const momentPreviousCheckIn = momentTz(lastTimestamp);
  const checkInTimestampDifferenceInMinutes = momentNow.diff(
    momentPreviousCheckIn,
    'minutes',
    true,
  );
  const checkInTimestampDifferenceInHours = momentNow.diff(
    momentPreviousCheckIn,
    'hours',
    true,
  );

  if (checkInTimestampDifferenceInMinutes < 5) {
    return false;
  }

  const currentLatLng =
    `${currentGeopoint.latitude}` + `,${currentGeopoint.longitude}`;
  const previousLatLng =
    `${lastGeopoint.latitude || lastGeopoint._latitude}` +
    `,${lastGeopoint.longitude || lastGeopoint._longiture}`;

  const distance = haversineDistance(
    {
      _latitude: lastGeopoint.latitude || lastGeopoint._latitude,
      _longitude: lastGeopoint.longitude || lastGeopoint._longiture,
    },
    {
      _latitude: currentGeopoint.latitude,
      _longitude: currentGeopoint.longitude,
    },
  );

  const speed = distance / checkInTimestampDifferenceInHours;
  const result = currentLatLng === previousLatLng || speed > 40;

  if (result) {
    await logInvaliCheckIn({
      lastTimestamp,
      lastGeopoint,
      currentGeopoint,
      checkInTimestampDifferenceInMinutes,
      checkInTimestampDifferenceInHours,
      distance,
      speed,
      phoneNumber,
    });
  }

  return result;
};

const validatePermissions = ({
  officeDoc,
  subscriptionDoc,
  isSupportRequest,
  office,
  template,
}) => {
  if (!officeDoc) {
    return `No office found with the name: '${office}'`;
  }

  /**
   * For support requests, subscription is not required
   */
  if (!subscriptionDoc && !isSupportRequest) {
    return (
      `No subscription found for the template: '${template}'` +
      ` with the office '${office}'`
    );
  }

  const { status } = officeDoc.data();

  if (status === 'CANCELLED') {
    return `The office status is 'CANCELLED'. Cannot create an activity`;
  }

  return null;
};

const checkProfile = (profileDoc, conn) => {
  // adding this now for consistency, eventually this profile
  // auth uid check will move to respective files
  return profileDoc.get('uid') === conn.requester.uid;
};

const attachDatesArray = ({ schedule }) => {
  const dates = [];
  schedule.forEach(({ startTime, endTime }) => {
    dates.push(
      ...enumerateDaysBetweenDates(startTime, endTime, dateFormats.DATE),
    );
  });
  return dates;
};

const createLocals = async (
  conn,
  [
    profileResult,
    subscriptionQueryResult,
    templateQueryResult,
    officeQueryResult,
    existingActivityResult,
    sameNameResult,
    samePhoneNumberResult,
    assigneesResult,
  ],
  method,
) => {
  assigneesResult.toString();
  let mainActivityData;
  if (profileResult.exists) {
    if (!checkProfile(profileResult, conn)) {
      return sendResponse(conn, code.forbidden, 'Uid mismatch');
    }
  } else {
    return sendResponse(conn, code.forbidden, 'Profile doesnt exist');
  }
  const [subscriptionDoc] = subscriptionQueryResult.docs;
  const [templateDoc] = templateQueryResult.docs;
  const [officeDoc] = officeQueryResult.docs;

  if (method !== 'create') {
    if (!existingActivityResult.exists) {
      return sendResponse(conn, code.badRequest, 'Activity not found');
    }
    if (!getCanEditValue(existingActivityResult, conn.requester)) {
      return sendResponse(
        conn,
        code.forbidden,
        `You cannot edit this activity`,
      );
    }
    if (
      sameNameResult &&
      !sameNameResult.empty &&
      existingActivityResult.id !== sameNameResult.docs[0].id &&
      conn.req.body.status === 'CONFIRMED'
    ) {
      return sendResponse(
        conn,
        code.forbidden,
        `Another CONFIRMED activity with same Name found`,
      );
    }
    mainActivityData = Object.assign(
      {},
      existingActivityResult.data(),
      conn.req.body,
    );
  } else {
    const v = validatePermissions({
      officeDoc,
      subscriptionDoc,
      isSupportRequest: conn.requester.isSupportRequest,
      office: conn.req.body.office,
      template: conn.req.body.template,
    });
    if (v) {
      return sendResponse(conn, code.unauthorized, v);
    }
    if (samePhoneNumberResult && !samePhoneNumberResult.empty) {
      return sendResponse(
        conn,
        code.forbidden,
        `Activity with same PhoneNumber found`,
      );
    }
    if (
      sameNameResult &&
      !sameNameResult.empty &&
      conn.req.body.status === 'CONFIRMED'
    ) {
      return sendResponse(
        conn,
        code.forbidden,
        'A CONFIRMED activity with same Name exists, cannot create this activity',
      );
    }
    mainActivityData = Object.assign({}, conn.req.body);
  }
  /**
   * Type definition for locals
   * @type {{ activityId:any, dbReadsII: {shouldExist: []}, officeDoc: *, conn: *, method: *, templateDoc: *, subscriptionDoc: *, profileDoc: *, mainActivityData: *}}
   */
  const locals = {
    method,
    dbReadsII: { shouldExist: [] },
    templateDoc,
    officeDoc,
    subscriptionDoc,
    conn,
    profileDoc: profileResult,
    mainActivityData,
  };
  if (existingActivityResult) {
    locals.activityId = existingActivityResult.id;
  }

  if (!conn.requester.isSupportRequest) {
    locals.mainActivityData.share = locals.mainActivityData.share || [];
    locals.mainActivityData.share.push(conn.requester.phoneNumber);
  }

  const checkInResult = await isInvalidCheckIn({
    subscriptionDoc,
    currentGeopoint: locals.mainActivityData.geopoint,
    provider: locals.mainActivityData.geopoint.provider,
    phoneNumber: conn.requester.phoneNumber,
  });

  if (checkInResult) {
    return sendResponse(conn, code.badRequest, `Invalid check-in`);
  }

  const scheduleValidationResult = validateSchedules(
    locals.mainActivityData,
    locals.templateDoc.get('schedule'),
  );
  if (!scheduleValidationResult.isValid) {
    sendResponse(conn, code.badRequest, scheduleValidationResult.message);
    return;
  }
  if (locals.mainActivityData.hasOwnProperty('schedule')) {
    locals.mainActivityData.dates = attachDatesArray({
      schedule: locals.mainActivityData.schedule,
    });
  }
  if (
    templateDoc.hasOwnProperty('dateConflict') &&
    templateDoc.get('dateConflict') === true
  ) {
    locals.mainActivityData.dateConflict = true;
    locals.dbReadsII.dateConflict = [];
    locals.mainActivityData.dates.forEach(date => {
      locals.dbReadsII.dateConflict.push(
        rootCollections.profiles
          .doc(conn.requester.phoneNumber)
          .collection(subcollectionNames.ACTIVITIES)
          .where('office', '==', locals.mainActivityData.office)
          .where('status', '==', 'CONFIRMED')
          .where('dates', 'array-contains', date)
          .where('dateConflict', '==', true)
          .get(),
      );
    });
  } else {
    locals.mainActivityData.dateConflict = false;
  }
  // the following code accept a limit parameter and fetches the appropriate activities to allow
  // limit based checking
  // underway
  if (templateDoc.get('checkLimit')) {
    locals.mainActivityData.checkLimit = templateDoc.get('checkLimit');
    if (!checkLimitHelper({ locals, sendResponse, code })) {
      return;
    }
  }
  const venueValidationResult = validateVenues(
    locals.mainActivityData,
    locals.templateDoc.get('venue'),
  );
  if (!venueValidationResult.isValid) {
    sendResponse(conn, code.badRequest, venueValidationResult.message);
    return;
  }
  mainActivityData.venue = venueValidationResult.venues;
  return handleAttachment(conn, locals);
};

module.exports = async conn => {
  const { pathname } = url.parse(conn.req.url);
  const type = pathname.replace(/^\/|\/$/g, '');
  // any activity write/update should be PUT|POST
  if (['PUT', 'POST'].indexOf(conn.req.method) === -1) {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /activities` +
        ' endpoint. Use POST/PUT',
    );
  }
  let bodyResult, method;
  switch (type) {
    case 'activities/create':
      method = 'create';
      bodyResult = isValidRequestBody(conn.req.body, httpsActions.create);
      break;
    case 'activities/update':
      method = 'update';
      bodyResult = isValidRequestBody(conn.req.body, httpsActions.update);
      break;
    case 'activities/change-status':
      method = 'change-status';
      bodyResult = isValidRequestBody(conn.req.body, httpsActions.changeStatus);
      break;
    case 'activities/share':
      method = 'share';
      bodyResult = isValidRequestBody(conn.req.body, httpsActions.share);
      break;
    default:
      throw new Error(conn.method);
  }

  if (!bodyResult.isValid) {
    return sendResponse(conn, code.badRequest, bodyResult.message);
  }

  try {
    const promises = [
      rootCollections.profiles.doc(conn.requester.phoneNumber).get(),
      rootCollections.profiles
        .doc(conn.requester.phoneNumber)
        .collection(subcollectionNames.SUBSCRIPTIONS)
        .where('office', '==', conn.req.body.office)
        .where('template', '==', 'subscription')
        .where('attachment.Template.value', '==', conn.req.body.template)
        .where('status', '==', 'CONFIRMED')
        .limit(1)
        .get(),
      rootCollections.activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get(),
      rootCollections.offices
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
    ];
    if (conn.req.body.activityId) {
      promises.push(
        rootCollections.activities.doc(conn.req.body.activityId).get(),
      );
    } else {
      promises.push(Promise.resolve(null));
    }
    if (
      conn.req.body.hasOwnProperty('attachment') &&
      conn.req.body.attachment.hasOwnProperty('Name')
    ) {
      promises.push(
        rootCollections.activities
          .where('template', '==', conn.req.body.template)
          .where(
            'attachment.Name.value',
            '==',
            conn.req.body.attachment.Name.value,
          )
          .where('status', '==', 'CONFIRMED')
          .where('officeId', '==', conn.req.body.officeId)
          .limit(1)
          .get(),
      );
    } else {
      promises.push(Promise.resolve(null));
    }
    if (
      conn.req.body.hasOwnProperty('attachment') &&
      conn.req.body.attachment.hasOwnProperty('Phone Number')
    ) {
      promises.push(
        rootCollections.activities
          .where('template', '==', conn.req.body.template)
          .where(
            'attachment.Phone Number.value',
            '==',
            conn.req.body.attachment['Phone Number'].value,
          )
          .where('officeId', '==', conn.req.body.officeId)
          .limit(1)
          .get(),
      );
    } else {
      promises.push(Promise.resolve(null));
    }
    if (conn.req.body.activityId) {
      promises.push(
        rootCollections.activities
          .doc(conn.req.body.activityId)
          .collection('Assignees')
          .get(),
      );
    } else {
      promises.push(Promise.resolve(null));
    }
    return createLocals(conn, await Promise.all(promises), method);
  } catch (error) {
    console.error(error);
    return handleError(conn, error);
  }
};
