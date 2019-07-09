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
  reportNames,
} = require('../../admin/constants');
const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  activityName,
  validateVenues,
  forSalesReport,
  getCanEditValue,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
  setOnLeaveOrAr,
} = require('./helper');
const {
  handleError,
  sendResponse,
  getAdjustedGeopointsFromVenue,
} = require('../../admin/utils');
const env = require('../../admin/env');
const momentTz = require('moment-timezone');
const fs = require('fs');


const createDocsWithBatch = (conn, locals) => {
  const canEditMap = {};
  locals.objects.allPhoneNumbers
    .forEach(phoneNumber => {
      let addToInclude = true;

      const isRequester = phoneNumber === conn.requester.phoneNumber;

      if (conn.req.body.template === 'subscription' && isRequester) {
        addToInclude = false;
      }

      const canEdit = getCanEditValue(locals, phoneNumber);

      canEditMap[phoneNumber] = canEdit;

      locals.batch.set(locals.docs.activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
          addToInclude,
          canEdit,
        });
    });

  const addendumDocRef = rootCollections
    .offices
    .doc(locals.static.officeId)
    .collection('Addendum')
    .doc();

  const timezone = locals.officeDoc.get('attachment.Timezone.value');

  const activityData = {
    addendumDocRef,
    timezone,
    venue: locals.objects.venueArray,
    timestamp: Date.now(),
    office: conn.req.body.office,
    template: conn.req.body.template,
    schedule: locals.objects.scheduleArray,
    status: locals.static.statusOnCreate,
    attachment: conn.req.body.attachment,
    canEditRule: locals.static.canEditRule,
    activityName: activityName({
      requester: conn.requester,
      attachmentObject: conn.req.body.attachment,
      templateName: conn.req.body.template,
    }),
    officeId: locals.static.officeId,
    hidden: locals.static.hidden,
    creator: {
      phoneNumber: conn.requester.phoneNumber,
      displayName: conn.requester.displayName,
      photoURL: conn.requester.photoURL,
    },
    createTimestamp: Date.now(),
    forSalesReport: forSalesReport(conn.req.body.template),
  };

  const adjustedGeopoints = getAdjustedGeopointsFromVenue(
    locals.objects.venueArray
  );

  const templatesToSkip = new Set(['check-in', 'attendance regularization', 'leave']);

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
  if (conn.isBase64 && conn.base64Field) {
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

    const storage = require('firebase-admin').storage();
    const bucketName = env.tempBucketName;
    const bucket = storage.bucket(bucketName);
    const activityId = locals.docs.activityRef.id;
    const fileName = `${activityId}.json`;
    const filePath = `/tmp/${fileName}`;

    fs.writeFileSync(filePath, JSON.stringify(json));

    console.log('Uploading to file');

    return bucket
      .upload(filePath)
      .then(() => sendResponse(conn, code.created))
      .catch(error => handleError(conn, error));
  }

  /** ENDS the response. */
  return locals
    .batch
    .commit()
    .then(() => sendResponse(conn, code.created))
    .catch(error => handleError(conn, error));
};

const handleLeaveOrOnDuty = (conn, locals) => {
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

  return setOnLeaveOrAr(
    conn.requester.phoneNumber,
    locals.officeDoc.id,
    startTime,
    endTime,
    conn.req.body.template
  )
    .then(result => {
      const { success, message } = result;

      if (!success) {
        locals.static.statusOnCreate = 'CANCELLED';
        locals.cancellationMessage = `${conn.req.body.template.toUpperCase()} CANCELLED: ${message}`;
      }

      return createDocsWithBatch(conn, locals);
    })
    .catch(error => handleError(conn, error));
};


const handlePayroll = (conn, locals) => {
  if (!new Set()
    .add(reportNames.LEAVE)
    .add(reportNames.ON_DUTY)
    .has(conn.req.body.template)) {
    return createDocsWithBatch(conn, locals);
  }

  const startTime = conn.req.body.schedule[0].startTime;
  const endTime = conn.req.body.schedule[0].endTime;

  if (!startTime || !endTime) {
    return createDocsWithBatch(conn, locals);
  }

  if (conn.req.body.template !== 'leave') {
    return handleLeaveOrOnDuty(conn, locals);
  }

  const leaveType = conn.req.body.attachment['Leave Type'].value;
  const startMoment = momentTz(conn.req.body.schedule[0].startTime);
  const endMoment = momentTz(conn.req.body.schedule[0].endTime);
  locals.maxLeavesAllowed = Number.POSITIVE_INFINITY;
  locals.leavesTakenThisYear = 0;

  if (!leaveType) {
    locals.maxLeavesAllowed = 20;
  }

  return Promise
    .all([
      rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection('Activities')
        .where('template', '==', 'leave-type')
        .where('attachment.Name.value', '==', leaveType || null)
        .limit(1)
        .get(),
      rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection('Activities')
        .where('creator', '==', conn.requester.phoneNumber)
        .where('template', '==', 'leave')
        .where('attachment.Leave Type.value', '==', leaveType || null)
        .where('startYear', '==', startMoment.year())
        .where('endYear', '==', endMoment.year())
        /** Cancelled leaves don't count to the full number */
        .where('isCancelled', '==', false)
        .get(),
    ])
    .then(result => {
      const [
        leaveTypeQuery,
        leaveActivityQuery,
      ] = result;

      if (!leaveTypeQuery.empty) {
        locals
          .maxLeavesAllowed =
          Number(leaveTypeQuery
            .docs[0]
            .get('attachment.Annual Limit.value') || 0);
      }

      leaveActivityQuery.forEach((doc) => {
        const {
          startTime,
          endTime,
        } = doc.get('schedule')[0];
        const start = momentTz(startTime).startOf('day').unix() * 1000;
        const end = momentTz(endTime).endOf('day').unix() * 1000;

        locals.leavesTakenThisYear += momentTz(end).diff(start, 'days');
      });

      if (locals.leavesTakenThisYear > locals.maxLeavesAllowed) {
        console.log('CANCELL HERE 3');

        locals
          .cancellationMessage = `LEAVE LIMIT EXCEEDED:`
          + ` You have exceeded the limit for leave`
          + ` application under ${leaveType}`
          + ` by ${locals.maxLeavesAllowed - locals.leavesTakenThisYear}`;

        locals
          .static
          .statusOnCreate = 'CANCELLED';

        return createDocsWithBatch(conn, locals);
      }

      return handleLeaveOrOnDuty(conn, locals);
    })
    .catch(error => handleError(conn, error));
};


const handleAssignees = (conn, locals) => {
  if (locals.objects.allPhoneNumbers.size === 0) {
    return sendResponse(conn, code.badRequest, `No assignees found`);
  }

  const promises = [];

  locals
    .objects
    .allPhoneNumbers
    .forEach((phoneNumber) => {
      const isRequester = phoneNumber === conn.requester.phoneNumber;
      /**
       * Defaults are `false`, since we don't know right now what
       * these people are in the office in context.
       */
      locals.objects.permissions[phoneNumber] = {
        isAdmin: false,
        isEmployee: false,
        isCreator: isRequester,
      };

      if (locals.static.canEditRule === 'EMPLOYEE') {
        promises
          .push(rootCollections
            .offices
            .doc(locals.static.officeId)
            .collection('Activities')
            .where('attachment.Employee Contact.value', '==', phoneNumber)
            .where('template', '==', 'employee')
            .limit(1)
            .get()
          );
      }
    });

  return Promise
    .all(promises)
    .then(snapShots => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        let phoneNumber;
        const doc = snapShot.docs[0];
        const template = doc.get('template');
        const isEmployee = template === 'employee';

        if (isEmployee) {
          phoneNumber = doc.get('attachment.Employee Contact.value');
          locals.objects.permissions[phoneNumber].isEmployee = isEmployee;
        }
      });

      return handlePayroll(conn, locals);
    })
    .catch(error => handleError(conn, error));
};


const resolveQuerySnapshotShouldNotExistPromises = (conn, locals, result) => {
  const promises = result.querySnapshotShouldNotExist;

  if (promises.length === 0) {
    return handleAssignees(conn, locals);
  }

  return Promise
    .all(promises)
    .then(snapShots => {
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

      return handleAssignees(conn, locals);
    })
    .catch(error => handleError(conn, error));
};


const resolveQuerySnapshotShouldExistPromises = (conn, locals, result) => {
  if (result.querySnapshotShouldExist.length === 0) {
    return resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);
  }

  return Promise
    .all(result.querySnapshotShouldExist)
    .then(snapShots => {
      let successful = true;
      let message;

      for (const snapShot of snapShots) {
        const filters = snapShot.query._queryOptions.fieldFilters;
        const value = filters[0].value;
        const type = filters[1].value;

        console.log({ value, type });

        message = `${type} ${value} does not exist`;

        if (snapShot.empty) {
          successful = false;
          break;
        }
      }

      if (!successful && conn.req.body.template !== 'dsr') {
        return sendResponse(conn, code.badRequest, message);
      }

      return resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);
    })
    .catch(error => handleError(conn, error));
};


const resolveProfileCheckPromises = (conn, locals, result) => {
  if (result.profileDocShouldExist.length === 0) {
    return resolveQuerySnapshotShouldExistPromises(conn, locals, result);
  }

  return Promise
    .all(result.profileDocShouldExist)
    .then(snapShots => {
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
    })
    .catch(error => handleError(conn, error));
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
  const scheduleValidationResult =
    validateSchedules(conn.req.body, locals.objects.schedule);

  if (!scheduleValidationResult.isValid) {
    return sendResponse(conn, code.badRequest, scheduleValidationResult.message);
  }

  locals.objects.scheduleArray = scheduleValidationResult.schedules;

  const venueValidationResult =
    validateVenues(conn.req.body, locals.objects.venue);

  if (!venueValidationResult.isValid) {
    return sendResponse(conn, code.badRequest, venueValidationResult.message);
  }

  /**
   * Can't directly write the `conn.req.body.venue` to the activity root
   * because venue objects contain `Geopoint` object of Firebase.
   * We need to convert that from a normal `JS` Object for each venue.
   */
  locals.objects.venueArray = venueValidationResult.venues;

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

    locals.static.officeId = officeQueryResult.docs[0].id;
    locals.officeDoc = officeQueryResult.docs[0];
  }

  if (conn.req.body.template === 'enquiry') {
    if (locals.officeDoc.get('attachment.First Contact.value')) {
      conn.req.body.share.push(locals.officeDoc.get('attachment.First Contact.value'));
    }

    if (locals.officeDoc.get('attachment.Second Contact.value')) {
      conn.req.body.share.push(locals.officeDoc.get('attachment.Second Contact.value'));
    }
  }

  conn.req.body.share.forEach((phoneNumber) => {
    locals.objects.allPhoneNumbers.add(phoneNumber);
  });

  if (!conn.requester.isSupportRequest && conn.req.body.template !== 'enquiry') {
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


module.exports = conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /create`
      + ' endpoint. Use POST'
    );
  }

  const bodyResult = isValidRequestBody(conn.req.body, httpsActions.create);

  if (!bodyResult.isValid) {
    return sendResponse(conn, code.badRequest, bodyResult.message);
  }

  const promises = [
    rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Subscriptions')
      .where('office', '==', conn.req.body.office)
      .where('template', '==', conn.req.body.template)
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

  return Promise
    .all(promises)
    .then(result => createLocals(conn, result))
    .catch(error => handleError(conn, error));
};
