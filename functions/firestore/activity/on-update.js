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
const {
  httpsActions,
  reportNames,
} = require('../../admin/constants');
const {
  rootCollections,
  getGeopointObject,
  db,
} = require('../../admin/admin');
const {
  toCustomerObject,
  activityName,
  validateVenues,
  getCanEditValue,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
  checkActivityAndAssignee,
} = require('./helper');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const updateDocsWithBatch = (conn, locals) => {
  const activityRef = rootCollections
    .activities
    .doc(conn.req.body.activityId);
  const addendumDocRef = rootCollections
    .offices
    .doc(locals.docs.activity.get('officeId'))
    .collection('Addendum')
    .doc();

  const activityUpdateObject = {
    addendumDocRef,
    schedule: conn.req.body.schedule,
    venue: locals.objects.updatedFields.venue,
    timestamp: Date.now(),
    attachment: conn.req.body.attachment,
  };

  locals.nameFieldUpdated = locals.docs.activity.get('attachment').hasOwnProperty('Name')
    && locals.docs.activity.get('attachment.Name.value')
    !== conn.req.body.attachment.Name.value;

  const numberFieldUpdated =
    locals.docs.activity.get('attachment').hasOwnProperty('Number')
    && locals.docs.activity.get('attachment.Number.value')
    !== conn.req.body.attachment.Number.value;

  if (locals.nameFieldUpdated || numberFieldUpdated) {
    activityUpdateObject.activityName = activityName({
      attachmentObject: conn.req.body.attachment,
      templateName: locals.docs.activity.get('template'),
      requester: conn.requester,
    });
  }

  const now = new Date();

  locals
    .batch
    .set(addendumDocRef, {
      /**
       * Sequence matters here. The `activityUpdateObject` object contains updated values.
       * Priority is of the `activityUpdateObject`.
       */
      activityData: Object
        .assign({}, locals.docs.activity.data(), activityUpdateObject),
      timestamp: Date.now(),
      action: httpsActions.update,
      dateString: now.toDateString(),
      user: conn.requester.phoneNumber,
      activityId: conn.req.body.activityId,
      /**
       * Required by `addendumOnCreate` function to delete old data from
       * init docs and update it the case of new ones. e.g., schedule and venue.
       */
      activityOld: locals.docs.activity.data(),
      userDeviceTimestamp: conn.req.body.timestamp,
      template: locals.docs.activity.get('template'),
      isSupportRequest: conn.requester.isSupportRequest,
      location: getGeopointObject(conn.req.body.geopoint),
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      provider: conn.req.body.geopoint.provider || null,
    });

  Object
    .keys(locals.objects.permissions)
    .forEach((phoneNumber) => {
      const isRequester = conn.requester.phoneNumber === phoneNumber;
      let addToInclude = true;

      if (locals.static.template === 'subscription' && isRequester) {
        addToInclude = false;
      }

      locals.batch.set(activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
          canEdit: getCanEditValue(locals, phoneNumber),
          /**
           * These people are not from the `share` array of the request body.
           * The update api doesn't accept the `share` array.
           */
          addToInclude,
        });
    });

  locals
    .batch
    .set(activityRef, activityUpdateObject, {
      merge: true,
    });

  if (locals.docs.activity.get('template') !== 'customer') {
    locals
      .batch
      .commit()
      .then(() => sendResponse(conn, code.noContent))
      .catch((error) => handleError(conn, error));

    return;
  }

  rootCollections
    .offices
    .doc(locals.docs.activity.get('officeId'))
    .get()
    .then((doc) => {
      const customersData = doc.get('customersData') || {};

      customersData[conn.req.body.attachment.Name.value] = toCustomerObject(
        conn.req.body,
        locals.docs.activity.createTime.toDate().getTime(),
      );

      locals.batch.set(doc.ref, {
        customersData,
      }, {
          merge: true,
        });

      return locals.batch.commit();
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};

const getDisplayText = (conn, locals) => {
  let displayText = '';

  if (locals.docs.activity.get('template') === reportNames.LEAVE) {
    displayText = (() => {
      const leaveType =
        conn.req.body.attachment['Leave Type'].value;

      if (!leaveType) return `LEAVE`;

      return `LEAVE - ${leaveType}`;
    })();
  }

  if (locals.docs.activity.get('template') === reportNames.TOUR_PLAN) {
    displayText = 'ON DUTY';
  }

  return displayText;
};

const getPayrollObject = (conn, locals, initQuery) => {
  const NUM_MILLI_SECS_IN_DAY = 86400 * 1000;
  const displayText = getDisplayText(conn, locals);
  const payrollObject = (() => {
    if (!initQuery.empty) return {};

    return initQuery.docs[0].get('payrollObject') || {};
  })();

  if (!payrollObject[conn.requester.phoneNumber]) {
    payrollObject[conn.requester.phoneNumber] = {};
  }

  // conn.req.body.schedule.forEach((item) => {
  //   const dateNumber = new Date(item.startTime).getDate();
  //   payrollObject[conn.requester.phoneNumber][dateNumber] = displayText;
  // });

  conn.req.body.schedule.forEach((schedule) => {
    console.log('in schedule');

    let startTime = schedule.startTime;
    const endTime = schedule.endTime;
    console.log({ startTime, endTime });

    if (!startTime || !endTime) {
      return;
    }

    const endMonth = new Date(endTime).getMonth();
    const endYear = new Date(endTime).getFullYear();

    while (startTime <= endTime) {
      const date = new Date(startTime);
      const startMonth = date.getMonth();
      const startYear = date.getFullYear();

      if (startMonth !== endMonth) {
        console.log('return month');

        return;
      }
      if (startYear !== endYear) {
        console.log('return year');

        return;
      }

      payrollObject[conn.requester.phoneNumber][date.getDate()] = displayText;

      startTime += NUM_MILLI_SECS_IN_DAY;
    }
  });

  console.log({ payrollObject });

  return payrollObject;
};

const handlePayroll = (conn, locals) => {
  if (!new Set()
    .add(reportNames.LEAVE)
    .add(reportNames.CHECK_IN)
    .add(reportNames.TOUR_PLAN)
    .has(locals.docs.activity.get('template'))) {

    updateDocsWithBatch(conn, locals);

    return;
  }

  console.log('IN PAYROLL');

  const ts = (() => {
    if (locals.docs.activity.get('template') === reportNames.CHECK_IN) {
      return {
        month: new Date().getMonth(),
        year: new Date().getFullYear(),
      };
    }

    const schedule = conn.req.body.schedule[0];

    if (!schedule) {
      return {
        month: '',
        year: '',
      };
    }

    const startTime = schedule.startTime;

    if (!startTime) {
      return {
        month: '',
        year: '',
      };
    }

    return {
      month: new Date(startTime).getMonth(),
      year: new Date(startTime).getFullYear(),
    };
  })();

  if (!ts.month || !ts.year) {
    updateDocsWithBatch(conn, locals);

    return;
  }

  rootCollections
    .inits
    .where('office', '==', locals.docs.activity.get('office'))
    .where('report', '==', reportNames.PAYROLL)
    .where('month', '==', ts.month)
    .where('year', '==', ts.year)
    .limit(1)
    .get()
    .then((initQuery) => {
      const ref = (() => {
        if (initQuery.empty) {
          return rootCollections.inits.doc();
        }

        return initQuery.docs[0].ref;
      })();

      console.log(ref.path);

      locals.batch.set(ref, {
        office: conn.req.body.office,
        officeId: locals.static.officeId,
        month: ts.month,
        year: ts.year,
        report: reportNames.PAYROLL,
        payrollObject: getPayrollObject(conn, locals, initQuery),
      }, {
          merge: true,
        });

      updateDocsWithBatch(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};

const handleLeave = (conn, locals) => {
  if (locals.docs.activity.get('template') !== 'leave') {

    updateDocsWithBatch(conn, locals);

    return;
  }

  const newScheduleObject = conn.req.body.schedule[0];

  if (!newScheduleObject.startTime || newScheduleObject.endTime) {
    updateDocsWithBatch(conn, locals);

    return;
  }

  const startTimeNew = conn.req.body.schedule[0].startTime;
  const endTimeNew = conn.req.body.schedule[0].endTime;

  const startTimeOld = locals.docs.activity.get('schedule')[0].startTime;
  const endTimeOld = locals.docs.activity.get('schedule')[0].endTime;

  if (!startTimeNew || !endTimeNew) {
    updateDocsWithBatch(conn, locals);

    return;
  }

  // Adding `+1` to include the start day of the leave
  const leavesTakenOld =
    Math.ceil(Math.abs((endTimeNew - startTimeNew) / 86400000)) + 1;

  const leavesTakenNew =
    Math.ceil(Math.abs(endTimeNew - startTimeNew) / 86400000) + 1;

  if (leavesTakenOld === leavesTakenNew) {
    locals.annaualLeavesEntitled = '';
    locals.leavesRemaining = leavesTakenOld;
    locals.totalLeavesTaken = '';

    updateDocsWithBatch(conn, locals);

    return;
  }

  const leaveType = conn.req.body.attachment['Leave Type'].value;
  const officeId = locals.docs.activity.get('officeId');

  Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection('Activities')
        .where('template', '==', 'leave-type')
        .where('attachment.Name.value', '==', leaveType)
        .limit(1)
        .get(),
      rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .where('template', '==', 'leave')
        .where('activityData.attachment.Leave Type.value', '==', leaveType)
        .where('user', '==', conn.requester.phoneNumber)
        .where('year', '==', new Date().getFullYear())
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      // Not checking for the doc.exists, or result[0].empty because
      // leave-type's existance is certain when creating a leave;
      const annualLimit =
        result[0].docs[0].get('attachment.Annual Limit.value');

      locals.leavesBalance = (() => {
        if (result[1].empty) return annualLimit;

        return result[1].docs[0].get('leavesBalance') - leavesTakenOld;
      })();

      if (locals.leavesBalance < 0) {
        locals.static.statusOnCreate = 'CANCELLED';
      }

      locals
        .annaualLeavesEntitled =
        result[0]
          .docs[0]
          .get('attachment.Annual Limit.value');
      locals
        .leavesRemaining =
        result[1]
          .docs[0]
          .get('totalLeavesRemaining') - Math.round(leavesTakenOld - leavesTakenNew);

      locals.totalLeavesTaken = '';

      updateDocsWithBatch(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const getUpdatedFields = (conn, locals) => {
  const activitySchedule = locals.docs.activity.get('schedule');
  const activityVenue = locals.docs.activity.get('venue');

  const scheduleNames = [];
  activitySchedule.forEach((schedule) => scheduleNames.push(schedule.name));

  const scheduleValidationResult
    = validateSchedules(conn.req.body, scheduleNames);

  if (!scheduleValidationResult.isValid) {
    sendResponse(conn, code.badRequest, scheduleValidationResult.message);

    return;
  }

  const venueDescriptors = [];
  activityVenue
    .forEach((venue) => venueDescriptors.push(venue.venueDescriptor));

  const venueValidationResult
    = validateVenues(conn.req.body, venueDescriptors);

  if (!venueValidationResult.isValid) {
    sendResponse(conn, code.badRequest, venueValidationResult.message);

    return;
  }

  locals.objects.updatedFields.venue = venueValidationResult.venues;

  // handleLeave(conn, locals);

  updateDocsWithBatch(conn, locals);
  // handlePayroll(conn, locals);
};


const handleAssignees = (conn, locals) => {
  const bodyAttachmentFields = Object.keys(conn.req.body.attachment);
  const activityAttachment = locals.docs.activity.get('attachment');

  const promises = [];

  bodyAttachmentFields.forEach((field) => {
    const item = conn.req.body.attachment[field];
    const type = item.type;

    if (type !== 'phoneNumber') return;

    const newPhoneNumber = item.value;
    const oldPhoneNumber = activityAttachment[field].value;

    /** Nothing has changed, so no point in creating promises. */
    if (oldPhoneNumber === newPhoneNumber) return;

    /**
     * Number was removed so the person needs to be unassigned from
     * the activity.
     */
    if (oldPhoneNumber !== '' && newPhoneNumber === '') {
      locals.batch.delete(rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(oldPhoneNumber)
      );

      /**
       * New phone number is an empty string which is not a valid phone number
       * Not creating promises in that case.
       */
      return;
    }

    /**
     * The `newPhoneNumber` is not an empty `string`; it will be a valid
     * phone number since the attachment validation function checks that out.
     */
    if (oldPhoneNumber !== '' && newPhoneNumber !== '') {
      locals.batch.delete(rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(oldPhoneNumber)
      );
    }

    const isRequester = newPhoneNumber === conn.requester.phoneNumber;

    locals.objects.permissions[newPhoneNumber] = {
      isAdmin: false,
      isEmployee: false,
      isCreator: isRequester,
    };

    if (locals.static.canEditRule === 'EMPLOYEE') {
      promises.push(rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection('Activities')
        .where('attachment.Employee Contact.value', '==', newPhoneNumber)
        .where('template', '==', 'employee')
        .limit(1)
        .get()
      );
    }

    if (locals.static.canEditRule === 'ADMIN') {
      promises.push(rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection('Activities')
        .where('attachment.Admin.value', '==', newPhoneNumber)
        .where('template', '==', 'admin')
        .limit(1)
        .get()
      );
    }
  });

  if (new Set()
    .add('department')
    .add('branch')
    .has(locals.static.template)
    && conn.req.body.attachment.Name.value
    !== locals.docs.activity.get('attachment').Name.value) {
    sendResponse(
      conn,
      code.conflict,
      `The ${locals.static.template} name cannot be edited.`
    );

    return;
  }

  if (locals.static.template === 'employee'
    && locals.docs.activity.get('attachment.Employee Contact.value')
    !== conn.req.body.attachment['Employee Contact'].value) {
    sendResponse(
      conn,
      code.conflict,
      `Phone numbers cannot be updated for the template:`
      + ` ${locals.static.template}`
    );

    return;
  }


  /**
   * These templates aren't allowed to be updated from the client-side app.
   * Updating these phone numbers is done via the admin panel.
   */
  if (new Set()
    .add('subscription')
    .add('admin')
    .has(locals.static.template)) {
    sendResponse(
      conn,
      code.conflict,
      `Phone numbers cannot be updated for the template:`
      + ` ${locals.static.template}`
    );

    return;
  }

  if (promises.length === 0) {
    getUpdatedFields(conn, locals);

    return;
  }

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        let phoneNumber;
        const template = doc.get('template');

        const isAdmin = template === 'admin';

        if (isAdmin) {
          phoneNumber = doc.get('attachment.Admin.value');
          locals.objects.permissions[phoneNumber].isAdmin = isAdmin;
        }

        const isEmployee = template === 'employee';

        if (isEmployee) {
          phoneNumber = doc.get('attachment.Employee Contact.value');
          locals.objects.permissions[phoneNumber].isEmployee = isEmployee;
        }
      });

      getUpdatedFields(conn, locals);

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

  /**
   * No need to query for the `Name` to be unique since that check
   * has already been performed while creating an activity. Of course,
   * only when the Name.value hasn't changed.
   */
  if (locals.docs.activity.get('attachment').hasOwnProperty('Name')
    && locals.docs.activity.get('attachment').Name.value
    === conn.req.body.attachment.Name.value) {
    handleAssignees(conn, locals);

    return;
  }

  if (locals.docs.activity.get('attachment').hasOwnProperty('Number')
    && locals.docs.activity.get('attachment').Number.value
    === conn.req.body.attachment.Number.value) {
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

        if (!snapShot.empty) {
          successful = false;
          message = `The value ${argOne} is already in use`;
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
  const promises = result.querySnapshotShouldExist;

  if (promises.length === 0) {
    resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);

    return;
  }

  Promise
    .all(promises)
    .then((snapShots) => {
      let successful = true;
      let message;

      for (const snapShot of snapShots) {
        const filters = snapShot._query._fieldFilters;
        const argOne = filters[0]._value;
        let argTwo;

        message = `No template found with the name: ${argOne} from`
          + ` the attachment.`;

        if (locals.static.template !== 'subscription') {
          argTwo = filters[1]._value;
          message = `The ${argOne} ${argTwo} does not exist in`
            + ` the office: ${locals.static.office}.`;
        }

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
  const promises = result.profileDocShouldExist;

  if (promises.length === 0) {
    resolveQuerySnapshotShouldExistPromises(conn, locals, result);

    return;
  }

  Promise
    .all(promises)
    .then((docs) => {
      let successful = true;
      let message = null;

      for (const doc of docs) {
        message = `No user found with the phone number:`
          + ` ${doc.id} from the attachment.`;

        if (!doc.exists) {
          successful = false;
          break;
        }

        /** A doc in `/Profiles` can exist for a user even when
         * they haven't actually done the `OTP`.
         *
         * This is because when a new phone number is introduced
         * to the system, the activity Activity `onWrite` function
         * creates their `Profile` regardless.
         *
         * To counter that, we actually check the value of the field
         * `uid` in the `Profile` doc. For all the numbers introduced
         * automatically and not by using the `OTP`, the uid will be `null`.
         */
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
  const result = filterAttachment({
    bodyAttachment: conn.req.body.attachment,
    templateAttachment: locals.docs.activity.get('attachment'),
    template: locals.docs.activity.get('template'),
    officeId: locals.docs.activity.get('officeId'),
    office: locals.docs.activity.get('office'),
  });

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  /**
   * Changing the name of an office will render all the activities
   * of that office useless since we are currently not updating
   * the office name in the respective activities.
   */
  if (conn.req.body.template === 'office'
    && conn.req.body.attachment.Name.value !== locals.static.office) {
    sendResponse(
      conn,
      code.conflict,
      `Updating the 'Name' of an 'Office' is not allowed.`
    );

    return;
  }

  if (result.querySnapshotShouldExist.length === 0
    && result.querySnapshotShouldNotExist.length === 0
    && result.profileDocShouldExist.length === 0) {
    handleAssignees(conn, locals);

    return;
  }

  resolveProfileCheckPromises(conn, locals, result);
};


const handleResult = (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  const [
    activity,
  ] = docs;

  const locals = {
    batch: db.batch(),
    objects: {
      updatedFields: {
        timestamp: Date.now(),
      },
      permissions: {},
      attachment: activity.get('attachment'),
    },
    docs: {
      activity,
    },
    static: {
      officeId: activity.get('officeId'),
      canEditRule: activity.get('canEditRule'),
      template: activity.get('template'),
      office: activity.get('office'),
    },
  };

  handleAttachment(conn, locals);
};


module.exports = (conn) => {
  if (conn.req.method !== 'PATCH') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /update endpoint.`
      + ` Use PATCH.`
    );

    return;
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.update);

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  Promise
    .all([
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(conn.requester.phoneNumber)
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};
