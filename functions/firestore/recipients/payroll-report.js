'use strict';

const momentz = require('moment-timezone');
const {
  dateFormats,
  allMonths,
} = require('../../admin/constants');
const {
  alphabetsArray,
  toMapsUrl,
} = require('./report-utils');
const {
  getNumbersbetween,
} = require('../../admin/utils');
const xlsxPopulate = require('xlsx-populate');
const env = require('../../admin/env');


const getDetails = (el, timezone) => {
  if (el.onAr) {
    let result = `${momentz(el.arStartTime).tz(timezone).format(dateFormats.DATE_TIME)}`
      + ` ${el.arStatus || ''}`;

    if (el.arApprovedOn) {
      result += ` ${momentz(el.arApprovedOn).tz(timezone).format(dateFormats.DATE_TIME)}`;

      result += ` ${el.arApprovedBy}`;
    }

    return result;
  }

  if (el.onLeave) {
    let result = `${momentz(el.leaveStartTime).format(dateFormats.DATE_TIME)}`
      + ` ${el.leaveStatus || ''}`;

    if (el.leaveApprovedOn) {
      result += ` ${momentz(el.leaveApprovedOn).tz(timezone).format(dateFormats.DATE_TIME)}`;

      result += ` ${el.leaveApprovedBy}`;
    }

    return result;
  }

  if (el.weeklyOff || el.holiday) {
    return el.branchName;
  }

  if (!el.firstCheckIn) {
    return ``;
  }

  return `${el.firstCheckIn}`
    + ` to`
    + ` ${el.lastCheckIn},`
    + ` ${el.numberOfCheckIns || 0}`;
};


const getType = el => {
  if (el.onAr) {
    return 'Attendance Regularization';
  }

  if (el.onLeave) {
    return `Leave ${el.leaveType || ''}`;
  }

  if (el.weeklyOff) {
    return 'Weekly Off';
  }

  if (el.holiday) {
    return 'Holiday';
  }

  if (el.firstCheckIn) {
    return `Check-in`;
  }

  return '';
};


const getSignUpDate = params => {
  const {
    employeesData,
    phoneNumber,
    timezone,
    yesterdaysMonth,
  } = params;

  if (!employeesData[phoneNumber]) {
    return '';
  }

  const createTime = momentz(employeesData[phoneNumber].createTime)
    .tz(timezone);

  if (yesterdaysMonth === createTime.month()) {
    return createTime
      .format(dateFormats.DATE);
  }

  return '';
};


module.exports = async locals => {
  const timeStampFromTimer = locals
    .change
    .after
    .get('timestamp');
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const momentToday = momentz(timeStampFromTimer)
    .tz(timezone);
  const momentYesterday = momentToday
    .clone()
    .subtract(1, 'day');
  const monthYearString = momentYesterday
    .format(dateFormats.MONTH_YEAR);
  const firstDayOfMonthlyCycle = locals
    .officeDoc
    .get('attachment.First Day Of Monthly Cycle.value') || 1;
  const weeklyOffSet = new Set();
  const holidaySet = new Set();
  const fetchPreviousMonthDocs = firstDayOfMonthlyCycle > momentYesterday.date();

  /** Just for better readability. */
  const cycleEndMoment = momentYesterday;

  const promises = [
    xlsxPopulate
      .fromBlankAsync(),
    locals
      .officeDoc
      .ref
      .collection('Statuses')
      .doc(monthYearString)
      .collection('Employees')
      .get(),
  ];

  Object
    .entries(locals.employeesData)
    .forEach(entry => {
      const [
        phoneNumber,
        employeeData
      ] = entry;

      if (employeeData['Weekly Off']
        === momentYesterday.format('dddd').toLowerCase()) {
        weeklyOffSet
          .add(phoneNumber);
      }

      if (employeeData.branchHolidays
        && employeeData.branchHolidays[momentYesterday.format(dateFormats.DATE)]) {
        holidaySet
          .add(phoneNumber);
      }
    });

  if (fetchPreviousMonthDocs) {
    const prevMonth = momentYesterday
      .clone()
      .subtract(1, 'month')
      .format(dateFormats.MONTH_YEAR);

    promises
      .push(locals
        .officeDoc
        .ref
        .collection('Statuses')
        .doc(prevMonth)
        .collection('Employees')
        .get()
      );
  }

  const [
    workbook,
    statusObjectsCurrMonth,
    statusObjectsPrevMonth, // could be undefined
  ] = await Promise
    .all(promises);

  const payrollSheet = workbook
    .addSheet(`PayRoll ${momentToday.format(dateFormats.DATE)}`);

  workbook
    .deleteSheet('Sheet1');

  [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    'Date',
    'Sign Up Date',
    'Type',
    'Status',
    'Details',
  ].forEach((value, index) => {
    payrollSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value);
  });

  const firstRange = (() => {
    if (fetchPreviousMonthDocs) {
      return getNumbersbetween(
        firstDayOfMonthlyCycle,
        cycleEndMoment.clone().endOf('month').date() + 1,
      );
    }

    return [];
  })();
  const secondRange = getNumbersbetween(
    firstDayOfMonthlyCycle,
    cycleEndMoment.clone().date() + 1,
  );

  let rowIndex = 0;

  const allMonthlyDocs = []
    .concat(
      (((statusObjectsPrevMonth || []).docs) || []),
      statusObjectsCurrMonth.docs,
    );

  allMonthlyDocs
    .forEach(doc => {
      const statusObject = doc.get('statusObject');
      const { path } = doc.ref;
      const parts = path.split('/');
      const phoneNumber = doc.id;
      const monthYearString = parts[3];
      const [
        monthName,
        year,
      ] = monthYearString.split(' ');
      const month = allMonths[monthName];

      const range = (() => {
        if (month !== momentYesterday.month()) {
          return firstRange; // range from prev month cycle to prev month end.
        }

        return secondRange; // current month's start to yesterday
      })();

      range
        .forEach(date => {
          const el = statusObject[date] || {};

          if (date === momentYesterday.date()
            && month === momentYesterday.month()
            && year === momentYesterday.year()) {
            el
              .weeklyOff = weeklyOffSet.has(phoneNumber);
            el
              .holiday = holidaySet.has(phoneNumber);

            if (el.weeklyOff || el.holiday) {
              el.branchName = locals.employeesData[phoneNumber]['Base Location'];
            }
          }

          const employeeName = (() => {
            if (locals.employeesData[phoneNumber]) {
              return locals.employeesData[phoneNumber].Name;
            }

            if (doc.get('employeeName')) {
              return doc.get('employeeName');
            }

            return '';
          })();

          const employeeCode = (() => {
            if (locals.employeesData[phoneNumber]) {
              return locals.employeesData[phoneNumber]['Employee Code'];
            }

            if (doc.get('employeeCode')) {
              return doc.get('employeeCode');
            }

            return '';
          })();

          const baseLocation = (() => {
            if (locals.employeesData[phoneNumber]) {
              return locals.employeesData[phoneNumber]['Base Location'];
            }

            if (doc.get('baseLocation')) {
              return doc.get('baseLocation');
            }

            return '';
          })();

          const region = (() => {
            if (locals.employeesData[phoneNumber]) {
              return locals.employeesData[phoneNumber].Region;
            }

            if (doc.get('region')) {
              return doc.get('region');
            }

            return '';
          })();

          const department = (() => {
            if (locals.employeesData[phoneNumber]) {
              return locals.employeesData[phoneNumber].Department;
            }

            if (doc.get('department')) {
              return doc.get('department');
            }

            return '';
          })();

          payrollSheet
            .cell(`A${rowIndex + 2}`)
            .value(employeeName);

          payrollSheet
            .cell(`B${rowIndex + 2}`)
            .value(phoneNumber);

          payrollSheet
            .cell(`C${rowIndex + 2}`)
            .value(employeeCode);

          payrollSheet
            .cell(`D${rowIndex + 2}`)
            .value(baseLocation);

          payrollSheet
            .cell(`E${rowIndex + 2}`)
            .value(region);

          payrollSheet
            .cell(`F${rowIndex + 2}`)
            .value(department);

          payrollSheet
            .cell(`G${rowIndex + 2}`)
            .value(momentz().date(date).month(month).year(year).format(dateFormats.DATE));

          payrollSheet
            .cell(`H${rowIndex + 2}`)
            .value(getSignUpDate({
              phoneNumber,
              timezone,
              employeesData: locals.employeesData,
              yesterdaysMonth: momentYesterday.month(),
            }));

          payrollSheet
            .cell(`I${rowIndex + 2}`)
            .value(getType(el));

          payrollSheet
            .cell(`J${rowIndex + 2}`)
            .value(el.statusForDay || 0);

          if (!el.onAr
            && !el.onLeave
            && el.firstCheckIn
            && el.geopoint) {
            payrollSheet
              .cell(`K${rowIndex + 2}`)
              .value(getDetails(el, timezone))
              .style({ fontColor: '0563C1', underline: true })
              .hyperlink(toMapsUrl(el.geopoint));
          } else {
            payrollSheet
              .cell(`K${rowIndex + 2}`)
              .value(getDetails(el, timezone));
          }

          rowIndex++;
        });
    });

  locals
    .messageObject
    .attachments
    .push({
      fileName: `Payroll Report`
        + ` ${locals.officeDoc.get('office')}`
        + `_${momentToday.format(dateFormats.DATE)}.xlsx`,
      content: await workbook.outputAsync('base64'),
      type: 'text/csv',
      disposition: 'attachment',
    });

  if (!env.isProduction) {
    return;
  }

  console.log('mail sent', locals.messageObject.to);

  return locals
    .sgMail
    .sendMultiple(locals.messageObject);
};
