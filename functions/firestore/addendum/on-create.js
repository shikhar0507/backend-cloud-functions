'use strict';


const {
  db,
  rootCollections,
  deleteField,
} = require('../../admin/admin');

const {
  httpsActions,
  reportNames,
} = require('../../admin/constants');
const {
  toMapsUrl,
  momentOffsetObject,
} = require('../recipients/report-utils');

const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: require('../../admin/env').mapsApiKey,
      Promise: Promise,
    });

const initDocRef = (snapShot) => {
  if (snapShot.empty) return rootCollections.inits.doc();

  return snapShot.docs[0].ref;
};

const getLatLngString = (location) =>
  `${location._latitude},${location._longitude}`;

const getLocationUrl = (plusCode) => `https://plus.codes/${plusCode}`;

const getPlaceInformation = (mapsApiResult, geopoint) => {
  const value = toMapsUrl(geopoint);

  if (!mapsApiResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const firstResult = mapsApiResult.json.results[0];

  if (!firstResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const addressComponents = firstResult['address_components'];

  let identifier = '';

  addressComponents.forEach((component) => {
    const longName = component['long_name'];
    const types = component.types;

    if (!types.includes('political')) return;

    if (types.includes('sublocality')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('locality')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('administrative_area_level_2')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('administrative_area_level_1')) {
      identifier += ` ${longName} `;
    }
  });

  const plusCode = mapsApiResult.json['plus_code']['global_code'];

  return {
    identifier: identifier.trim(),
    url: getLocationUrl(plusCode),
  };
};


const getDisplayText = (addendumDoc) => {
  let displayText = '';
  const status = addendumDoc.get('activityData.status');
  const template = addendumDoc.get('activityData.template');

  if (status === 'CANCELLED') {
    return deleteField();
  }

  if (template === 'leave') {
    displayText = (() => {
      const leaveType =
        addendumDoc.get('activityData.attachment.Leave Type.value');

      if (leaveType) return `LEAVE - ${leaveType}`;

      return `LEAVE`;
    })();
  }

  if (template === 'tour plan') {
    displayText = 'ON DUTY';
  }

  return displayText;
};


const getPayrollObject = (addendumDoc, initQuery) => {
  const NUM_MILLI_SECS_IN_DAY = 86400 * 1000;
  const initDoc = initQuery.docs[0];
  const displayText = getDisplayText(addendumDoc);
  const phoneNumber = addendumDoc.get('user');
  const schedulesArray = addendumDoc.get('activityData.schedule');

  console.log({ displayText });

  const payrollObject = (() => {
    if (!initDoc) return {};

    return initDoc.get('payrollObject') || {};
  })();

  if (!payrollObject[phoneNumber]) {
    payrollObject[phoneNumber] = {};
  }

  const shouldBreak = (datesObject) => {
    const {
      startMonth,
      endMonth,
      startYear,
      endYear,
    } = datesObject;

    return startMonth !== endMonth
      || startYear || endYear;
  };

  if (addendumDoc.get('action') === httpsActions.update) {
    const oldSchedulesArray = addendumDoc.get('activityOld.schedule');

    oldSchedulesArray.forEach((schedule) => {
      let startTime = schedule.startTime;
      const endTime = schedule.endTime;

      if (!startTime || !endTime) return;
      // const startTimeValue = new Date(startTime).getMonth();

      const endMonth = new Date(endTime).getMonth();
      const endYear = new Date(endTime).getFullYear();

      while (startTime <= endTime) {
        const date = new Date(startTime);

        // Not breaking the loop will overwrite the current
        // month's data.
        if (shouldBreak({
          startMonth: date.getMonth(),
          startYear: date.getFullYear(),
          endMonth,
          endYear,
        })) {
          return;
        }

        payrollObject[phoneNumber][date.getDate()] = deleteField();

        startTime += NUM_MILLI_SECS_IN_DAY;
      }
    });
  }

  schedulesArray.forEach((schedule) => {
    let startTime = schedule.startTime;
    const endTime = schedule.endTime;

    if (!startTime || !endTime) return;

    const endMonth = new Date(endTime).getMonth();
    const endYear = new Date(endTime).getFullYear();

    while (startTime <= endTime) {
      const date = new Date(startTime);

      // Not breaking the loop will overwrite the current 
      // month's data
      if (shouldBreak({
        startMonth: date.getMonth(),
        startYear: date.getFullYear(),
        endMonth,
        endYear,
      })) {
        return;
      }

      payrollObject[phoneNumber][date.getDate()] = displayText;
      console.log(date.getDate(), displayText);

      startTime += NUM_MILLI_SECS_IN_DAY;
    }
  });

  const nonEmptyItemsArray
    = Object
      .keys(payrollObject[phoneNumber])
      .filter((item) => item !== '');

  if (addendumDoc.get('action') === httpsActions.changeStatus
    && addendumDoc.get('activityData.status') === 'CANCELLED') {
    schedulesArray.forEach((schedule) => {
      let startTime = schedule.startTime;
      const endTime = schedule.endTime;

      if (!startTime || !endTime) return;

      const endMonth = new Date(endTime).getMonth();
      const endYear = new Date(endTime).getFullYear();

      while (startTime <= endTime) {
        const date = new Date(startTime);

        if (shouldBreak({
          startMonth: date.getMonth(),
          startYear: date.getFullYear(),
          endMonth,
          endYear,
        })) {
          return;
        }

        /** Leave CANCELLED, so not reflecting that in the final payroll report */
        payrollObject[phoneNumber][date] = deleteField();

        startTime += NUM_MILLI_SECS_IN_DAY;
      }
    });
  }

  /**
   * When the whole object contains empty string, the recipients onUpdate
   * should query the addendumDocs for this user's day activity. Leaving this field
   * here even when it is filled with objects will make the Recipients onUpdate
   * function to skip this user.
   */
  if (nonEmptyItemsArray.length === 0) {
    payrollObject[phoneNumber] = deleteField();
  }

  console.log({ payrollObject });

  return payrollObject;
};


const getVisitObject = (addendumDoc, initQuery, locals) => {
  const visitObject = (() => {
    if (initQuery.empty) return {};

    return initQuery
      .docs[0]
      .get('visitObject');
  })();
  const activityData = addendumDoc.get('activityData');
  const [
    visitDateSchedule,
    followUpDateSchedule,
  ] = activityData.schedule;
  const activityId = addendumDoc.get('activityId');
  const template = addendumDoc.get('activityData.template');
  const dataObject = (() => {
    if (template === 'tour plan') {
      return {
        firstContact: '',
        secondContact: '',
        product1: '',
        product2: '',
        product3: '',
      };
    }

    return {
      firstContact: activityData.attachment['First Contact'].value,
      secondContact: activityData.attachment['Second Contact'].value,
      product1: activityData.attachment['Product 1'].value,
      product2: activityData.attachment['Product 2'].value,
      product3: activityData.attachment['Product 3'].value,
    };
  })();

  if (!visitObject[activityId]) {
    visitObject[activityId] = {};
  }

  if (visitDateSchedule.startTime) {
    visitObject[activityId] = {
      firstContact: dataObject.firstContact,
      secondContact: dataObject.secondContact,
      purpose: addendumDoc.get('activityData.template'),
      phoneNumber: addendumDoc.get('user'),
      visitStartTimestamp: visitDateSchedule.startTime,
      visitEndTimestamp: visitDateSchedule.endTime,
      customer: activityData.attachment.Customer.value,
      product1: dataObject.product1,
      product2: dataObject.product2,
      product3: dataObject.product3,
      comment: activityData.attachment.Comment.value,
      actualLocation: locals.placeInformation,
    };

    if (template === 'dsr') {
      visitObject[activityId].followUpStartTimestamp =
        followUpDateSchedule.startTime;
      visitObject[activityId].followUpEndTimestamp =
        followUpDateSchedule.endTime;
    }
  }

  console.log({ visitObject });

  return visitObject;
};

const getFollowUpObject = (addendumDoc, initQuery) => {
  const followUpObject = (() => {
    if (initQuery.empty) return {};

    return initQuery
      .docs[0]
      .get('followUpObject');
  })();

  const activityId = addendumDoc.get('activityId');
  const activityData = addendumDoc.get('activityData');
  const [
    visitDateSchedule,
    followUpDateSchedule,
    closureDateSchedule,
  ] = activityData.schedule;
  const visitType = (() => {
    if (closureDateSchedule.startTime) {
      return 'Closure';
    }

    return 'Follow-Up';
  })();

  if (followUpDateSchedule.startTime || closureDateSchedule.startTime) {
    followUpObject[activityId] = {
      visitType,
      visitStartTime: visitDateSchedule.startTime,
      phoneNumber: addendumDoc.get('user'),
      followUpStartTimestamp: followUpDateSchedule.startTime,
      followUpEndTimestamp: followUpDateSchedule.endTime,
      customer: activityData.attachment.Customer.value,
      firstContact: activityData.attachment['First Contact'].value,
      secondContact: activityData.attachment['Second Contact'].value,
      product1: activityData.attachment['Product 1'].value,
      product2: activityData.attachment['Product 2'].value,
      product3: activityData.attachment['Product 3'].value,
      closureStartTimestamp: closureDateSchedule.startTime,
      closureEndTimestamp: closureDateSchedule.endTime,
      comment: activityData.attachment.Comment.value,
      purpose: addendumDoc.get('activityData.template'),
      actualLocation: '',
    };
  }

  console.log({ followUpObject });

  return followUpObject;
};


const getDutyRosterObject = (addendumDoc, initQuery, locals) => {
  const dutyRosterObject = (() => {
    if (initQuery.empty) return {};

    return initQuery.docs[0].get('dutyRosterObject');
  })();

  const action = addendumDoc.get('action');
  const status = addendumDoc.get('activityData.status');
  const schedule = addendumDoc.get('activityData.schedule')[0];
  const venue = addendumDoc.get('activityData.venue')[0];
  const activityId = addendumDoc.get('activityId');
  const description = addendumDoc.get('activityData.attachment.Description.value');

  if (!dutyRosterObject[activityId]) {
    dutyRosterObject[activityId] = {};
  }

  dutyRosterObject[activityId].status = status;
  // Not changing the dutyType to Name, because old data will become incompatible
  dutyRosterObject[activityId].dutyType =
    addendumDoc.get('activityData.attachment.Name.value')
    || addendumDoc.get('activityData.attachment.Duty Type.value');
  dutyRosterObject[activityId].description = description;
  dutyRosterObject[activityId].reportingLocation = venue.address;
  dutyRosterObject[activityId].reportingLocationGeopoint = venue.geopoint;
  dutyRosterObject[activityId].reportingTimeStart = schedule.startTime;
  dutyRosterObject[activityId].reportingTimeEnd = schedule.endTime;

  if (action === httpsActions.create) {
    dutyRosterObject[activityId].createdBy = addendumDoc.get('user');
    dutyRosterObject[activityId].createdOn = addendumDoc.get('timestamp');
    /** 
     * Default is empty string because unless someone updates the activity
     * status to `CONFIRMED` or `CANCELLED` 
     */
    dutyRosterObject[activityId].place = {
      identifier: '',
      url: '',
    };
  }

  if (action === httpsActions.changeStatus) {
    if (status === 'CONFIRMED') {
      dutyRosterObject[activityId].when = addendumDoc.get('timestamp');
      dutyRosterObject[activityId].user = addendumDoc.get('user');
      dutyRosterObject[activityId].place = locals.placeInformation;
    } else {
      dutyRosterObject[activityId].when = '';
      dutyRosterObject[activityId].user = '';
      dutyRosterObject[activityId].place = '';
    }
  }

  console.log({ dutyRosterObject });

  return dutyRosterObject;
};


const getExpenseClaimObject = (addendumDoc, initQuery, locals) => {
  const expenseClaimObject = (() => {
    if (initQuery.empty) return {};

    return initQuery.docs[0].get('expenseClaimObject');
  })();

  const action = addendumDoc.get('action');
  const activityData = addendumDoc.get('activityData');
  const activityId = addendumDoc.get('activityId');

  if (!expenseClaimObject[activityId]) {
    expenseClaimObject[activityId] = {};
  }

  expenseClaimObject[activityId] = {
    amount: activityData.attachment.Amount.value,
    status: activityData.status,
    expenseType: activityData.attachment['Expense Type'].value,
    reason: activityData.attachment.Reason.value,
    referenceNumber: activityData.attachment['Reference Number'].value,
    confirmedAt: '',
    confirmedBy: '',
    confirmedOn: '',
    user: '',
    expenseDateStartTime: '',
    expenseLocation: '',
  };

  if (action === httpsActions.create) {
    expenseClaimObject[activityId].phoneNumber = addendumDoc.get('user');
    expenseClaimObject[activityId].expenseDateStartTime = addendumDoc.get('timestamp');
    expenseClaimObject[activityId].expenseLocation = locals.placeInformation;
  }

  if (action === httpsActions.changeStatus) {
    if (activityData.status === 'CONFIRMED') {
      expenseClaimObject[activityId].confirmedBy = addendumDoc.get('user');
      expenseClaimObject[activityId].confirmedOn = addendumDoc.get('timestamp');
      expenseClaimObject[activityId].confirmedAt = locals.placeInformation;
    } else {
      // `PENDING` or `CONFIRMED`
      expenseClaimObject[activityId].confirmedBy = '';
      expenseClaimObject[activityId].confirmedOn = '';
      expenseClaimObject[activityId].confirmedAt = '';

    }
  }

  console.log({ expenseClaimObject });

  return expenseClaimObject;
};


const handleExpenseClaimReport = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== reportNames.EXPENSE_CLAIM) {
    return Promise.resolve();
  }

  if (addendumDoc.get('action') === httpsActions.comment) {
    return Promise.resolve();
  }

  const timestamp = addendumDoc.get('timestamp');
  const month = new Date(timestamp).getMonth();
  const year = new Date(timestamp).getFullYear();

  return rootCollections
    .inits
    .where('report', '==', reportNames.EXPENSE_CLAIM)
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((expenseClaimInitDocsQuery) => {
      const ref = initDocRef(expenseClaimInitDocsQuery);

      console.log('Ref:', ref.path);

      locals.batch.set(ref, {
        month,
        year,
        expenseClaimObject:
          getExpenseClaimObject(addendumDoc, expenseClaimInitDocsQuery, locals),
        report: reportNames.EXPENSE_CLAIM,
        office: addendumDoc.get('activityData.office'),
        officeId: addendumDoc.get('activityData.officeId'),
      }, {
          merge: true,
        });

      return Promise.resolve();
    })
    .catch(console.error);
};

const getLeaveObject = (addendumDoc, leaveInitDocsQuery) => {
  const leaveObject = (() => {
    if (leaveInitDocsQuery.empty) return {};

    return leaveInitDocsQuery.docs[0].get('leaveObject');
  })();

  const activityId = addendumDoc.get('activityId');
  const status = addendumDoc.get('activityData.status');
  const action = addendumDoc.get('action');

  if (leaveObject[activityId]) {
    leaveObject[activityId] = {};
  }

  if (action === httpsActions.changeStatus && status === 'CANCELLED') {
    leaveObject[activityId] = deleteField();

    return leaveObject;
  }

  if (action === httpsActions.create || action === httpsActions.update) {
    leaveObject[activityId] = {
      approvedBy: '',
      reason: addendumDoc.get('activityData.attachment.Reason.value'),
      leaveType: addendumDoc.get('activityData.attachment.Leave Type.value'),
      totalLeavesRemaining: addendumDoc.get('totalLeavesRemaining') || '',
      totalLeavesTaken: addendumDoc.get('totalLeavesTaken') || '',
      leaveStartTimestamp: addendumDoc.get('activityData.schedule')[0].startTime,
      leaveEndTimestamp: addendumDoc.get('activityData.schedule')[0].endTime,
      annualLeavesEntitled: addendumDoc.get('annualLeavesEntitled') || '',
    };
  }

  if (action === httpsActions.create) {
    leaveObject[activityId].phoneNumber = addendumDoc.get('user');
  }

  if (action === httpsActions.changeStatus && status === 'CONFIRMED') {
    leaveObject[activityId].approvedBy = addendumDoc.get('user');
  }

  console.log({ leaveObject });

  return leaveObject;
};


const handleLeaveReport = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== 'leave') {
    return Promise.resolve();
  }

  const leaveDatesSchedule = addendumDoc.get('activityData.schedule')[0];

  if (!leaveDatesSchedule.startTime || !leaveDatesSchedule.endTime) {
    return Promise.resolve();
  }

  if (!addendumDoc.get('activityData.attachment.Leave Type.value')) {
    return Promise.resolve();
  }

  const leaveDateStartTimestamp = new Date(leaveDatesSchedule.startTime);
  const leaveMonth = leaveDateStartTimestamp.getMonth();
  const leaveYear = leaveDateStartTimestamp.getFullYear();

  return rootCollections
    .inits
    .where('report', '==', reportNames.LEAVE)
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('year', '==', leaveYear)
    .where('month', '==', leaveMonth)
    .limit(1)
    .get()
    .then((leaveInitDocsQuery) => {
      const ref = initDocRef(leaveInitDocsQuery);

      return ref.set({
        office: addendumDoc.get('activityData.office'),
        report: reportNames.LEAVE,
        month: leaveMonth,
        year: leaveYear,
        leaveObject: getLeaveObject(addendumDoc, leaveInitDocsQuery),
      }, {
          merge: true,
        });
    })
    .catch(console.error);
};


const handleDutyRosterReport = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== 'duty roster') {
    return Promise.resolve();
  }

  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');

  const startTime = addendumDoc.get('activityData.schedule')[0].startTime;
  const endTime = addendumDoc.get('activityData.schedule')[0].endTime;

  if (!startTime || !endTime) {
    return Promise.resolve();
  }

  const date = new Date(startTime);
  const month = date.getMonth();
  const year = date.getFullYear();

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', reportNames.DUTY_ROSTER)
        .where('office', '==', office)
        .where('month', '==', month)
        .where('year', '==', year)
        .limit(1)
        .get(),
      rootCollections
        .activities
        .doc(addendumDoc.get('activityId'))
        .collection('Assignees')
        .get(),
    ])
    .then((result) => {
      const [
        dutyRosterInitDocsQuery,
        assigneesSnapshot,
      ] = result;

      const ref = initDocRef(dutyRosterInitDocsQuery);
      const dutyRosterObject
        = getDutyRosterObject(addendumDoc, dutyRosterInitDocsQuery, locals);
      const activityId = addendumDoc.get('activityId');

      dutyRosterObject[activityId]
        .assignees = assigneesSnapshot.docs.map((doc) => doc.id);

      locals.batch.set(ref, {
        month,
        year,
        office,
        officeId,
        dutyRosterObject,
        report: reportNames.DUTY_ROSTER,
      }, {
          merge: true,
        });

      return Promise.resolve();
    })
    .catch(console.error);
};

const handleVisitDate = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== reportNames.DSR
    && addendumDoc.get('activityData.template') !== reportNames.TOUR_PLAN
    || !addendumDoc.get('activityData.schedule')[0]) {
    console.log('In handleVisitDate: resolving early');

    return Promise.resolve();
  }

  const visitStartSchedule = addendumDoc.get('activityData.schedule')[0];
  const visitDayStartTimestamp = new Date(visitStartSchedule.startTime);
  const date = visitDayStartTimestamp.getDate();
  const month = visitDayStartTimestamp.getMonth();
  const year = visitDayStartTimestamp.getFullYear();

  return rootCollections
    .inits
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('report', '==', reportNames.DSR)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((snapShot) => {
      const ref = initDocRef(snapShot);

      const docData = {
        date,
        month,
        year,
        report: reportNames.DSR,
        office: addendumDoc.get('activityData.office'),
        officeId: addendumDoc.get('activityData.officeId'),
        visitObject: getVisitObject(addendumDoc, snapShot, locals),
      };

      if (snapShot.empty) {
        docData.followUpObject = {};
      }

      console.log('visit:', ref.path);

      return ref.set(docData, { merge: true });
    })
    .catch(console.error);
};


const handleFollowUpDate = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== reportNames.DSR
    || !addendumDoc.get('activityData.schedule')[1]) {
    console.log('resolving early follow up');

    return Promise.resolve();
  }

  const followUpSchedule = addendumDoc.get('activityData.schedule')[1];
  const followUpStartTimestamp = new Date(followUpSchedule.startTime);
  const date = followUpStartTimestamp.getDate();
  const month = followUpStartTimestamp.getMonth();
  const year = followUpStartTimestamp.getFullYear();

  return rootCollections
    .inits
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('report', '==', reportNames.DSR)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((snapShot) => {
      const ref = initDocRef(snapShot);

      const docData = {
        date,
        month,
        year,
        report: reportNames.DSR,
        office: addendumDoc.get('activityData.office'),
        officeId: addendumDoc.get('activityData.officeId'),
        followUpObject: getFollowUpObject(addendumDoc, snapShot),
      };

      if (snapShot.empty) docData.visitObject = {};

      console.log('follow up:', ref.path);

      return ref.set(docData, { merge: true });
    })
    .catch(console.error);
};


const handleDsr = (addendumDoc, locals) => {
  if (!new Set()
    .add(reportNames.DSR)
    .add(reportNames.TOUR_PLAN)
    .has(addendumDoc.get('activityData.template'))) {
    return Promise.resolve();
  }

  return handleVisitDate(addendumDoc, locals)
    .then(() => handleFollowUpDate(addendumDoc, locals))
    .catch(console.error);
};


const handlePayrollReport = (addendumDoc, locals) => {
  const template = addendumDoc.get('activityData.template');

  console.log('In payroll report', template);

  if (!new Set()
    .add(reportNames.LEAVE)
    .add(reportNames.CHECK_IN)
    .add(reportNames.TOUR_PLAN)
    .has(template)) {
    return Promise.resolve();
  }

  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');
  const timestamp = new Date(addendumDoc.get('timestamp'));
  const month = (() => {
    if (template === reportNames.CHECK_IN) {
      return timestamp.getMonth();
    }

    const schedule = addendumDoc.get('activityData.schedule')[0];

    if (!schedule) return '';

    const startTime = addendumDoc.get('activityData.schedule')[0].startTime;

    if (!startTime) return '';

    return new Date(startTime).getMonth();
  })();

  const year = (() => {
    if (template === reportNames.CHECK_IN) {
      return timestamp.getFullYear();
    }

    const schedule = addendumDoc.get('activityData.schedule')[0];
    if (!schedule) return '';

    const startTime = addendumDoc.get('activityData.schedule')[0].startTime;
    if (!startTime) return '';

    return new Date(startTime).getFullYear();
  })();

  if (!month || !year) {
    return Promise.resolve();
  }

  console.log({ month, year });

  return rootCollections
    .inits
    .where('office', '==', office)
    .where('report', '==', reportNames.PAYROLL)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((initQuery) => {
      const ref = initDocRef(initQuery);

      console.log('path:', ref.path);

      locals.batch.set(ref, {
        office,
        officeId,
        month,
        year,
        report: reportNames.PAYROLL,
        payrollObject: getPayrollObject(addendumDoc, initQuery),
      }, {
          merge: true,
        });

      return Promise.resolve();
    })
    .catch(console.error);
};


module.exports = (addendumDoc) => {
  const phoneNumber = addendumDoc.get('user');
  const officeId = addendumDoc.get('activityData.officeId');
  const locals = {
    batch: db.batch(),
  };

  return rootCollections
    .offices
    .doc(addendumDoc.get('activityData.officeId'))
    .get()
    .then((officeDoc) => {
      const timezone = officeDoc.get('attachment.Timezone.value');
      console.log({ timezone });

      const momentDateObject = momentOffsetObject(timezone);
      console.log({ momentDateObject });

      return rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .where('user', '==', phoneNumber)
        .where('date', '==', momentDateObject.today.DATE_NUMBER)
        .where('month', '==', momentDateObject.today.MONTH_NUMBER)
        .where('year', '==', momentDateObject.today.YEAR)
        .orderBy('timestamp', 'desc')
        .limit(2)
        .get();
    })
    .then((docs) => {
      console.log('size', docs.size);

      locals
        .previousAddendumDoc = (() => {
          if (docs.docs[0] && docs.docs[0].id !== addendumDoc.id) {
            return docs.docs[0];
          }

          return docs.docs[1];
        })();

      const promises = [
        googleMapsClient
          .reverseGeocode({
            latlng: getLatLngString(addendumDoc.get('location')),
          })
          .asPromise(),
      ];

      if (locals.previousAddendumDoc) {
        promises.push(googleMapsClient
          .distanceMatrix({
            origins: getLatLngString(locals.previousAddendumDoc.get('location')),
            destinations: getLatLngString(addendumDoc.get('location')),
            units: 'metric',
          })
          .asPromise());
      }

      return Promise.all(promises);
    })
    .then((result) => {
      const [
        mapsApiResult,
        distanceMatrixApiResult,
      ] = result;

      locals.placeInformation = getPlaceInformation(
        mapsApiResult,
        addendumDoc.get('location')
      );

      const distanceData = (() => {
        if (!locals.previousAddendumDoc) {
          return {
            accumulatedDistance: 0,
            distanceTravelled: 0,
          };
        }

        const value =
          distanceMatrixApiResult
            .json
            .rows[0]
            .elements[0]
            .distance
            .value;

        console.log({ value });

        const accumulatedDistance =
          Number(locals.previousAddendumDoc.get('accumulatedDistance') || 0)
          // value is in meters
          + value / 1000;

        return {
          accumulatedDistance: accumulatedDistance.toFixed(2),
          distanceTravelled: 0,
        };
      })();

      const updateObject = {
        url: locals.placeInformation.url,
        identifier: locals.placeInformation.identifier,
        accumulatedDistance: distanceData.accumulatedDistance,
        distanceTravelled: distanceData.distanceTravelled,
      };

      console.log({
        phoneNumber,
        updateObject,
        placeInformation: locals.placeInformation,
        currPath: addendumDoc.ref.path,
        prevPath:
          locals.previousAddendumDoc ? locals
            .previousAddendumDoc
            .ref
            .path : null,
      });

      locals.batch.set(addendumDoc.ref, updateObject, {
        merge: true,
      });

      // return handlePayrollReport(addendumDoc, locals);
      return;
    })
    .then(() => handleDsr(addendumDoc, locals))
    .then(() => handleDutyRosterReport(addendumDoc, locals))
    .then(() => handleLeaveReport(addendumDoc, locals))
    .then(() => handleExpenseClaimReport(addendumDoc, locals))
    .then(() => locals.batch.commit())
    .catch((error) => {
      console.error(error);

      const instantDocRef = rootCollections.instant.doc();
      console.log('crash id:', instantDocRef.id);

      const context = {
        // error,
        addendumId: addendumDoc.id,
        doc: addendumDoc.data(),
        instantDocId: instantDocRef.id,
      };

      return instantDocRef
        .set({
          subject: `${process.env.FUNCTION_NAME}`
            + ` Crash ${process.env.GCLOUD_PROJECT}`,
          messageBody: JSON.stringify(context, ' ', 2),
        });
    });
};
