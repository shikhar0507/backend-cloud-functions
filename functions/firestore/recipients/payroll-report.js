'use strict';


const {
  getNumbersbetween,
} = require('../../admin/utils');
const {
  subcollectionNames,
  dateFormats,
  reportNames,
} = require('../../admin/constants');
const {
  alphabetsArray,
} = require('./report-utils');
const admin = require('firebase-admin');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');

/**
 * Object which stores employee data for creating excel sheet entries
 * with employee contact, base location, region, department, etc.
 */
const employeeData = new Map();
const weeklyOffCountMap = new Map();
const holidayCountMap = new Map();
const leaveTypeCountMap = new Map();
const arCountMap = new Map();
const allPhoneNumbers = new Set();
const attendanceCountMap = new Map();
const attendanceSumMap = new Map();
let allLeaveTypes = new Set();

const recursiveFetch = async (baseQuery, intermediate, previousResult) => {
  if (previousResult
    && previousResult.length === 0) {
    console.log('exiting', intermediate.length);

    return intermediate;
  }

  console.log('called again');
  console.log('previousResult length:', (() => {
    if (!previousResult) {
      return null;
    }

    return previousResult.length;
  })());

  let query = baseQuery
    .orderBy(admin.firestore.FieldPath.documentId());

  if (previousResult && previousResult.length > 0) {
    const last = previousResult[previousResult.length - 1];

    console.log('last', last.id);

    query = query
      .startAfter(last.id);
  }

  const result = await query.limit(500).get();

  console.log('result', result.size);

  return recursiveFetch(baseQuery, [].concat(intermediate, result.docs), result.docs);
};

const getEmployeeCreationDate = (activationDate, momentInstance, timezone) => {
  const activationDateMoment = momentTz(activationDate).tz(timezone);

  if (activationDate
    && momentInstance.month() === activationDateMoment.month()) {
    return activationDateMoment.format(dateFormats.DATE);
  }

  return '';
};

const getLeaveStatus = attendanceDateObject => {
  if (attendanceDateObject.leave.leaveType) {
    return `Leave ${attendanceDateObject.leave.leaveType}`;
  }

  return 'Leave';
};


const getTypeValue = (attendanceDateObject = {}) => {
  if (attendanceDateObject.onLeave) {
    return getLeaveStatus(attendanceDateObject);
  }

  if (attendanceDateObject.weeklyOff) {
    return 'Weekly Off';
  }

  if (attendanceDateObject.onAr) {
    return 'Attendance Regularization';
  }

  attendanceDateObject
    .working = attendanceDateObject.working || {};

  if (attendanceDateObject.isLate) {
    return 'Late';
  }

  if (Number.isInteger(attendanceDateObject.working.firstCheckInTimestamp)) {
    return 'Working';
  }

  return '';
};

const getStatusValue = (attendanceDateObject = {}) => {
  if (attendanceDateObject.hasOwnProperty('attendance')) {
    return (attendanceDateObject.attendance === Infinity ? 1 : attendanceDateObject.attendance);
  }

  return '';
};

const getDetailsValue = (attendanceDateObject = {}, baseLocation, timezone) => {
  if (attendanceDateObject.weeklyOff
    || attendanceDateObject.holiday) {
    return baseLocation;
  }

  if (attendanceDateObject.onLeave
    && attendanceDateObject.leave.reason) {
    return attendanceDateObject.leave.reason;
  }

  if (attendanceDateObject.onAr
    && attendanceDateObject.ar.reason) {
    return attendanceDateObject.ar.reason;
  }

  const {
    firstCheckInTimestamp,
    lastCheckInTimestamp,
    numberOfCheckIns,
  } = attendanceDateObject.working || {};

  if (!firstCheckInTimestamp) {
    return '';
  }

  return `${momentTz(firstCheckInTimestamp).tz(timezone).format(dateFormats.TIME)}`
    + `, `
    + `${momentTz(lastCheckInTimestamp).tz(timezone).format(dateFormats.TIME)}`
    + `, `
    + `${numberOfCheckIns}`;
};


const getTotalDays = params => {
  const {
    momentYesterday,
    firstDayOfMonthlyCycle,
    fetchPreviousMonthDocs,
  } = params;

  if (fetchPreviousMonthDocs) {
    const momentPrevMonth = momentYesterday
      .clone()
      .subtract(1, 'month')
      .date(firstDayOfMonthlyCycle);

    return momentYesterday
      .diff(momentPrevMonth, 'days') + 1;
  }

  return momentYesterday
    .diff(momentYesterday.clone().date(firstDayOfMonthlyCycle), 'days') + 1;
};

const rangeCallback = params => {
  const {
    timezone,
    payrollSheet,
    rowIndex,
    attendanceDoc,
    momentInstance,
    date,
  } = params;
  const {
    region,
    employeeCode,
    employeeName,
    phoneNumber,
    activationDate,
    department,
    baseLocation,
  } = attendanceDoc.data() || {};

  const attendance = attendanceDoc.get('attendance') || {};

  allPhoneNumbers
    .add(phoneNumber);

  /** Data might not exist for someone for a certain date. */
  attendance[date] = attendance[date] || {};
  const hasAttendanceProperty = attendance[date].hasOwnProperty('attendance');

  attendance[date].leave = attendance[date].leave || {};

  if (attendance[date].leave.leaveType) {

    if (typeof allLeaveTypes.add !== 'function') {
      console.log('add undefined', phoneNumber, typeof allLeaveTypes, Array.isArray(allLeaveTypes));
    }

    allLeaveTypes.add(attendance[date].leave.leaveType);

    const oldCount = leaveTypeCountMap.get(phoneNumber) || {};

    oldCount[
      attendance[date].leave.leaveType
    ] = oldCount[attendance[date].leave.leaveType] || 0;

    oldCount[
      attendance[date].leave.leaveType
    ]++;

    leaveTypeCountMap
      .set(phoneNumber, oldCount);
  }

  if (attendance[date].holiday) {
    const oldSet = holidayCountMap
      .get(phoneNumber) || 0;

    holidayCountMap
      .set(phoneNumber, oldSet + 1);
  }

  if (attendance[date].weeklyOff) {
    const oldSet = weeklyOffCountMap
      .get(phoneNumber) || 0;

    weeklyOffCountMap
      .set(phoneNumber, oldSet + 1);
  }

  if (attendance[date].holiday) {
    const oldSet = holidayCountMap.get(phoneNumber) || 0;

    holidayCountMap
      .set(phoneNumber, oldSet + 1);
  }

  if (attendance[date].onAr) {
    const oldSet = arCountMap.get(phoneNumber) || 0;
    arCountMap
      .set(phoneNumber, oldSet + 1);
  }

  if (hasAttendanceProperty) {
    const oldCount = attendanceCountMap.get(phoneNumber) || 0;

    attendanceCountMap
      .set(
        phoneNumber,
        oldCount + 1
      );

    const oldAttendanceSum = attendanceSumMap.get(phoneNumber) || 0;

    const n = attendance[date].attendance;

    attendanceSumMap
      .set(
        phoneNumber,
        oldAttendanceSum + (n === Infinity ? 1 : n)
      );
  }

  [
    employeeName,
    phoneNumber,
    employeeCode,
    baseLocation,
    region,
    department,
    momentInstance.date(date).format(dateFormats.DATE), // actual date
    getEmployeeCreationDate(activationDate, momentInstance.clone(), timezone), // activation date
    getTypeValue(attendance[date]),
    getStatusValue(attendance[date]),
    getDetailsValue(attendance[date], baseLocation, timezone),
  ].forEach((value, innerIndex) => {
    payrollSheet
      .cell(`${alphabetsArray[innerIndex]}${rowIndex + 1}`)
      .value(value);
  });
};


module.exports = async locals => {
  const timestampFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentToday = momentTz(timestampFromTimer)
    .tz(timezone);
  const momentYesterday = momentToday
    .clone()
    .subtract(1, 'day');
  const firstDayOfMonthlyCycle = locals
    .officeDoc
    .get('attachment.First Day Of Monthly Cycle.value') || 1;
  const fetchPreviousMonthDocs = firstDayOfMonthlyCycle > momentYesterday.date();
  const momentPrevMonth = momentYesterday.clone().subtract(1, 'month');
  /** Just for better readability. */
  const cycleEndMoment = momentYesterday;

  const allAttendanceDocs = [];

  const workbook = await xlsxPopulate
    .fromBlankAsync();
  const payrollSummary = workbook
    .addSheet(`Payroll Summary`);
  const payrollSheet = workbook
    .addSheet(`Payroll ${momentToday.format(dateFormats.DATE)}`);
  workbook
    .deleteSheet('Sheet1');

  // Dates in previous month.
  const firstRange = (() => {
    if (fetchPreviousMonthDocs) {
      return getNumbersbetween(
        firstDayOfMonthlyCycle,
        cycleEndMoment.clone().endOf('month').date(),
      );
    }

    return [];
  })();

  /** Dates in current month */
  const secondRange = getNumbersbetween(
    (fetchPreviousMonthDocs ? 1 : firstDayOfMonthlyCycle),
    cycleEndMoment.clone().date() + 1,
  );

  console.log('firstRange', firstRange);
  console.log('secondRange', secondRange);

  const totalDays = getTotalDays({
    momentYesterday,
    firstDayOfMonthlyCycle,
    fetchPreviousMonthDocs,
  });

  console.log('totalDays', totalDays);
  console.log('fetchPreviousMonthDocs', fetchPreviousMonthDocs);

  if (fetchPreviousMonthDocs) {
    const baseQuery = locals
      .officeDoc
      .ref
      .collection(subcollectionNames.ATTENDANCES)
      .where('month', '==', momentPrevMonth.month())
      .where('year', '==', momentPrevMonth.year());

    const prevMonthDocs = await recursiveFetch(baseQuery, []);

    console.log('prevMonthDocs', prevMonthDocs.length);

    allAttendanceDocs
      .push(...prevMonthDocs);
  }

  const baseQuery = locals
    .officeDoc
    .ref
    .collection(subcollectionNames.ATTENDANCES)
    .where('month', '==', momentYesterday.month())
    .where('year', '==', momentYesterday.year());

  console.log('momentYesterday', momentYesterday.month(), momentYesterday.year());

  const yesterdayMonthDocs = await recursiveFetch(baseQuery, []);
  console.log('yesterdayMonthDocs', yesterdayMonthDocs.length);

  allAttendanceDocs
    .push(...yesterdayMonthDocs);

  console.log('allAttendanceDocs', allAttendanceDocs.length);

  let rowIndex = 0;

  allAttendanceDocs
    .forEach(attendanceDoc => {
      // Latest month among the two months for which the data is being fetched
      const isLaterMonth = attendanceDoc.get('month') === momentYesterday.month();
      const phoneNumber = attendanceDoc.get('phoneNumber');

      if (isLaterMonth) {
        employeeData
          .set(phoneNumber, {
            employeeName: attendanceDoc.get('employeeName'),
            employeeCode: attendanceDoc.get('employeeCode'),
            baseLocation: attendanceDoc.get('baseLocation'),
            region: attendanceDoc.get('region'),
            department: attendanceDoc.get('department'),
          });
      }

      // Entries for previous month (date = first day of monthly cycle)
      // the end of the month
      firstRange
        .forEach(date => {
          rowIndex++;

          const params = {
            timezone,
            payrollSheet,
            date,
            rowIndex,
            attendanceDoc,
            momentInstance: momentPrevMonth.clone(),
          };

          rangeCallback(params);
        });

      // Entries for yesterday's month
      secondRange
        .forEach(date => {
          rowIndex++;

          const params = {
            timezone,
            payrollSheet,
            date,
            rowIndex,
            attendanceDoc,
            momentInstance: momentYesterday.clone(),
          };

          rangeCallback(params);
        });
    });

  /**
   * Converting this set to an array in order to preserve
   * the order of the elements.
   * The summary sheet will use this order to put the dynamically generated
   * columns and their values.
   */
  allLeaveTypes = [...allLeaveTypes.values()];


  let summaryRowIndex = 0;

  allPhoneNumbers.forEach(phoneNumber => {
    const {
      employeeName,
      employeeCode,
      baseLocation,
      region,
      department,
    } = employeeData.get(phoneNumber);

    const values = [
      employeeName,
      phoneNumber,
      employeeCode,
      baseLocation,
      region,
      department,
      arCountMap.get(phoneNumber) || 0,
      weeklyOffCountMap.get(phoneNumber) || 0,
      holidayCountMap.get(phoneNumber) || 0,
      attendanceCountMap.get(phoneNumber) || 0, // mtd
      totalDays,
      attendanceSumMap.get(phoneNumber) || 0,
    ];

    const leaveTypesForUser = leaveTypeCountMap
      .get(phoneNumber) || {};

    allLeaveTypes
      .forEach(leaveType => {
        const count = leaveTypesForUser[leaveType] || 0;

        values
          .push(count);
      });

    values
      .forEach((value, innerIndex) => {
        payrollSummary
          .cell(`${alphabetsArray[innerIndex]}${summaryRowIndex + 2}`)
          .value(value);
      });

    summaryRowIndex++;
  });

  [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    'Date',
    'Activation Date',
    'Type',
    'Payable',
    'Details',
  ].forEach((value, index) => {
    payrollSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value)
      .style({ fontColor: 'FFFFF', bold: true });
  });

  [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    'AR',
    'Weekly Off',
    'Holiday',
    'MTD',
    'Total Days',
    'Payable Days',
    ...allLeaveTypes,
  ].forEach((value, index) => {
    payrollSummary
      .cell(`${alphabetsArray[index]}1`)
      .value(value);
  });

  locals
    .messageObject
    .attachments
    .push({
      fileName: `Payroll Report_`
        + `${locals.officeDoc.get('office')}`
        + `_${momentToday.format(dateFormats.DATE)}.xlsx`,
      content: await workbook.outputAsync('base64'),
      type: 'text/csv',
      disposition: 'attachment',
    });

  console.log(JSON.stringify({
    office: locals.officeDoc.get('office'),
    report: reportNames.PAYROLL,
    to: locals.messageObject.to,
  }, ' ', 2));

  await locals
    .sgMail
    .sendMultiple(locals.messageObject);

  console.log('mail sent');

  return;
};
