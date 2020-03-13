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

const { code } = require('../../admin/responses');
const { httpsActions, subcollectionNames } = require('../../admin/constants');
const { db, rootCollections, getGeopointObject } = require('../../admin/admin');
const {
  activityName,
  haversineDistance,
  validateVenues,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
  attendanceConflictHandler,
} = require('./helper');
const {
  millitaryToHourMinutes,
  handleError,
  getCustomerName,
  sendResponse,
  getRelevantTime,
  getScheduleDates,
  getAdjustedGeopointsFromVenue,
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

const getClaimStatus = async ({
  claimType,
  officeId,
  phoneNumber,
  timezone,
}) => {
  const momentNow = momentTz().tz(timezone);
  const monthStart = momentNow
    .clone()
    .startOf('month')
    .valueOf();
  const monthEnd = momentNow
    .clone()
    .endOf('month')
    .valueOf();
  const baseQuery = rootCollections.activities.where(
    'officeId',
    '==',
    officeId,
  );

  const [
    claimActivities,
    {
      docs: [claimTypeDoc],
    },
  ] = await Promise.all([
    baseQuery
      .where('template', '==', 'claim')
      .where('creator.phoneNumber', '==', phoneNumber)
      .where('attachment.Claim Type.value', '==', claimType)
      .get(),
    baseQuery
      .where('template', '==', 'claim-type')
      .where('attachment.Name.value', '==', claimType)
      .limit(1)
      .get(),
  ]);

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

  return {
    monthlyLimit,
    claimsThisMonth: claimsThisMonth.value,
  };
};

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
      result.placeId = firstResult['place_id'];
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

  const weekdayText = openingHours['weekday_text'];

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
        placeid: firstResult['place_id'],
      })
      .asPromise();
    const [templateDoc] = (
      await rootCollections.activityTemplates
        .where('name', '==', 'customer')
        .limit(1)
        .get()
    ).docs;

    const activityObject = {
      placeId: firstResult['place_id'],
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

const createDocsWithBatch = async (conn, locals) => {
  const batch = db.batch();
  const canEditMap = {};
  const activityRef = rootCollections.activities.doc();
  const { value: timezone } = locals.officeDoc.get('attachment.Timezone');
  const { id: activityId } = activityRef;
  const { date, months: month, years: year } = momentTz()
    .tz(timezone)
    .toObject();

  conn.req.body.share.forEach(phoneNumber => {
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

  let activityData = {
    timestamp: Date.now(),
    venue: conn.req.body.venue,
    schedule: conn.req.body.schedule,
    attachment: conn.req.body.attachment,
    report: locals.templateDoc.get('report') || null,
    /** Activities are not created with CANCELLED status */
    isCancelled: false,
  };

  if (conn.req.body.template === 'customer') {
    const { address } = conn.req.body.venue[0];

    const placesQueryResult = await getCustomerObject({
      address,
      location: conn.req.body.attachment.Name.value,
    });

    activityData = placesQueryResult;

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
      .where('office', '==', conn.req.body.office)
      .where('template', '==', 'customer')
      .where('status', '==', 'CONFIRMED')
      .where('attachment.Name.value', '==', activityData.attachment.Name.value)
      .limit(1)
      .get();

    if (probablyExistingCustomer) {
      return sendResponse(
        conn,
        code.conflict,
        `Customer with the name` +
          ` '${activityData.attachment.Name.value} already exists'`,
      );
    }
  }

  if (activityData.schedule.length > 0) {
    activityData.relevantTime = getRelevantTime(activityData.schedule);
    activityData.scheduleDates = getScheduleDates(activityData.schedule);
  }

  // The field `Location` should exist.
  if (
    activityData.attachment.Location &&
    activityData.attachment.Location.value &&
    activityData.relevantTime
  ) {
    activityData.relevantTimeAndVenue =
      `${activityData.attachment.Location.value}` +
      ` ${activityData.relevantTime}`;
  }

  activityData.createTimestamp = Date.now();
  activityData.timestamp = Date.now();
  activityData.timezone = timezone;
  activityData.office = conn.req.body.office;
  activityData.addendumDocRef = addendumDocRef;
  activityData.template = conn.req.body.template;
  activityData.status = locals.templateDoc.get('statusOnCreate');
  activityData.canEditRule = locals.templateDoc.get('canEditRule');
  activityData.officeId = locals.officeDoc.id;
  activityData.hidden = locals.templateDoc.get('hidden');
  activityData.activityName = activityName({
    requester: conn.requester,
    attachmentObject: conn.req.body.attachment,
    templateName: conn.req.body.template,
  });
  activityData.creator = {
    phoneNumber: conn.requester.phoneNumber,
    displayName: conn.requester.displayName,
    photoURL: conn.requester.photoURL,
  };

  const adjustedGeopoints = getAdjustedGeopointsFromVenue(conn.req.body.venue);

  const templatesToSkip = new Set([
    'check-in',
    'attendance regularization',
    'leave',
  ]);

  if (
    !templatesToSkip.has(conn.req.body.template) &&
    adjustedGeopoints.length > 0
  ) {
    activityData.adjustedGeopoints = adjustedGeopoints[0];
  }

  const addendumDocObject = {
    date,
    month,
    year,
    activityData,
    user: conn.requester.phoneNumber,
    userDisplayName: conn.requester.displayName,
    uid: conn.requester.uid,
    /**
     * Numbers from `attachment`, and all other places will always
     * be present in the `allPhoneNumbers` set. Using that instead of
     * the request body `share` to avoid some users being missed
     * in the `comment`.
     */
    share: Array.from(new Set(conn.req.body.share)),
    action: httpsActions.create,
    template: conn.req.body.template,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: Date.now(),
    userDeviceTimestamp: conn.req.body.timestamp,
    /** The `activityId` field is required by `addendumOnCreate` */
    activityId: activityRef.id,
    activityName: activityData.activityName,
    isAdminRequest: conn.requester.isAdminRequest,
    isSupportRequest: conn.requester.isSupportRequest,
    geopointAccuracy: conn.req.body.geopoint.accuracy || null,
    provider: conn.req.body.geopoint.provider || null,
    roleDoc: getRoleObject(locals.subscriptionDoc),
  };

  if (
    conn.req.body.template === 'check-in' &&
    locals.subscriptionDoc &&
    locals.subscriptionDoc.get('roleDoc')
  ) {
    addendumDocObject.roleDoc = locals.subscriptionDoc.get('roleDoc');
  }

  if (
    conn.req.body.template === 'check-in' &&
    locals.subscriptionDoc &&
    locals.subscriptionDoc.get('lastGeopoint')
  ) {
    addendumDocObject.subscriptionDocId = locals.subscriptionDoc.id;
    addendumDocObject.lastGeopoint = locals.subscriptionDoc.get('lastGeopoint');
    addendumDocObject.lastTimestamp = locals.subscriptionDoc.get(
      'lastTimestamp',
    );
  }

  batch.set(addendumDocRef, addendumDocObject);
  batch.set(activityRef, activityData);

  /** For base64 images, upload the json file to bucket */
  if (conn.isBase64 && conn.base64Field) {
    delete activityData.addendumDocRef;
    delete addendumDocObject.activityData.addendumDocRef;

    const json = {
      canEditMap,
      activityId,
      activityData,
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

const handleLeaveOrOnDuty = async (conn, locals) => {
  const [firstSchedule] = conn.req.body.schedule;
  const { startTime, endTime } = firstSchedule;
  const startTimeMoment = momentTz(startTime);
  const endTimeMoment = momentTz(endTime);
  const leavesTakenThisTime = endTimeMoment.diff(startTimeMoment, 'days');

  // leave is for a date which is 2 months back => don't allow
  const differenceInMonths = momentTz().diff(
    momentTz(startTime),
    'months',
    true,
  );

  if (differenceInMonths > 2) {
    return sendResponse(
      conn,
      code.badRequest,
      `Leave cannot be applied for more than two months in the past`,
    );
  }

  if (
    leavesTakenThisTime + locals.leavesTakenThisYear >
    locals.maxLeavesAllowed
  ) {
    return sendResponse(
      conn,
      code.conflict,
      `Cannot create a leave. Leave limit exceeded by` +
        ` ${leavesTakenThisTime +
          locals.leavesTakenThisYear -
          locals.maxLeavesAllowed} days.`,
    );
  }

  const {
    conflictingDate,
    conflictingTemplate,
  } = await attendanceConflictHandler({
    schedule: conn.req.body.schedule,
    phoneNumber: conn.requester.phoneNumber,
    office: conn.req.body.office,
  });

  if (conflictingDate) {
    const article = conn.req.body.template.startsWith('a') ? 'an' : 'a';
    const article2 = conflictingTemplate.startsWith('a') ? 'an' : 'a';
    const message =
      `Cannot apply for ${article} ${conn.req.body.template}.` +
      ` You are already on ${article2} ${conflictingTemplate} on the date` +
      ` ${conflictingDate}`;

    return sendResponse(conn, code.badRequest, message);
  }

  return createDocsWithBatch(conn, locals);
};

const handlePayroll = async (conn, locals) => {
  if (
    !new Set(['leave', 'attendance regularization']).has(conn.req.body.template)
  ) {
    return createDocsWithBatch(conn, locals);
  }

  if (
    !conn.req.body.schedule[0].startTime ||
    !conn.req.body.schedule[0].endTime
  ) {
    return createDocsWithBatch(conn, locals);
  }

  if (conn.req.body.template !== 'leave') {
    return handleLeaveOrOnDuty(conn, locals);
  }

  const startMoment = momentTz(conn.req.body.schedule[0].endTime);
  const endMoment = momentTz(conn.req.body.schedule[0].endTime);

  locals.maxLeavesAllowed = Number.POSITIVE_INFINITY;
  locals.leavesTakenThisYear = 0;

  if (!conn.req.body.attachment['Leave Type'].value) {
    locals.maxLeavesAllowed = 20;
  }

  const [leaveTypeQuery, leaveActivityQuery] = await Promise.all([
    rootCollections.activities
      .where('office', '==', locals.officeDoc.get('office'))
      .where('template', '==', 'leave-type')
      .where(
        'attachment.Name.value',
        '==',
        conn.req.body.attachment['Leave Type'].value,
      )
      .limit(1)
      .get(),
    locals.officeDoc.ref
      .collection(subcollectionNames.ACTIVITIES)
      .where('creator', '==', conn.requester.phoneNumber)
      .where('template', '==', 'leave')
      .where(
        'attachment.Leave Type.value',
        '==',
        conn.req.body.attachment['Leave Type'].value,
      )
      .where('startYear', '==', startMoment.year())
      .where('endYear', '==', endMoment.year())
      /** Cancelled leaves don't count to the full number */
      .where('isCancelled', '==', false)
      .get(),
  ]);

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

  if (locals.leavesTakenThisYear > locals.maxLeavesAllowed) {
    return sendResponse(
      conn,
      code.conflict,
      `Cannot create leave` +
        ` You have exceeded the limit for leave` +
        ` application under ${conn.req.body.attachment['Leave Type'].value}` +
        ` by ${locals.maxLeavesAllowed - locals.leavesTakenThisYear}`,
    );
  }

  return handleLeaveOrOnDuty(conn, locals);
};

const handleAssignees = async (conn, locals) => {
  if (conn.req.body.share.length === 0) {
    return sendResponse(conn, code.badRequest, `No assignees found`);
  }

  const typeActivity = new Set(['customer', 'leave', 'claim']);

  const key = (() => {
    for (const key of Object.keys(conn.req.body.attachment)) {
      const { value, type } = conn.req.body.attachment[key];

      if (type.endsWith('-type') && value === '') {
        return key;
      }
    }
  })();

  /**
   * If a `x-type` activity exists for the `x` template, and the
   * user hasn't selected the `x-type` while creating `x` activity,
   * then don't allow activity creation.
   */
  if (
    key &&
    typeActivity.has(conn.req.body.template) &&
    conn.req.body.attachment[key].value === ''
  ) {
    const {
      docs: [typeActivityDoc],
    } = await rootCollections.activities
      .where('office', '==', conn.req.body.office)
      .where('template', '==', `${conn.req.body.template}-type`)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get();

    if (typeActivityDoc) {
      return sendResponse(conn, code.conflict, `${key} is required`);
    }
  }

  return handlePayroll(conn, locals);
};

const handleClaims = async (conn, locals) => {
  if (conn.req.body.template !== 'claim') {
    return handleAssignees(conn, locals);
  }

  const claimType = conn.req.body.attachment['Claim Type'].value;
  const amount = conn.req.body.attachment.Amount.value;

  if (!claimType) {
    return handleAssignees(conn, locals);
  }

  if (Number(amount || 0) < 1) {
    return sendResponse(
      conn,
      code.badRequest,
      `Amount should be a positive number`,
    );
  }

  const { claimsThisMonth, monthlyLimit } = await getClaimStatus({
    claimType,
    officeId: locals.officeDoc.id,
    phoneNumber: conn.requester.phoneNumber,
    timezone: locals.officeDoc.get('attachment.Timezone.value'),
  });

  if (
    currencyJs(claimsThisMonth).add(amount).value >
    currencyJs(monthlyLimit).value
  ) {
    return sendResponse(
      conn,
      code.conflict,
      `Cannot create a claim. Max Claims (${monthlyLimit}) amount this month.`,
    );
  }

  return handleAssignees(conn, locals);
};

const resolveQuerySnapshotShouldNotExistPromises = async (
  conn,
  locals,
  result,
) => {
  const snapShots = await Promise.all(result.querySnapshotShouldNotExist);
  let successful = true;
  let message = null;

  for (const snapShot of snapShots) {
    const filters = snapShot.query._queryOptions.fieldFilters;
    const value = filters[0].value;
    const type = filters[1].value;

    if (!snapShot.empty) {
      successful = false;
      message = `The ${type} '${value}' already exists`;
      break;
    }
  }

  if (!successful) {
    return sendResponse(conn, code.badRequest, message);
  }

  return handleClaims(conn, locals);
};

const resolveQuerySnapshotShouldExistPromises = async (
  conn,
  locals,
  result,
) => {
  const snapShots = await Promise.all(result.querySnapshotShouldExist);
  let successful = true;
  let message;

  for (const snapShot of snapShots) {
    const filters = snapShot.query._queryOptions.fieldFilters;
    const value = filters[0].value;
    const type = filters[1].value;

    message = `${type} ${value} does not exist`;

    if (snapShot.empty) {
      successful = false;
      break;
    }
  }

  if (!successful) {
    return sendResponse(conn, code.badRequest, message);
  }

  return resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);
};

const resolveProfileCheckPromises = async (conn, locals, result) => {
  const snapShots = await Promise.all(result.profileDocShouldExist);

  let successful = true;
  let message = null;

  for (const doc of snapShots) {
    message = `The user ${doc.id} has not signed up on Growthfile.`;

    if (!doc.exists) {
      successful = false;
      break;
    }

    if (!doc.get('uid')) {
      successful = false;
      break;
    }
  }

  if (!successful) {
    return sendResponse(conn, code.badRequest, message);
  }

  return resolveQuerySnapshotShouldExistPromises(conn, locals, result);
};

const handleAttachmentArrays = async (conn, locals, result) => {
  const { attachment } = conn.req.body;
  const typePromises = [];

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
          `Invalid date found in ${conn.req.body.template}`,
        );
      }

      if (quantity && !Number.isInteger(quantity)) {
        return sendResponse(
          conn,
          code.badRequest,
          `Invalid quantity found in ${conn.req.body.template}`,
        );
      }

      if (rate !== '' && typeof rate !== 'number') {
        return sendResponse(
          conn,
          code.badRequest,
          `Invalid rate found in ${conn.req.body.template}`,
        );
      }

      typePromises.push(
        rootCollections.activities
          .where('attachment.Name.value', '==', name)
          .where('template', '==', type)
          .where('officeId', '==', locals.officeDoc.id)
          .limit(1)
          .get(),
      );
    }
  }

  // const snaps = await Promise.all(typePromises);

  for (const snap of await Promise.all(typePromises)) {
    const {
      docs: [doc],
    } = snap;

    if (!doc) {
      const [
        { value: name },
        { value: type },
      ] = snap.query._queryOptions.fieldFilters;

      return sendResponse(
        conn,
        code.badRequest,
        `${type} ${name} does not exist`,
      );
    }
  }

  return resolveProfileCheckPromises(conn, locals, result);
};

const handleAttachment = (conn, locals) => {
  const options = {
    bodyAttachment: conn.req.body.attachment,
    templateAttachment: locals.templateDoc.get('attachment'),
    template: conn.req.body.template,
    officeId: locals.officeDoc.id,
    office: conn.req.body.office,
  };

  const result = filterAttachment(options);

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  /**
   * All phone numbers in the attachment are added to the
   * activity assignees.
   */
  conn.req.body.share.push(...result.phoneNumbers);

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

const createLocals = async (
  conn,
  [subscriptionQueryResult, templateQueryResult, officeQueryResult],
) => {
  const [subscriptionDoc] = subscriptionQueryResult.docs;
  const [templateDoc] = templateQueryResult.docs;
  const [officeDoc] = officeQueryResult.docs;

  /**
   * Office doc should not exist if the template is office
   * because if that office with a name should exist uniquely.
   */
  if (officeDoc && conn.req.body.template === 'office') {
    return sendResponse(
      conn,
      code.conflict,
      `Office name '${conn.req.body.office}' is already in use`,
    );
  }

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

  if (subscriptionDoc) {
    conn.req.body.share.push(...subscriptionDoc.get('include'));
  }

  const locals = {
    templateDoc,
    officeDoc,
    subscriptionDoc,
  };

  if (conn.req.body.template === 'enquiry') {
    [
      officeDoc.get('attachment.First Contact.value'),
      officeDoc.get('attachment.Second Contact.value'),
    ]
      .filter(Boolean)
      .forEach(phoneNumber => {
        conn.req.body.share.push(phoneNumber);
      });
  }

  if (!conn.requester.isSupportRequest) {
    conn.req.body.share.push(conn.requester.phoneNumber);
  }

  const checkInResult = await isInvalidCheckIn({
    subscriptionDoc,
    currentGeopoint: conn.req.body.geopoint,
    provider: conn.req.body.geopoint.provider,
    phoneNumber: conn.requester.phoneNumber,
  });

  if (checkInResult) {
    return sendResponse(conn, code.badRequest, `Invalid check-in`);
  }

  const scheduleValidationResult = validateSchedules(
    conn.req.body,
    locals.templateDoc.get('schedule'),
  );

  conn.req.body.schedule = scheduleValidationResult.schedules;

  const venueValidationResult = validateVenues(
    conn.req.body,
    locals.templateDoc.get('venue'),
  );

  conn.req.body.venue = venueValidationResult.venues;

  return handleAttachment(conn, locals);
};

module.exports = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /create` +
        ' endpoint. Use POST',
    );
  }

  const bodyResult = isValidRequestBody(conn.req.body, httpsActions.create);

  if (!bodyResult.isValid) {
    return sendResponse(conn, code.badRequest, bodyResult.message);
  }

  try {
    const promises = [
      rootCollections.profiles
        .doc(conn.requester.phoneNumber)
        .collection(subcollectionNames.SUBSCRIPTIONS)
        .where('office', '==', conn.req.body.office)
        .where('template', '==', conn.req.body.template)
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

    return createLocals(conn, await Promise.all(promises));
  } catch (error) {
    return handleError(conn, error);
  }
};
