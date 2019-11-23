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
  code,
} = require('../../admin/responses');
const {
  httpsActions,
  subcollectionNames,
} = require('../../admin/constants');
const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  activityName,
  // setOnLeaveOrAr,
  validateVenues,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
  attendanceConflictHandler,
} = require('./helper');
const {
  handleError,
  sendResponse,
  getRelevantTime,
  getCustomerObject,
  getScheduleDates,
  getAdjustedGeopointsFromVenue,
} = require('../../admin/utils');
const env = require('../../admin/env');
const momentTz = require('moment-timezone');
const fs = require('fs');
const dinero = require('dinero.js');
const admin = require('firebase-admin');


const getClaimStatus = async params => {
  const {
    claimType,
    officeId,
    phoneNumber,
    timezone,
  } = params;
  const momentToday = momentTz()
    .tz(timezone);

  const [
    claimActivities,
    claimTypeActivity,
  ] = await Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ACTIVITIES)
        .where('template', '==', 'claim')
        .where('creator.phoneNumber', '==', phoneNumber)
        .where('attachment.Claim Type.value', '==', claimType)
        .where('creationMonth', '==', momentToday.month())
        .where('creationYear', '==', momentToday.year())
        .where('isCancelled', '==', false)
        .get(),
      rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ACTIVITIES)
        .where('template', '==', 'claim-type')
        .where('attachment.Name.value', '==', claimType)
        .limit(1)
        .get()
    ]);

  const claimTypeDoc = claimTypeActivity.docs[0];
  const monthlyLimit = claimTypeDoc.get('attachment.Monthly Limit.value');

  let claimsThisMonth = dinero({ amount: 0 });

  claimActivities.forEach(doc => {
    const amount = parseInt(doc.get('attachment.Amount.value') || 0);

    claimsThisMonth = claimsThisMonth
      .add(dinero({ amount }));
  });

  const o = {
    monthlyLimit,
    claimsThisMonth: claimsThisMonth.getAmount(),
  };

  return o;
};


const createDocsWithBatch = async (conn, locals) => {
  const canEditMap = {};

  locals
    .objects
    .allPhoneNumbers
    .forEach(phoneNumber => {
      let addToInclude = true;
      const isRequester = phoneNumber === conn.requester.phoneNumber;

      canEditMap[phoneNumber] = null;

      if (conn.req.body.template === 'subscription' && isRequester) {
        addToInclude = false;
      }

      locals
        .batch
        .set(locals.docs.activityRef
          .collection(subcollectionNames.ASSIGNEES)
          .doc(phoneNumber), {
          addToInclude,
        });
    });

  const addendumDocRef = rootCollections
    .offices
    .doc(locals.static.officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');

  let activityData = {
    venue: conn.req.body.venue,
    schedule: conn.req.body.schedule,
    attachment: conn.req.body.attachment,
  };

  if (activityData.schedule.length > 0) {
    activityData
      .relevantTime = getRelevantTime(activityData.schedule);

    activityData
      .scheduleDates = getScheduleDates(activityData.schedule);
  }

  if (activityData.attachment.Location
    && activityData.attachment.Location.value
    && activityData.relevantTime) {
    activityData
      .relevantTimeAndVenue = `${activityData.attachment.Location.value}`
      + ` ${activityData.relevantTime}`;
  }

  if (conn.req.body.template === 'customer') {
    const placesQueryResult = await getCustomerObject({
      address: conn.req.body.venue[0].address,
      location: conn.req.body.attachment.Name.value
    });

    activityData
      .attachment['First Contact'].value = '';

    activityData = placesQueryResult;

    if (placesQueryResult.failed) {
      return sendResponse(
        conn,
        code.conflict,
        `Address '${conn.req.body.venue[0].address}' is not valid`
      );
    }

    const queryResult = await rootCollections
      .activities
      .where('office', '==', conn.req.body.office)
      .where('template', '==', 'customer')
      .where('status', '==', 'CONFIRMED')
      .where('attachment.Name.value', '==', activityData.attachment.Name.value)
      .limit(1)
      .get();

    if (!queryResult.empty) {
      return sendResponse(
        conn,
        code.conflict,
        `Customer with the name`
        + ` '${activityData.attachment.Name.value}'`
        + ` already exists`
      );
    }
  }

  activityData
    .office = conn.req.body.office;
  activityData
    .addendumDocRef = addendumDocRef;
  activityData
    .timezone = timezone;
  activityData
    .timestamp = Date.now();
  activityData
    .template = conn.req.body.template;
  activityData
    .status = locals.static.statusOnCreate;
  activityData
    .canEditRule = locals.static.canEditRule;
  activityData
    .activityName = activityName({
      requester: conn.requester,
      attachmentObject: conn.req.body.attachment,
      templateName: conn.req.body.template,
    });
  activityData
    .officeId = locals.static.officeId;
  activityData
    .hidden = locals.static.hidden;
  activityData
    .creator = {
    phoneNumber: conn.requester.phoneNumber,
    displayName: conn.requester.displayName,
    photoURL: conn.requester.photoURL,
  };
  activityData
    .createTimestamp = Date.now();

  const adjustedGeopoints = getAdjustedGeopointsFromVenue(
    conn.req.body.venue
  );

  const templatesToSkip = new Set([
    'check-in',
    'attendance regularization',
    'leave'
  ]);

  if (!templatesToSkip.has(conn.req.body.template)
    && adjustedGeopoints.length > 0) {
    activityData.adjustedGeopoints = adjustedGeopoints[0];
  }

  const date = momentTz().tz(timezone).date();
  const month = momentTz().tz(timezone).month();
  const year = momentTz().tz(timezone).year();

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
    share: Array.from(locals.objects.allPhoneNumbers),
    action: httpsActions.create,
    template: conn.req.body.template,
    location: getGeopointObject(conn.req.body.geopoint),
    timestamp: Date.now(),
    userDeviceTimestamp: conn.req.body.timestamp,
    /** The `activityId` field is required by `addendumOnCreate` */
    activityId: locals.static.activityId,
    activityName: activityData.activityName,
    isSupportRequest: conn.requester.isSupportRequest,
    geopointAccuracy: conn.req.body.geopoint.accuracy || null,
    provider: conn.req.body.geopoint.provider || null,
  };

  if (locals.cancellationMessage) {
    addendumDocObject.cancellationMessage = locals.cancellationMessage;
  }

  locals
    .batch
    .set(addendumDocRef, addendumDocObject);
  locals
    .batch
    .set(locals.docs.activityRef, activityData);

  /** For base64 images, upload the json file to bucket */
  if (conn.isBase64
    && conn.base64Field) {
    delete activityData.addendumDocRef;
    delete addendumDocObject.activityData.addendumDocRef;

    const json = {
      canEditMap,
      activityData,
      addendumDocObject,
      activityId: locals.docs.activityRef.id,
      addendumId: addendumDocRef.id,
      base64Field: conn.base64Field,
      requestersPhoneNumber: conn.requester.phoneNumber,
    };

    const storage = admin.storage();
    const bucket = storage.bucket(env.tempBucketName);
    const activityId = locals.docs.activityRef.id;
    const fileName = `${activityId}.json`;
    const filePath = `/tmp/${fileName}`;

    fs
      .writeFileSync(filePath, JSON.stringify(json));

    await bucket
      .upload(filePath);

    return sendResponse(conn, code.created);
  }

  /** ENDS the response. */
  await locals
    .batch
    .commit();

  return sendResponse(conn, code.created);
};

const handleLeaveOrOnDuty = async (conn, locals) => {
  const startTime = conn.req.body.schedule[0].startTime;
  const endTime = conn.req.body.schedule[0].endTime;
  const startTimeMoment = momentTz(startTime);
  const endTimeMoment = momentTz(endTime);
  const leavesTakenThisTime = endTimeMoment.diff(startTimeMoment, 'days');

  if (leavesTakenThisTime + locals.leavesTakenThisYear > locals.maxLeavesAllowed) {
    locals.static.statusOnCreate = 'CANCELLED';
    locals.cancellationMessage = `LEAVE CANCELLED: Leave limit exceeded by`
      + ` ${leavesTakenThisTime + locals.leavesTakenThisYear - locals.maxLeavesAllowed} days.`;

    return createDocsWithBatch(conn, locals);
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
    const message = `Cannot apply for ${article} ${conn.req.body.template}.`
      + ` You are already on ${article2} ${conflictingTemplate} on the date`
      + ` ${conflictingDate}`;

    return sendResponse(conn, code.badRequest, message);
  }

  return createDocsWithBatch(conn, locals);
};


const handlePayroll = async (conn, locals) => {
  if (!new Set()
    .add('leave')
    .add('attendance regularization')
    .has(conn.req.body.template)) {
    return createDocsWithBatch(conn, locals);
  }

  if (!conn.req.body.schedule[0].startTime
    || !conn.req.body.schedule[0].endTime) {
    return createDocsWithBatch(conn, locals);
  }

  if (conn.req.body.template !== 'leave') {
    return handleLeaveOrOnDuty(conn, locals);
  }

  const startMoment = momentTz(conn.req.body.schedule[0].endTime);
  const endMoment = momentTz(conn.req.body.schedule[0].endTime);

  locals
    .maxLeavesAllowed = Number.POSITIVE_INFINITY;
  locals
    .leavesTakenThisYear = 0;

  if (!conn.req.body.attachment['Leave Type'].value) {
    locals.maxLeavesAllowed = 20;
  }

  const [
    leaveTypeQuery,
    leaveActivityQuery
  ] = await Promise
    .all([
      rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection(subcollectionNames.ACTIVITIES)
        .where('template', '==', 'leave-type')
        .where('attachment.Name.value', '==', conn.req.body.attachment['Leave Type'].value)
        .limit(1)
        .get(),
      rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection(subcollectionNames.ACTIVITIES)
        .where('creator', '==', conn.requester.phoneNumber)
        .where('template', '==', 'leave')
        .where('attachment.Leave Type.value', '==', conn.req.body.attachment['Leave Type'].value)
        .where('startYear', '==', startMoment.year())
        .where('endYear', '==', endMoment.year())
        /** Cancelled leaves don't count to the full number */
        .where('isCancelled', '==', false)
        .get(),
    ]);

  if (!leaveTypeQuery.empty) {
    locals
      .maxLeavesAllowed = Number(
        leaveTypeQuery.docs[0].get('attachment.Annual Limit.value') || 0
      );
  }

  leaveActivityQuery
    .forEach(doc => {
      const {
        startTime,
        endTime,
      } = doc.get('schedule')[0];

      const start = momentTz(startTime).startOf('day').valueOf();
      const end = momentTz(endTime).endOf('day').valueOf();

      locals
        .leavesTakenThisYear += momentTz(end).diff(start, 'days');
    });

  if (locals.leavesTakenThisYear > locals.maxLeavesAllowed) {
    locals
      .cancellationMessage = `LEAVE LIMIT EXCEEDED:`
      + ` You have exceeded the limit for leave`
      + ` application under ${conn.req.body.attachment['Leave Type'].value}`
      + ` by ${locals.maxLeavesAllowed - locals.leavesTakenThisYear}`;

    locals
      .static
      .statusOnCreate = 'CANCELLED';

    return createDocsWithBatch(conn, locals);
  }

  return handleLeaveOrOnDuty(conn, locals);
};



const handleAssignees = async (conn, locals) => {
  if (locals.objects.allPhoneNumbers.size === 0) {
    return sendResponse(
      conn,
      code.badRequest,
      `No assignees found`
    );
  }

  const promises = [];

  locals
    .objects
    .allPhoneNumbers
    .forEach(phoneNumber => {
      const isRequester = phoneNumber === conn.requester.phoneNumber;
      /**
       * Defaults are `false`, since we don't know right now what
       * these people are in the office in context.
       */
      locals
        .objects
        .permissions[
        phoneNumber
      ] = {
        isAdmin: false,
        isEmployee: false,
        isCreator: isRequester,
      };

      if (locals.static.canEditRule === 'EMPLOYEE') {
        promises
          .push(rootCollections
            .offices
            .doc(locals.static.officeId)
            .collection(subcollectionNames.ACTIVITIES)
            .where('attachment.Employee Contact.value', '==', phoneNumber)
            .where('template', '==', 'employee')
            .limit(1)
            .get()
          );
      }
    });

  const snapShots = await Promise.all(promises);

  snapShots.forEach(snapShot => {
    if (snapShot.empty) return;

    const doc = snapShot.docs[0];
    const phoneNumber = doc.get('attachment.Employee Contact.value');
    const template = doc.get('template');
    const isEmployee = template === 'employee';

    if (isEmployee) {
      locals.objects.permissions[phoneNumber].isEmployee = isEmployee;
    }
  });

  const typeActivity = new Set([
    'customer',
    'leave',
    'claim',
  ]);

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
  if (key
    && typeActivity.has(conn.req.body.template)
    && conn.req.body.attachment[key].value === '') {
    const typeQueryResult = await rootCollections
      .activities
      .where('office', '==', conn.req.body.office)
      .where('template', '==', `${conn.req.body.template}-type`)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get();

    if (!typeQueryResult.empty) {
      return sendResponse(
        conn,
        code.conflict,
        `${key} is required`
      );
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
      `Amount should be a positive number`
    );
  }

  const {
    claimsThisMonth,
    monthlyLimit,
  } = await getClaimStatus({
    claimType,
    officeId: locals.officeDoc.id,
    phoneNumber: conn.requester.phoneNumber,
    timezone: locals.officeDoc.get('attachment.Timezone.value'),
  });

  if (claimsThisMonth + amount > monthlyLimit) {
    locals
      .static
      .statusOnCreate = 'CANCELLED';

    locals
      .cancellationMessage = `CLAIM CANCELLED: Exceeded`
      + ` Max Claims (${monthlyLimit}) amount this month.`;
  }

  return handleAssignees(conn, locals);
};


const resolveQuerySnapshotShouldNotExistPromises = async (conn, locals, result) => {
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


const resolveQuerySnapshotShouldExistPromises = async (conn, locals, result) => {
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


const handleAttachment = (conn, locals) => {
  const options = {
    bodyAttachment: conn.req.body.attachment,
    templateAttachment: locals.objects.attachment,
    template: conn.req.body.template,
    officeId: locals.static.officeId,
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
  result
    .phoneNumbers
    .forEach(phoneNumber => {
      locals.objects.allPhoneNumbers.add(phoneNumber);
    });

  const {
    isBase64,
    base64Field,
  } = result;

  conn.isBase64 = isBase64;
  conn.base64Field = base64Field;

  return resolveProfileCheckPromises(conn, locals, result);
};


const handleScheduleAndVenue = (conn, locals) => {
  const scheduleValidationResult = validateSchedules(
    conn.req.body,
    locals.objects.schedule
  );

  if (!scheduleValidationResult.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      scheduleValidationResult.message
    );
  }

  conn
    .req
    .body
    .schedule = scheduleValidationResult.schedules;

  const venueValidationResult = validateVenues(
    conn.req.body,
    locals.objects.venue
  );

  if (!venueValidationResult.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      venueValidationResult.message
    );
  }

  conn.req.body.venue = venueValidationResult.venues;

  return handleAttachment(conn, locals);
};

const createLocals = (conn, result) => {
  const activityRef = rootCollections.activities.doc();

  /**
   * Temporary object in memory to store all data during the function
   * instance.
   */
  const locals = {
    batch: db.batch(),
    /**
     * Stores all the static data during the function instance.
     */
    static: {
      /** Storing this here to be consistent with other functions. */
      activityId: activityRef.id,
      /**
       * A fallback case when the template is `office` so the
       * activity is used to create the office. This value will
       * updated accordingly at appropriate time after checking
       * the template name from the request body.
       */
      officeId: activityRef.id,
      /**
       * A fallback in cases when the subscription doc is not found
       * during the `support` requests.
       */
      include: [],
      /**
       * Used by the `filterAttachment` function to check the duplication
       * of entities inside the `Offices / (officeId) / Activities` collection.
       * Eg., When the template is `employee`, the `req.body.attachment.Name`
       * + `locals.static.template` will be used to query for the employee.
       * If their doc already exists, reject the request.
       */
      template: conn.req.body.template,
    },
    /**
     * For storing all object types (e.g, schedule, venue, attachment)
     *  for the function instance.
     */
    objects: {
      /**
       * Using a `Set()` to avoid duplication of phone numbers.
       */
      allPhoneNumbers: new Set(),
      /**
       * Stores the phoneNumber and it's permission to see
       * if it is an `admin` of the office, or an `employee`.
       */
      permissions: {},
      schedule: [],
      venue: [],
      attachment: {},
    },
    /**
     * Stores all the document references for the function instance.
     */
    docs: {
      activityRef,
    },
  };

  const [
    subscriptionQueryResult,
    officeQueryResult,
    templateQueryResult,
  ] = result;

  if (officeQueryResult.empty
    && conn.req.body.template !== 'office') {
    return sendResponse(
      conn,
      code.forbidden,
      `No office found with the name: '${conn.req.body.office}'`
    );
  }

  if (subscriptionQueryResult.empty
    && conn.req.body.template !== 'enquiry'
    && !conn.requester.isSupportRequest) {
    return sendResponse(
      conn,
      code.forbidden,
      `No subscription found for the template: '${conn.req.body.template}'`
      + ` with the office '${conn.req.body.office}'`
    );
  }

  if (!subscriptionQueryResult.empty) {
    if (subscriptionQueryResult.docs[0].get('status') === 'CANCELLED') {
      return sendResponse(
        conn,
        code.forbidden,
        `Your subscription to the template '${conn.req.body.template}'`
        + ` is 'CANCELLED'. Cannot create an activity`
      );
    }

    /**
     * Default assignees for all the activities that the user
     * creates using the subscription mentioned in the request body.
     */
    subscriptionQueryResult
      .docs[0]
      .get('include')
      .forEach(phoneNumber => {
        locals.objects.allPhoneNumbers.add(phoneNumber);
      });
  }

  if (!officeQueryResult.empty) {
    if (conn.req.body.template === 'office') {
      return sendResponse(
        conn,
        code.conflict,
        `The office '${conn.req.body.office}' already exists`
      );
    }

    if (officeQueryResult.docs[0].get('status') === 'CANCELLED') {
      return sendResponse(
        conn,
        code.forbidden,
        `The office status is 'CANCELLED'. Cannot create an activity`
      );
    }

    locals
      .static
      .officeId = officeQueryResult.docs[0].id;
    locals
      .officeDoc = officeQueryResult.docs[0];
  }

  if (conn.req.body.template === 'enquiry') {
    if (locals.officeDoc.get('attachment.First Contact.value')) {
      conn
        .req
        .body
        .share
        .push(locals.officeDoc.get('attachment.First Contact.value'));
    }

    if (locals.officeDoc.get('attachment.Second Contact.value')) {
      conn
        .req
        .body
        .share
        .push(locals.officeDoc.get('attachment.Second Contact.value'));
    }
  }

  conn
    .req
    .body
    .share
    .forEach(phoneNumber => {
      locals.objects.allPhoneNumbers.add(phoneNumber);
    });

  if (!conn.requester.isSupportRequest
    && conn.req.body.template !== 'enquiry') {
    locals.objects.schedule = subscriptionQueryResult.docs[0].get('schedule');
    locals.objects.venue = subscriptionQueryResult.docs[0].get('venue');
    locals.objects.attachment = subscriptionQueryResult.docs[0].get('attachment');
    locals.static.canEditRule = subscriptionQueryResult.docs[0].get('canEditRule');
    locals.static.statusOnCreate = subscriptionQueryResult.docs[0].get('statusOnCreate');
    locals.static.hidden = subscriptionQueryResult.docs[0].get('hidden');
  } else {
    if (templateQueryResult.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `No template found with the name: '${conn.req.body.template}'`
      );
    }

    locals.objects.schedule = templateQueryResult.docs[0].get('schedule');
    locals.objects.venue = templateQueryResult.docs[0].get('venue');
    locals.objects.attachment = templateQueryResult.docs[0].get('attachment');
    locals.static.canEditRule = templateQueryResult.docs[0].get('canEditRule');
    locals.static.statusOnCreate = templateQueryResult.docs[0].get('statusOnCreate');
    locals.static.hidden = templateQueryResult.docs[0].get('hidden');
  }

  if (!conn.requester.isSupportRequest) {
    locals.objects.allPhoneNumbers.add(conn.requester.phoneNumber);
  }

  return handleScheduleAndVenue(conn, locals);
};


module.exports = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /create`
      + ' endpoint. Use POST'
    );
  }

  const bodyResult = isValidRequestBody(
    conn.req.body,
    httpsActions.create
  );

  if (!bodyResult.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      bodyResult.message
    );
  }

  const promises = [
    rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection(subcollectionNames.SUBSCRIPTIONS)
      .where('office', '==', conn.req.body.office)
      .where('template', '==', conn.req.body.template)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get(),
    rootCollections
      .offices
      .where('attachment.Name.value', '==', conn.req.body.office)
      .limit(1)
      .get(),
  ];

  /**
   * Bringing in the template doc when the request is of type
   * support since the requester may or may not have the subscription
   * to the template they want to use.
   */
  if (conn.requester.isSupportRequest
    || conn.req.body.template === 'enquiry') {
    promises
      .push(rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get()
      );
  }

  try {
    const result = await Promise
      .all(promises);
    return createLocals(conn, result);
  } catch (error) {
    return handleError(conn, error);
  }
};
