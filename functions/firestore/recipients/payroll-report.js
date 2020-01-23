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

const {rootCollections} = require('../../admin/admin');
const {getNumbersbetween} = require('../../admin/utils');
const {
  subcollectionNames,
  dateFormats,
  reportNames,
} = require('../../admin/constants');
const {alphabetsArray} = require('./report-utils');
const admin = require('firebase-admin');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');

class NumberGenerator {
  constructor(initialValue = 0) {
    this.count = initialValue;
  }

  value() {
    return this.count++;
  }
}

const recursiveFetch = async (baseQuery, intermediate, previousResult) => {
  if (previousResult && previousResult.length === 0) {
    return intermediate;
  }

  console.log(
    'previousResult length:',
    (() => {
      if (!previousResult) {
        return null;
      }

      return previousResult.length;
    })(),
  );

  // TODO: the argument in `orderBy` can be replaced with `__name__`.
  let query = baseQuery.orderBy(admin.firestore.FieldPath.documentId());

  if (previousResult && previousResult.length > 0) {
    const last = previousResult[previousResult.length - 1];

    console.log('last', last.id);

    query = query.startAfter(last.id);
  }

  const result = await query.limit(250).get();

  console.log('result', result.size);

  return recursiveFetch(
    baseQuery,
    [].concat(intermediate, result.docs),
    result.docs,
  );
};

const getEmployeeCreationDate = (activationDate, momentInstance, timezone) => {
  const activationDateMoment = momentTz(activationDate).tz(timezone);

  if (
    activationDate &&
    momentInstance.year() === activationDateMoment.year() &&
    momentInstance.month() === activationDateMoment.month()
  ) {
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

  attendanceDateObject.working = attendanceDateObject.working || {};

  if (attendanceDateObject.isLate) {
    return 'Late';
  }

  if (Number.isInteger(attendanceDateObject.working.firstCheckInTimestamp)) {
    return 'Working';
  }

  return '';
};

const getAttendanceValue = (attendanceDateObject = {}) => {
  if (attendanceDateObject.hasOwnProperty('attendance')) {
    return attendanceDateObject.attendance;
  }

  return '';
};

const getDetailsValue = (attendanceDateObject = {}, baseLocation, timezone) => {
  if (attendanceDateObject.weeklyOff || attendanceDateObject.holiday) {
    return baseLocation;
  }

  if (attendanceDateObject.onLeave && attendanceDateObject.leave.reason) {
    return attendanceDateObject.leave.reason;
  }

  if (attendanceDateObject.onAr && attendanceDateObject.ar.reason) {
    return attendanceDateObject.ar.reason;
  }

  const {firstCheckInTimestamp, lastCheckInTimestamp, numberOfCheckIns} =
    attendanceDateObject.working || {};

  if (!firstCheckInTimestamp) {
    return '';
  }

  return (
    `${momentTz(firstCheckInTimestamp)
      .tz(timezone)
      .format(dateFormats.TIME)}` +
    `, ` +
    `${momentTz(lastCheckInTimestamp)
      .tz(timezone)
      .format(dateFormats.TIME)}` +
    `, ` +
    `${numberOfCheckIns}`
  );
};

const getTotalDays = params => {
  const {
    momentYesterday,
    firstDayOfMonthlyCycle,
    fetchPreviousMonthDocs,
  } = params;

  if (fetchPreviousMonthDocs) {
    return momentYesterday.diff(
      momentYesterday
        .clone()
        .subtract(1, 'month')
        .date(firstDayOfMonthlyCycle),
      'days',
    );
  }

  return momentYesterday.diff(
    momentYesterday.clone().date(firstDayOfMonthlyCycle),
    'days',
  );
};

const rangeCallback = params => {
  const {
    sortedAttendanceMap,
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
    phoneNumber,
    attendance,
    employeeData,
  } = params;

  const {
    supervisor,
    designation,
    region,
    employeeCode,
    employeeName,
    department,
    baseLocation,
  } = employeeData.get(phoneNumber) || {};

  const supervisorName =
    employeeData.get(supervisor) && employeeData.get(supervisor).employeeName;

  const activationDate = (() => {
    if (!attendanceDoc) {
      return '';
    }

    return attendanceDoc.get('activationDate');
  })();

  /** Data might not exist for someone for a certain date. */
  attendance[date] = attendance[date] || {};

  const hasAttendanceProperty = attendance[date].hasOwnProperty('attendance');

  attendance[date].leave = attendance[date].leave || {};

  if (attendance[date].leave.leaveType) {
    allLeaveTypes.add(attendance[date].leave.leaveType);

    const oldCount = leaveTypeCountMap.get(phoneNumber) || {};

    oldCount[attendance[date].leave.leaveType] =
      oldCount[attendance[date].leave.leaveType] || 0;
    oldCount[attendance[date].leave.leaveType]++;

    leaveTypeCountMap.set(phoneNumber, oldCount);
  }

  if (attendance[date].holiday) {
    const oldSet = holidayCountMap.get(phoneNumber) || 0;

    holidayCountMap.set(phoneNumber, oldSet + 1);
  }

  if (attendance[date].weeklyOff) {
    const oldSet = weeklyOffCountMap.get(phoneNumber) || 0;

    weeklyOffCountMap.set(phoneNumber, oldSet + 1);
  }

  if (attendance[date].holiday) {
    const oldSet = holidayCountMap.get(phoneNumber) || 0;

    holidayCountMap.set(phoneNumber, oldSet + 1);
  }

  if (attendance[date].onAr) {
    const oldSet = arCountMap.get(phoneNumber) || 0;

    arCountMap.set(phoneNumber, oldSet + 1);
  }

  if (hasAttendanceProperty) {
    attendanceCountMap.set(
      phoneNumber,
      (attendanceCountMap.get(phoneNumber) || 0) + 1,
    );

    const oldAttendanceSum = attendanceSumMap.get(phoneNumber) || 0;

    attendanceSumMap.set(
      phoneNumber,
      oldAttendanceSum + attendance[date].attendance,
    );
  }

  const attendanceOnDate = getAttendanceValue(attendance[date]);
  const o = sortedAttendanceMap.get(phoneNumber) || [];

  o.push(attendanceOnDate || 0);

  sortedAttendanceMap.set(phoneNumber, o);

  [
    employeeName,
    phoneNumber,
    employeeCode,
    baseLocation,
    region,
    department,
    designation,
    supervisorName || supervisor,
    momentInstance.date(date).format(dateFormats.DATE), // actual date
    getEmployeeCreationDate(activationDate, momentInstance.clone(), timezone), // activation date
    getTypeValue(attendance[date]),
    attendanceOnDate,
    getDetailsValue(attendance[date], baseLocation, timezone),
  ].forEach((value, innerIndex) => {
    payrollSheet
      .cell(`${alphabetsArray[innerIndex]}${rowIndex + 1}`)
      .value(value);
  });
};

const getWorkbook = async formattedDate => {
  const workbookRef = await xlsxPopulate.fromBlankAsync();
  const payrollSummary = workbookRef.addSheet(`Payroll Summary`);
  const payrollSheet = workbookRef.addSheet(`Payroll ${formattedDate}`);

  workbookRef.deleteSheet('Sheet1');

  return {
    workbookRef,
    payrollSheet,
    payrollSummary,
  };
};

const getSupervisor = roleDoc => {
  return [
    roleDoc.attachment['First Supervisor'].value,
    roleDoc.attachment['Second Supervisor'].value,
    roleDoc.attachment['Third Supervisor'].value,
  ].filter(Boolean)[0];
};

const getRoleDetails = doc => {
  const {
    roleDoc,
    employeeName,
    employeeCode,
    baseLocation,
    region,
    department,
    designation,
  } = doc.data();

  if (roleDoc) {
    return {
      status: roleDoc.status || '',
      employeeName: roleDoc.attachment.Name.value,
      employeeCode: roleDoc.attachment['Employee Code'].value,
      baseLocation: roleDoc.attachment['Base Location'].value,
      region: roleDoc.attachment.Region.value,
      department: roleDoc.attachment.Department.value,
      designation: roleDoc.attachment.Designation.value,
      supervisor: getSupervisor(roleDoc),
      minimumWorkingHours: roleDoc.attachment['Minimum Working Hours'].value,
      monthlyOffDays: roleDoc.attachment['Monthly Off Days'].value,
      minimumDailyActivityCount:
        roleDoc.attachment['Minimum Daily Activity Count'].value,
    };
  }

  return {
    employeeName,
    employeeCode,
    baseLocation,
    region,
    department,
    designation,
    status: '',
    minimumDailyActivityCount: '',
    minimumWorkingHours: '',
    monthlyOffDays: '',
  };
};

const getHeaderDates = (firstRange, secondRange, momentYesterday) => {
  const result = [];
  const momentPrevMonth = momentYesterday.clone().subtract(1, 'month');

  firstRange.forEach(date => {
    result.push(
      momentPrevMonth
        .clone()
        .date(date)
        .format(dateFormats.DATE),
    );
  });

  secondRange.forEach(date => {
    result.push(
      momentYesterday
        .clone()
        .date(date)
        .format(dateFormats.DATE),
    );
  });

  return result;
};

module.exports = async locals => {
  const timestampFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentToday = momentTz(timestampFromTimer).tz(timezone);
  const momentYesterday = momentToday.clone().subtract(1, 'day');
  const firstDayOfMonthlyCycle =
    locals.officeDoc.get('attachment.First Day Of Monthly Cycle.value') || 1;
  const fetchPreviousMonthDocs =
    firstDayOfMonthlyCycle > momentYesterday.date();
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
  const attendanceCountMap = new Map();
  const attendanceSumMap = new Map();
  const sortedAttendanceMap = new Map();
  const docsMap = {};
  const {workbookRef, payrollSummary, payrollSheet} = await getWorkbook(
    momentToday.format(dateFormats.DATE),
  );

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
        momentPrevMonth
          .clone()
          .endOf('month')
          .date() + 1,
      );
    }

    return [];
  })();

  /** Dates in current month */
  const secondRange = getNumbersbetween(
    fetchPreviousMonthDocs ? 1 : firstDayOfMonthlyCycle,
    cycleEndMoment.clone().date() + 1,
  );

  const totalDays =
    getTotalDays({
      momentYesterday,
      firstDayOfMonthlyCycle,
      fetchPreviousMonthDocs,
    }) + 1;

  if (fetchPreviousMonthDocs) {
    const baseQuery = locals.officeDoc.ref
      .collection(subcollectionNames.ATTENDANCES)
      .where('month', '==', momentPrevMonth.month())
      .where('year', '==', momentPrevMonth.year());

    allAttendanceDocs.push(...(await recursiveFetch(baseQuery, [])));
  }

  const baseQuery = locals.officeDoc.ref
    .collection(subcollectionNames.ATTENDANCES)
    .where('month', '==', momentYesterday.month())
    .where('year', '==', momentYesterday.year());

  allAttendanceDocs.push(...(await recursiveFetch(baseQuery, [])));
  console.log('allAttendanceDocs', allAttendanceDocs.length);

  allAttendanceDocs.forEach(doc => {
    const {month, phoneNumber} = doc.data();

    employeeData.set(phoneNumber, getRoleDetails(doc));
    docsMap[`${phoneNumber}__${month}`] = doc;
  });

  const numberInstance = new NumberGenerator(1);
  const prevMonth = momentPrevMonth.month();
  const currMonth = momentYesterday.month();

  console.log('firstRange', firstRange);
  console.log('secondRange', secondRange);

  employeeData.forEach((_, phoneNumber) => {
    firstRange.forEach(date => {
      const rowIndex = numberInstance.value();
      const attDoc = docsMap[`${phoneNumber}__${prevMonth}`];
      const params = {
        sortedAttendanceMap,
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
        phoneNumber,
        attendanceDoc: attDoc,
        attendance: (attDoc ? attDoc.get('attendance') : {}) || {},
        momentInstance: momentPrevMonth.clone(),
      };

      allCountsData.rowsCount++;

      rangeCallback(params);
    });

    secondRange.forEach(date => {
      const rowIndex = numberInstance.value();
      const attDoc = docsMap[`${phoneNumber}__${currMonth}`];
      const params = {
        sortedAttendanceMap,
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
        phoneNumber,
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
  allCountsData.totalUsers = employeeData.size;

  employeeData.forEach((val, phoneNumber) => {
    const {
      employeeName,
      employeeCode,
      baseLocation,
      region,
      department,
      designation,
      supervisor,
      status,
      minimumDailyActivityCount,
      minimumWorkingHours,
      monthlyOffDays,
    } = val || {}; // the user might not be an employee

    const supervisorName =
      employeeData.get(supervisor) && employeeData.get(supervisor).employeeName;
    const values = [
      employeeName,
      phoneNumber,
      employeeCode,
      status,
      baseLocation,
      region,
      department,
      designation,
      minimumDailyActivityCount,
      minimumWorkingHours,
      monthlyOffDays,
      supervisorName || supervisor,
      arCountMap.get(phoneNumber) || 0,
      weeklyOffCountMap.get(phoneNumber) || 0,
      holidayCountMap.get(phoneNumber) || 0,
      attendanceCountMap.get(phoneNumber) || 0, // mtd
      totalDays,
      attendanceSumMap.get(phoneNumber) || 0,
    ];

    const leaveTypesForUser = leaveTypeCountMap.get(phoneNumber) || {};

    allLeaveTypes.forEach(leaveType => {
      values.push(leaveTypesForUser[leaveType] || 0);
    });

    sortedAttendanceMap.get(phoneNumber).forEach(attendanceValue => {
      values.push(attendanceValue);
    });

    values.forEach((value, innerIndex) => {
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
    'Designation',
    'Supervisor',
    'Date',
    'Activation Date',
    'Type',
    'Payable',
    'Details',
  ].forEach((value, index) => {
    payrollSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value)
      .style({
        fontColor: 'FFFFF',
        bold: true,
      });
  });

  // status,
  //   minimumDailyActivityCount,
  //   minimumWorkingHours,
  //   monthlyOffDays,
  //   baseLocation,
  [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Status', // change
    'Base Location',
    'Region',
    'Department',
    'Designation',
    'Minimum Daily Activity Count', // change
    'Minimum Working Hours',
    'Monthly Off Days',
    'Supervisor',
    'AR',
    'Weekly Off',
    'Holiday',
    'MTD',
    'Total Days',
    'Payable Days',
    ...allLeaveTypes,
    ...getHeaderDates(firstRange, secondRange, momentYesterday),
  ].forEach((value, index) => {
    payrollSummary
      .cell(`${alphabetsArray[index]}1`)
      .value(value)
      .style({
        fontColor: 'FFFFF',
        bold: true,
      });
  });

  console.log('allLeaveTypes', allLeaveTypes);

  locals.messageObject.attachments.push({
    fileName:
      `Payroll Report_` +
      `${locals.officeDoc.get('office')}` +
      `_${momentToday.format(dateFormats.DATE)}.xlsx`,
    content: await workbookRef.outputAsync('base64'),
    type: 'text/csv',
    disposition: 'attachment',
  });

  console.log(
    JSON.stringify(
      {
        office: locals.officeDoc.get('office'),
        report: reportNames.PAYROLL,
        to: locals.messageObject.to,
      },
      ' ',
      2,
    ),
  );

  console.log('mail sent');

  return Promise.all([
    locals.sgMail.sendMultiple(locals.messageObject),
    rootCollections.inits.doc().set(allCountsData),
  ]);
};
