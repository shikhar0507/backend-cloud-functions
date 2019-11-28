'use strict';


const { rootCollections } = require('../../admin/admin');
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


const recursiveFetch = async (baseQuery, intermediate, previousResult) => {
  if (previousResult
    && previousResult.length === 0) {
    console.log('exiting', intermediate.length);

    return intermediate;
  }

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
    && momentInstance.year() === activationDateMoment.year()
    && momentInstance.month() === activationDateMoment.month()) {
    return activationDateMoment
      .format(dateFormats.DATE);
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
    return attendanceDateObject.attendance;
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
    allLeaveTypes,
    timezone,
    payrollSheet,
    rowIndex,
    attendanceDoc,
    momentInstance,
    date,
    weeklyOffCountMap,
    holidayCountMap,
    leaveTypeCountMap,
    arCountMap,
    attendanceCountMap,
    attendanceSumMap,
    region,
    employeeCode,
    employeeName,
    phoneNumber,
    department,
    baseLocation,
    attendance,
  } = params;

  const activationDate = (() => {
    if (!attendanceDoc) {
      return '';
    }

    return attendanceDoc.get('activationDate');
  })();

  /** Data might not exist for someone for a certain date. */
  attendance[
    date
  ] = attendance[date] || {};

  const hasAttendanceProperty = attendance[
    date
  ].hasOwnProperty('attendance');

  // console.log(phoneNumber, JSON.stringify(attendance[date], ' ', 2));

  attendance[
    date
  ].leave = attendance[date].leave || {};

  if (attendance[date].leave.leaveType) {
    allLeaveTypes
      .add(attendance[date].leave.leaveType);

    const oldCount = leaveTypeCountMap.get(phoneNumber) || {};

    oldCount[
      attendance[date].leave.leaveType
    ] = oldCount[attendance[date].leave.leaveType] || 0;

    oldCount[
      attendance[date].leave.leaveType
    ]++;

    leaveTypeCountMap
      .set(
        phoneNumber,
        oldCount
      );
  }

  if (attendance[date].holiday) {
    const oldSet = holidayCountMap
      .get(phoneNumber) || 0;

    holidayCountMap
      .set(
        phoneNumber,
        oldSet + 1
      );
  }

  if (attendance[date].weeklyOff) {
    const oldSet = weeklyOffCountMap
      .get(phoneNumber) || 0;

    weeklyOffCountMap
      .set(
        phoneNumber,
        oldSet + 1
      );
  }

  if (attendance[date].holiday) {
    const oldSet = holidayCountMap.get(phoneNumber) || 0;

    holidayCountMap
      .set(
        phoneNumber,
        oldSet + 1
      );
  }

  if (attendance[date].onAr) {
    const oldSet = arCountMap.get(phoneNumber) || 0;
    arCountMap
      .set(
        phoneNumber,
        oldSet + 1
      );
  }

  if (hasAttendanceProperty) {
    const oldCount = attendanceCountMap.get(phoneNumber) || 0;

    attendanceCountMap
      .set(
        phoneNumber,
        oldCount + 1
      );

    const oldAttendanceSum = attendanceSumMap.get(phoneNumber) || 0;

    attendanceSumMap
      .set(
        phoneNumber,
        oldAttendanceSum + attendance[date].attendance
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
  let allLeaveTypes = new Set();
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
  const workbook = await xlsxPopulate
    .fromBlankAsync();
  const payrollSummary = workbook
    .addSheet(`Payroll Summary`);
  const payrollSheet = workbook
    .addSheet(`Payroll ${momentToday.format(dateFormats.DATE)}`);
  workbook
    .deleteSheet('Sheet1');

  const allCountsData = {
    report: reportNames.PAYROLL,
    rowsCount: 0,
    totalUsers: 0,
    office: locals.officeDoc.get('office'),
    timestamp: Date.now(),
    officeId: locals.officeDoc.id,
    date: momentYesterday.date(),
    month: momentYesterday.month(),
    year: momentYesterday.year(),
  };

  // Dates in previous month.
  const firstRange = (() => {
    if (fetchPreviousMonthDocs) {
      return getNumbersbetween(
        firstDayOfMonthlyCycle,
        momentPrevMonth.clone().endOf('month').date() + 1,
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

  if (fetchPreviousMonthDocs) {
    const baseQuery = locals
      .officeDoc
      .ref
      .collection(subcollectionNames.ATTENDANCES)
      .where('month', '==', momentPrevMonth.month())
      .where('year', '==', momentPrevMonth.year());

    allAttendanceDocs
      .push(
        ...await recursiveFetch(baseQuery, [])
      );
  }

  const baseQuery = locals
    .officeDoc
    .ref
    .collection(subcollectionNames.ATTENDANCES)
    .where('month', '==', momentYesterday.month())
    .where('year', '==', momentYesterday.year());

  allAttendanceDocs
    .push(
      ...await recursiveFetch(baseQuery, [])
    );

  const docsMap = {};

  allAttendanceDocs
    .forEach(doc => {
      const {
        month,
        phoneNumber,
        employeeName,
        employeeCode,
        baseLocation,
        region,
        department,
      } = doc.data();

      employeeData
        .set(phoneNumber, {
          employeeName,
          employeeCode,
          baseLocation,
          region,
          department,
        });

      const key = `${phoneNumber}__${month}`;
      docsMap[key] = doc;

      allPhoneNumbers
        .add(phoneNumber);
    });

  let rowIndex = 0;

  const prevMonth = momentPrevMonth.month();
  const currMonth = momentYesterday.month();

  allPhoneNumbers
    .forEach(phoneNumber => {
      const {
        employeeName,
        employeeCode,
        baseLocation,
        region,
        department,
      } = employeeData.get(phoneNumber);

      firstRange
        .forEach(date => {
          rowIndex++;
          const key = `${phoneNumber}__${prevMonth}`;
          const attDoc = docsMap[key];

          const params = {
            allLeaveTypes,
            timezone,
            payrollSheet,
            date,
            rowIndex,
            employeeData,
            weeklyOffCountMap,
            holidayCountMap,
            leaveTypeCountMap,
            arCountMap,
            attendanceCountMap,
            attendanceSumMap,
            region,
            employeeCode,
            employeeName,
            phoneNumber,
            department,
            baseLocation,
            attendanceDoc: attDoc,
            attendance: (attDoc ? attDoc.get('attendance') : {}) || {},
            momentInstance: momentPrevMonth.clone(),
          };

          allCountsData.rowsCount++;

          rangeCallback(params);
        });

      secondRange
        .forEach(date => {
          rowIndex++;

          const key = `${phoneNumber}__${currMonth}`;
          const attDoc = docsMap[key];

          const params = {
            month: currMonth,
            allLeaveTypes,
            timezone,
            payrollSheet,
            date,
            rowIndex,
            employeeData,
            weeklyOffCountMap,
            holidayCountMap,
            leaveTypeCountMap,
            arCountMap,
            attendanceCountMap,
            attendanceSumMap,
            region,
            employeeCode,
            employeeName,
            phoneNumber,
            department,
            baseLocation,
            attendance: (attDoc ? attDoc.get('attendance') : {}) || {},
            momentInstance: momentYesterday.clone(),
          };

          allCountsData.rowsCount++;

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

  allCountsData.totalUsers = allPhoneNumbers.size;

  allPhoneNumbers
    .forEach(phoneNumber => {
      const {
        employeeName,
        employeeCode,
        baseLocation,
        region,
        department,
      } = employeeData
        .get(phoneNumber) || {};

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

  console.log(JSON.stringify(allCountsData, ' ', 2));

  await rootCollections
    .inits
    .doc()
    .set(allCountsData);

  return;
};
