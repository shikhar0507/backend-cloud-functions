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
  templatesSet,
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
  getCanEditValue,
  filterAttachment,
  haversineDistance,
  validateSchedules,
  isValidRequestBody,
} = require('./helper');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');
const momentTz = require('moment-timezone');


const createDocsWithBatch = (conn, locals) => {
  locals.objects.allPhoneNumbers
    .forEach((phoneNumber) => {
      let addToInclude = true;

      const isRequester = phoneNumber === conn.requester.phoneNumber;

      if (conn.req.body.template === 'subscription' && isRequester) {
        addToInclude = false;
      }

      let canEdit = getCanEditValue(locals, phoneNumber);

      /**
       * When the template is `admin`, the person who's being added
       * as an admin, should have the edit rights of the activity starting
       * from this activity (if `canEditRule` is `ADMIN`).
       *
       * Explicitly setting this here because the check for admin
       * in the path `Offices/(officeId)/Activities` will not result in a
       * document for this person. Because of that, the canEdit value will
       * be `false` for them.
       *
       * The following block counters that.
       */
      if (conn.req.body.template === 'admin'
        && phoneNumber === conn.req.body.attachment.Admin.value) {
        canEdit = true;
      }

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

  const activityData = {
    addendumDocRef,
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
    creator: conn.requester.phoneNumber,
  };

  const now = new Date();

  const addendumDocObject = {
    activityData,
    date: now.getDate(),
    month: now.getMonth(),
    year: now.getFullYear(),
    dateString: now.toDateString(),
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
    activityId: locals.static.activityId,
    activityName: activityData.activityName,
    isSupportRequest: conn.requester.isSupportRequest,
    geopointAccuracy: conn.req.body.geopoint.accuracy || null,
  };

  if (conn.req.body.template === 'check-in'
    && conn.req.body.venue[0].geopoint.latitude
    && conn.req.body.venue[0].geopoint.longitude) {
    const geopointOne = {
      _latitude: conn.req.body.geopoint.latitude,
      _longitude: conn.req.body.geopoint.longitude,
      accuracy: conn.req.body.geopoint.accuracy,
    };

    const geopointTwo = {
      _latitude: conn.req.body.venue[0].geopoint.latitude,
      _longitude: conn.req.body.venue[0].geopoint.longitude,
    };

    const accuracy = (() => {
      if (geopointOne.accuracy && geopointOne.accuracy < 0.35) {
        return 0.5;
      }

      return 1;
    })();

    const distanceAccurate =
      haversineDistance(geopointOne, geopointTwo) < accuracy;

    if (!distanceAccurate) activityData.status = 'CANCELLED';

    addendumDocObject.distanceAccurate = distanceAccurate;
  }

  if (locals.static.statusOnCreate === 'CANCELLED') {
    addendumDocObject.cancellationMessage = locals.cancellationMessage;
  }

  locals.batch.set(addendumDocRef, addendumDocObject);
  locals.batch.set(locals.docs.activityRef, activityData);

  console.log('statusOnCreate:', locals.static.statusOnCreate);

  /** ENDS the response. */
  locals
    .batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


const getPayrollObject = (options) => {
  const {
    payrollObject,
    monthDatesMap,
    month,
    year,
    phoneNumber,
    requestBody,
  } = options;

  let datesConflicted = false;

  if (!payrollObject[phoneNumber]) {
    payrollObject[phoneNumber] = {};
  }

  const getStatus = () => {
    if (requestBody.template === 'leave') {
      if (requestBody.attachment['Leave Type'].value) {
        return `LEAVE - ${requestBody.attachment['Leave Type'].value}`;
      }

      return `LEAVE`;
    }

    return `ON DUTY`;
  };

  const newStatus = getStatus();
  console.log({ newStatus });

  monthDatesMap
    .get(`${month}-${year}`)
    .forEach((date) => {
      if (!payrollObject[phoneNumber][date]) {
        payrollObject[phoneNumber][date] = 'BLANK';
      }

      // Creating a new leave with same dates
      if (payrollObject[phoneNumber][date].startsWith('LEAVE')
        && newStatus.startsWith('LEAVE')) {
        datesConflicted = true;

        return;
      }

      // Creating a leave when ON DUTY is already set
      if (payrollObject[phoneNumber][date].startsWith('LEAVE')
        && newStatus === 'ON DUTY') {
        datesConflicted = true;

        return;
      }

      // Creating an ON DUTY when the leave is already set
      if (payrollObject[phoneNumber][date] === 'ON DUTY'
        && newStatus.startsWith('LEAVE')) {
        datesConflicted = true;

        return;
      }

      // Creating ON DUTY when ON DUTY is already set
      if (payrollObject[phoneNumber][date] === 'ON DUTY'
        && newStatus === 'ON DUTY') {
        datesConflicted = true;

        return;
      }

      payrollObject[phoneNumber][date] = newStatus;
    });

  return {
    payrollObject,
    datesConflicted,
  };
};


const handleLeaveOrTourPlan = (conn, locals) => {
  const getPromiseObject = (month, year, office) => {
    return rootCollections
      .inits
      .where('office', '==', office)
      .where('report', '==', 'payroll')
      .where('month', '==', month)
      .where('year', '==', year)
      .limit(1)
      .get();
  };

  const startTime = conn.req.body.schedule[0].startTime;
  const endTime = conn.req.body.schedule[0].endTime;
  const startTimeMoment = momentTz(startTime);
  const endTimeMoment = momentTz(endTime);
  const startTimeUnix =
    startTimeMoment
      .startOf('day')
      .unix() * 1000;
  const endTimeUnix =
    endTimeMoment
      .endOf('day')
      .unix() * 1000;

  const leavesTakenThisTime = endTimeMoment.diff(startTimeMoment, 'days');

  if (leavesTakenThisTime + locals.leavesTakenThisYear > locals.maxLeavesAllowed) {
    console.log({
      'maxLeavesAllowed': locals.maxLeavesAllowed,
      'leavesTaken': leavesTakenThisTime,
      'leavesTakenThisYear': locals.leavesTakenThisYear,
    });

    console.log('CANCELL HERE 1');
    locals.static.statusOnCreate = 'CANCELLED';
    locals.cancellationMessage =
      `ACTIVITY CANCELLED. MAX LEAVES TAKEN ALREADY`;

    createDocsWithBatch(conn, locals);

    return;
  }

  const initFetchPromises = [];
  /**
   * Can be used to know using the result index to see which
   * month + year combination doc doesn't exist.
   */
  const docMeta = [];
  const NUM_MILLI_SECS_IN_A_DAY = 86400000;
  const startMoment = momentTz(startTimeUnix);
  let oldMonthValue = startMoment.month();
  let oldYearValue = startMoment.year();
  /** 
   * Stores the dates as a Set in the value field of this map
   * so that we only update the values for the user that are for the
   * month in context and only the dates which are in the month.
   */
  const monthDatesMap = new Map();

  initFetchPromises.push(
    getPromiseObject(oldMonthValue, oldYearValue, conn.req.body.office)
  );

  docMeta.push({ month: oldMonthValue, year: oldYearValue });

  for (let iter = startTimeUnix; iter <= endTimeUnix; iter += NUM_MILLI_SECS_IN_A_DAY) {
    const newMoment = momentTz(iter);
    const newDateValue = newMoment.date();
    const newMonthValue = newMoment.month();
    const newYearValue = newMoment.year();

    if (monthDatesMap.has(`${newMonthValue}-${newYearValue}`)) {
      monthDatesMap
        .get(`${newMonthValue}-${newYearValue}`)
        .add(newDateValue);
    } else {
      monthDatesMap
        .set(`${newMonthValue}-${newYearValue}`, new Set().add(newDateValue));
    }

    if (oldMonthValue === newMonthValue
      && oldYearValue === newYearValue) {
      continue;
    }

    oldMonthValue = newMonthValue;
    oldYearValue = newYearValue;

    console.log('fetching', { newMonthValue, newYearValue });

    docMeta.push({ month: newMonthValue, year: newYearValue });
    initFetchPromises.push(
      getPromiseObject(newMonthValue, newYearValue, conn.req.body.office)
    );
  }

  console.log('Num docs fetch', initFetchPromises.length);
  let toCancel = false;

  Promise
    .all(initFetchPromises)
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        const monthValue = docMeta[index].month;
        const yearValue = docMeta[index].year;

        const ref = (() => {
          if (snapShot.empty) {
            return rootCollections.inits.doc();
          }

          return snapShot.docs[0].ref;
        })();

        const payrollObject = (() => {
          if (snapShot.empty) {
            return {};
          }

          return snapShot.docs[0].get('payrollObject') || {};
        })();

        console.log({ ref: ref.path });
        console.log({ snapShotEmpty: snapShot.empty });
        console.log({ monthDatesMap });

        const updatedPayrollObject =
          getPayrollObject({
            month: monthValue,
            year: yearValue,
            phoneNumber: conn.requester.phoneNumber,
            requestBody: conn.req.body,
            payrollObject,
            monthDatesMap,
          });

        locals.batch.set(ref, {
          report: 'payroll',
          payrollObject: updatedPayrollObject.payrollObject,
          year: yearValue,
          month: monthValue,
          office: conn.req.body.office,
        }, {
            /** The doc may or may not exist. */
            merge: true,
          });

        /** Using an if block to handle this boolean case becase
         * there can be multiple iterations depending on the
         * duration of leave or on duty.
         * The dates may conflict on month 1, but not on month 2.
         * So, for handling that, we are setting the toCancel to
         * `true` if `datesConflict`.
         */
        if (updatedPayrollObject.datesConflicted) {
          toCancel = true;
        }
      });

      if (toCancel) {
        console.log('CANCELL HERE 2', 'toCancel');
        locals.static.statusOnCreate = 'CANCELLED';
        locals.cancellationMessage =
          `${conn.req.body.template.toUpperCase()} CANCELLED`;
      }

      console.log({ toCancel });

      createDocsWithBatch(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handlePayroll = (conn, locals) => {
  if (!new Set()
    .add(reportNames.LEAVE)
    .add(reportNames.TOUR_PLAN)
    .has(conn.req.body.template)) {
    createDocsWithBatch(conn, locals);

    return;
  }

  const startTime = conn.req.body.schedule[0].startTime;
  const endTime = conn.req.body.schedule[0].endTime;

  if (!startTime || !endTime) {
    createDocsWithBatch(conn, locals);

    return;
  }

  if (conn.req.body.template !== 'leave') {
    handleLeaveOrTourPlan(conn, locals);

    return;
  }

  const leaveType = conn.req.body.attachment['Leave Type'].value;
  const startMoment = momentTz(conn.req.body.schedule[0].startTime);
  const endMoment = momentTz(conn.req.body.schedule[0].endTime);
  locals.maxLeavesAllowed = 0;
  locals.leavesTakenThisYear = 0;

  Promise
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
    .then((result) => {
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

      console.log('leaveTypeSize', leaveActivityQuery.size);

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
        console.log('leavesTakenThisYear', locals.leavesTakenThisYear);
        console.log('maxLeavesAllowed', locals.maxLeavesAllowed);

        console.log('CANCELL HERE 3');
        locals.static.statusOnCreate = 'CANCELLED';
        locals.cancellationMessage = `${conn.req.body.template.toUpperCase()} CANCELLED`;

        createDocsWithBatch(conn, locals);

        return;
      }

      handleLeaveOrTourPlan(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handleAssignees = (conn, locals) => {
  if (locals.objects.allPhoneNumbers.size === 0) {
    sendResponse(
      conn,
      code.badRequest,
      `Cannot create an activity without any assignees. Please`
      + ` add some assignees for this activity using the 'share'`
      + ` array in the request body.`
    );

    return;
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

      /**
       * No docs will exist if the template is `office`
       * since this template itself is used to create
       * the office. No use of adding promises to the array.
       */
      if (conn.req.body.template === 'office') return;

      if (locals.static.canEditRule === 'ADMIN') {
        promises
          .push(rootCollections
            .offices.doc(locals.static.officeId)
            .collection('Activities')
            .where('attachment.Admin.value', '==', phoneNumber)
            .where('template', '==', 'admin')
            .limit(1)
            .get()
          );
      }

      if (locals.static.canEditRule === 'EMPLOYEE') {
        promises
          .push(rootCollections
            .offices.doc(locals.static.officeId)
            .collection('Activities')
            .where('attachment.Employee Contact.value', '==', phoneNumber)
            .where('template', '==', 'employee')
            .limit(1)
            .get()
          );
      }
    });

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        let phoneNumber;
        const doc = snapShot.docs[0];
        const template = doc.get('template');
        const isAdmin = template === 'admin';
        const isEmployee = template === 'employee';

        if (isAdmin) {
          phoneNumber = doc.get('attachment.Admin.value');
          locals.objects.permissions[phoneNumber].isAdmin = isAdmin;
        }

        if (isEmployee) {
          phoneNumber = doc.get('attachment.Employee Contact.value');
          locals.objects.permissions[phoneNumber].isEmployee = isEmployee;
        }
      });

      handlePayroll(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const resolveQuerySnapshotShouldNotExistPromises = (conn, locals, result) => {
  const promises = result.querySnapshotShouldNotExist;

  if (promises.length === 0) {
    handleAssignees(conn, locals);

    return;
  }

  Promise
    .all(promises)
    .then((snapShots) => {
      let successful = true;
      let message = null;

      for (const snapShot of snapShots) {
        const filters = snapShot._query._fieldFilters;
        const argOne = filters[0].value;
        const parentFieldName = filters[0].field.segments[1];

        if (!snapShot.empty) {
          successful = false;
          message = `The ${parentFieldName} '${argOne}' already is in use`;
          break;
        }
      }

      if (!successful) {
        sendResponse(conn, code.badRequest, message);

        return;
      }

      handleAssignees(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const resolveQuerySnapshotShouldExistPromises = (conn, locals, result) => {
  if (result.querySnapshotShouldExist.length === 0) {
    resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);

    return;
  }

  Promise
    .all(result.querySnapshotShouldExist)
    .then((snapShots) => {
      let successful = true;
      let message;

      for (const snapShot of snapShots) {
        const filters = snapShot._query._fieldFilters;
        const [
          argOne,
        ] = filters;

        message = `${argOne._value} does not exist`;

        if (snapShot.empty) {
          successful = false;
          break;
        }
      }

      if (!successful) {
        sendResponse(conn, code.badRequest, message);

        return;
      }

      resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const resolveProfileCheckPromises = (conn, locals, result) => {
  if (result.profileDocShouldExist.length === 0) {
    resolveQuerySnapshotShouldExistPromises(conn, locals, result);

    return;
  }

  Promise
    .all(result.profileDocShouldExist)
    .then((docs) => {
      let successful = true;
      let message = null;

      for (const doc of docs) {
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
        sendResponse(conn, code.badRequest, message);

        return;
      }

      resolveQuerySnapshotShouldExistPromises(conn, locals, result);

      return;
    })
    .catch((error) => handleError(conn, error));
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
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  const isSubscription = conn.req.body.template === 'subscription'
    && conn.req.body.attachment.Template.value;

  if (isSubscription
    && !templatesSet.has(conn.req.body.attachment.Template.value)) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.attachment.Template.value} doesn't exist`
    );

    return;
  }

  /**
   * All phone numbers in the attachment are added to the
   * activity assignees.
   */
  result
    .phoneNumbers
    .forEach((phoneNumber) => locals.objects.allPhoneNumbers.add(phoneNumber));

  resolveProfileCheckPromises(conn, locals, result);
};


const handleScheduleAndVenue = (conn, locals) => {
  const scheduleValidationResult =
    validateSchedules(conn.req.body, locals.objects.schedule);

  if (!scheduleValidationResult.isValid) {
    sendResponse(conn, code.badRequest, scheduleValidationResult.message);

    return;
  }

  locals.objects.scheduleArray = scheduleValidationResult.schedules;

  const venueValidationResult =
    validateVenues(conn.req.body, locals.objects.venue);

  if (!venueValidationResult.isValid) {
    sendResponse(conn, code.badRequest, venueValidationResult.message);

    return;
  }

  /**
   * Can't directly write the `conn.req.body.venue` to the activity root
   * because venue objects contain `Geopoint` object of Firebase.
   * We need to convert that from a normal `JS` Object for each venue.
   */
  locals.objects.venueArray = venueValidationResult.venues;

  handleAttachment(conn, locals);
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
    sendResponse(
      conn,
      code.forbidden,
      `No office found with the name: '${conn.req.body.office}'`
    );

    return;
  }

  if (subscriptionQueryResult.empty
    && !conn.requester.isSupportRequest) {
    sendResponse(
      conn,
      code.forbidden,
      `No subscription found for the template: '${conn.req.body.template}'`
      + ` with the office '${conn.req.body.office}'`
    );

    return;
  }

  if (!subscriptionQueryResult.empty) {
    if (subscriptionQueryResult.docs[0].get('status') === 'CANCELLED') {
      sendResponse(
        conn,
        code.forbidden,
        `Your subscription to the template '${conn.req.body.template}'`
        + ` is 'CANCELLED'.Cannot create an activity`
      );

      return;
    }

    /**
     * Default assignees for all the activities that the user
     * creates using the subscription mentioned in the request body.
     */
    subscriptionQueryResult
      .docs[0]
      .get('include')
      .forEach(
        (phoneNumber) => locals.objects.allPhoneNumbers.add(phoneNumber)
      );
  }

  if (!officeQueryResult.empty) {
    if (conn.req.body.template === 'office') {
      sendResponse(
        conn,
        code.conflict,
        `The office '${conn.req.body.office}' already exists`
      );

      return;
    }

    if (officeQueryResult.docs[0].get('status') === 'CANCELLED') {
      sendResponse(
        conn,
        code.forbidden,
        `The office status is 'CANCELLED'. Cannot create an activity`
      );

      return;
    }

    locals.static.officeId = officeQueryResult.docs[0].id;
    locals.officeDoc = officeQueryResult.docs[0];
  }

  conn.req.body.share.forEach((phoneNumber) => {
    locals.objects.allPhoneNumbers.add(phoneNumber);
  });

  if (!conn.requester.isSupportRequest) {
    locals.objects.schedule = subscriptionQueryResult.docs[0].get('schedule');
    locals.objects.venue = subscriptionQueryResult.docs[0].get('venue');
    locals.objects.attachment = subscriptionQueryResult.docs[0].get('attachment');
    locals.static.canEditRule = subscriptionQueryResult.docs[0].get('canEditRule');
    locals.static.statusOnCreate = subscriptionQueryResult.docs[0].get('statusOnCreate');
    locals.static.hidden = subscriptionQueryResult.docs[0].get('hidden');
  } else {
    if (templateQueryResult.empty) {
      sendResponse(
        conn,
        code.badRequest,
        `No template found with the name: '${conn.req.body.template}'`
      );

      return;
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

  handleScheduleAndVenue(conn, locals);
};


const fetchDocs = (conn) => {
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
  if (conn.requester.isSupportRequest) {
    promises
      .push(rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get()
      );
  }

  Promise
    .all(promises)
    .then((result) => createLocals(conn, result))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  if (conn.req.method !== 'POST') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the / create`
      + ' endpoint. Use POST'
    );

    return;
  }

  const bodyResult = isValidRequestBody(conn.req.body, httpsActions.create);

  if (!bodyResult.isValid) {
    sendResponse(conn, code.badRequest, bodyResult.message);

    return;
  }

  fetchDocs(conn);
};
