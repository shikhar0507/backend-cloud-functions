'use strict';

const momentz = require('moment-timezone');
const {
  dateFormats,
} = require('../../admin/constants');
const {
  alphabetsArray,
  toMapsUrl,
} = require('./report-utils');
const {
  getNumbersbetween,
} = require('../../admin/utils');
const {
  db,
} = require('../../admin/admin');
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


const getFieldValue = (employeeData, phoneNumber, field) => {
  if (employeeData[phoneNumber]) {
    return employeeData[phoneNumber][field] || '';
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
  const firstDayOfMonthlyCycle = locals
    .officeDoc
    .get('attachment.First Day Of Monthly Cycle.value') || 1;
  const weeklyOffSet = new Set();
  const holidaySet = new Set();
  const fetchPreviousMonthDocs = firstDayOfMonthlyCycle > momentYesterday.date();
  const momentPrevMonth = momentYesterday
    .clone()
    .subtract(1, 'month');
  /** Just for better readability. */
  const cycleEndMoment = momentYesterday;
  const workbook = await xlsxPopulate
    .fromBlankAsync();

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

  const attendanceDocPromises = [];

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

  const r1 = await locals
    .officeDoc
    .ref
    .collection('Attendances')
    .doc(momentYesterday.format(dateFormats.MONTH_YEAR))
    .listCollections();

  r1.forEach(colRef => {
    const promise = colRef
      .get();

    attendanceDocPromises
      .push(promise);
  });

  if (fetchPreviousMonthDocs) {
    const r2 = await locals
      .officeDoc
      .ref
      .collection('Attendances')
      .doc(momentPrevMonth.format(dateFormats.MONTH_YEAR))
      .listCollections();

    r2.forEach(colRef => {
      const promise = colRef
        .get();

      attendanceDocPromises
        .push(promise);
    });
  }

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

  console.log('fetchPreviousMonthDocs', fetchPreviousMonthDocs);
  console.log('firstRange', JSON.stringify(firstRange, null, 2));
  console.log('secondRange', JSON.stringify(secondRange, null, 2));

  let rowIndex = 0;

  const attendanceSnapshots = await Promise
    .all(attendanceDocPromises);
  const allStatusObjects = new Map();
  const allPhoneNumbers = new Set();
  const holidayOrWeeklyOffRefsMap = new Map();

  attendanceSnapshots
    .forEach(snapShot => {
      snapShot
        .forEach(doc => {
          const phoneNumber = doc.get('phoneNumber');
          const date = doc.get('date');
          const month = doc.get('month');
          const year = doc.get('year');
          const id = `${date}_${month}_${phoneNumber}`;
          const data = doc.data();

          if (momentYesterday.date() === date
            && momentYesterday.month() === month
            && momentYesterday.year() === year) {
            if (doc.get('weeklyOff')) {
              weeklyOffSet
                .add(phoneNumber);

              data
                .weeklyOff = true;

              data
                .branchName = locals.employeesData[phoneNumber]['Base Location'];
            }

            if (doc.get('holiday')) {
              holidaySet
                .add(phoneNumber);

              data.holiday = true;

              data
                .branchName = locals.employeesData[phoneNumber]['Base Location'];
            }

            holidayOrWeeklyOffRefsMap
              .set(
                doc.ref,
                phoneNumber
              );
          }

          allStatusObjects
            .set(id, data);

          allPhoneNumbers
            .add(phoneNumber);
        });
    });

  console.log('weeklyOffSet', weeklyOffSet.size);
  console.log('holidaySet', holidaySet.size);

  allPhoneNumbers
    .forEach(phoneNumber => {
      const rangeCallback = (date, moment) => {
        const month = moment.month();
        const year = moment.year();
        const id = `${date}_${month}_${phoneNumber}`;
        const el = allStatusObjects.get(id) || {};

        payrollSheet
          .cell(`A${rowIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Name'));

        payrollSheet
          .cell(`B${rowIndex + 2}`)
          .value(phoneNumber);

        payrollSheet
          .cell(`C${rowIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Employee Code'));

        payrollSheet
          .cell(`D${rowIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Base Location'));

        payrollSheet
          .cell(`E${rowIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Region'));

        payrollSheet
          .cell(`F${rowIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Department'));

        payrollSheet
          .cell(`G${rowIndex + 2}`)
          .value(momentz().date(date).month(month).year(year).format(dateFormats.DATE));

        payrollSheet
          .cell(`H${rowIndex + 2}`)
          .value(getSignUpDate({
            timezone,
            phoneNumber,
            employeesData: locals.employeesData,
            yesterdaysMonth: momentYesterday.month(),
          }));

        payrollSheet
          .cell(`I${rowIndex + 2}`)
          .value(getType(el));

        payrollSheet
          .cell(`J${rowIndex + 2}`)
          .value(el.statusForDay || '');

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
      };

      firstRange.forEach(date => {
        rangeCallback(date, momentPrevMonth.clone());
      });

      secondRange
        .forEach(date => {
          rangeCallback(date, momentYesterday.clone());
        });
    });

  console.log('holidayOrWeeklyOffRefsMap', holidayOrWeeklyOffRefsMap.size);

  /**
   * Report was triggered by Timer, so updating
   * Holiday and Weekly Off list,
   */
  if (momentz().date()
    === momentToday.date()) {
    const numberOfDocs = holidayOrWeeklyOffRefsMap.size;
    const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
    const numberOfBatches = Math
      .round(
        Math
          .ceil(numberOfDocs / MAX_DOCS_ALLOWED_IN_A_BATCH)
      );
    const batchArray = Array
      .from(Array(numberOfBatches)).map(() => db.batch());
    let batchIndex = 0;
    let docsCounter = 0;

    holidayOrWeeklyOffRefsMap
      .forEach((phoneNumber, ref) => {
        if (docsCounter > 499) {
          docsCounter = 0;
          batchIndex++;
        }

        docsCounter++;

        console.log('path', ref.path);

        batchArray[
          batchIndex
        ].set(ref, {
          holiday: holidaySet.has(phoneNumber),
          weeklyOff: weeklyOffSet.has(phoneNumber),
          'Base Location': locals
            .employeesData[phoneNumber]['Base Location'],
        }, {
          merge: true,
        });
      });

    console.log('writing statuses start');

    // await Promise
    //   .all(batchArray.map(batch => batch.commit()));

    console.log('writing statuses end');
  }

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
