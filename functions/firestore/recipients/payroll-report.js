'use strict';

const momentTz = require('moment-timezone');
const {
  dateFormats,
  allMonths,
  subcollectionNames,
} = require('../../admin/constants');
const {
  alphabetsArray,
  toMapsUrl,
  getStatusForDay,
  getFieldValue,
} = require('./report-utils');
const {
  getNumbersbetween,
} = require('../../admin/utils');
const {
  db,
  rootCollections,
} = require('../../admin/admin');
const xlsxPopulate = require('xlsx-populate');
const env = require('../../admin/env');


const getDetails = (el, timezone) => {
  if (el.onAr) {
    let result = `${momentTz(el.arStartTime).tz(timezone).format(dateFormats.DATE)}`
      + ` ${el.arStatus || ''}`
      + `, `
      + `${el.arReason || ''}`;

    if (el.arApprovedOn) {
      result += ` ${momentTz(el.arApprovedOn).tz(timezone).format(dateFormats.DATE)}`;

      result += ` ${el.arApprovedBy}`;
    }

    return result;
  }

  if (el.onLeave) {
    let result = `${momentTz(el.leaveStartTime).format(dateFormats.DATE)}`;

    if (el.leaveStatus) {
      result += ` ${el.leaveStatus || ''}`;
    }

    if (el.leaveApprovedOn) {
      result += ` ${momentTz(el.leaveApprovedOn).tz(timezone).format(dateFormats.DATE)}`;
    }

    if (el.leaveApprovedBy) {
      result += ` ${el.leaveApprovedBy}`;
    }

    return result;
  }

  if (el.weeklyOff || el.holiday) {
    return el
      .branchName;
  }

  if (!el.firstCheckInTimestamp) {
    return ``;
  }

  return `${momentTz(el.firstCheckInTimestamp).tz(timezone).format(dateFormats.TIME)}`
    + ` to`
    + ` ${momentTz(el.lastCheckInTimestamp).tz(timezone).format(dateFormats.TIME)},`
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

  const createTime = momentTz(employeesData[phoneNumber].createTime)
    .tz(timezone);

  if (yesterdaysMonth === createTime.month()) {
    return createTime
      .format(dateFormats.DATE);
  }

  return '';
};


module.exports = async locals => {
  const timestampFromTimer = locals
    .change
    .after
    .get('timestamp');
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const momentToday = momentTz(timestampFromTimer)
    .tz(timezone);
  const momentYesterday = momentToday
    .clone()
    .subtract(1, 'day');
  const firstDayOfMonthlyCycle = locals
    .officeDoc
    .get('attachment.First Day Of Monthly Cycle.value') || 1;
  const fetchPreviousMonthDocs = firstDayOfMonthlyCycle > momentYesterday.date();
  const momentPrevMonth = momentYesterday
    .clone()
    .subtract(1, 'month');
  /** Just for better readability. */
  const cycleEndMoment = momentYesterday;
  const workbook = await xlsxPopulate
    .fromBlankAsync();
  const payrollSummary = workbook
    .addSheet(`Payroll Summary`);
  const payrollSheet = workbook
    .addSheet(`Payroll ${momentToday.format(dateFormats.DATE)}`);

  workbook
    .deleteSheet('Sheet1');

  /**
   * Report was triggered by Timer, so updating
   * Holiday and Weekly Off list,
   */
  const writeAttendanceDocs = momentTz().date() === momentToday.date();
  const attendanceUpdatesRefMap = new Map();
  const attendanceDocPromises = [];
  const weeklyOffSet = new Set();
  const holidaySet = new Set();
  const weeklyOffCountMap = new Map();
  const holidayCountMap = new Map();
  const leaveTypesMap = new Map();
  const statusForDayMap = new Map();
  const statusForDaySumMap = new Map();
  const arCountMap = new Map();
  const allStatusObjects = new Map();
  const allPhoneNumbers = new Set();
  const newStatusMap = new Map();
  const uidsMap = new Map();
  let allLeaveTypes = new Set();

  const totalDays = (() => {
    // number of days for which the data is being sent for
    if (fetchPreviousMonthDocs) {
      const momentPrevMonth = momentYesterday
        .clone()
        .subtract(1, 'month')
        .date(firstDayOfMonthlyCycle);

      return momentPrevMonth
        .diff(momentYesterday, 'diff');
    }

    return momentYesterday
      .diff(momentYesterday.clone().date(firstDayOfMonthlyCycle), 'days');
  })() + 1;

  console.log('totalDays', totalDays);

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

  console.log(JSON.stringify({ firstRange, secondRange }, ' ', 2));

  [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    'Date',
    'Employee Creation Date',
    'Type',
    'Status',
    'Details',
  ].forEach((value, index) => {
    payrollSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value);
  });

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

  console.log('fetching collectionsForYesterdaysMonth');

  const collectionsForYesterdaysMonth = await locals
    .officeDoc
    .ref
    .collection(subcollectionNames.ATTENDANCES)
    .doc(momentYesterday.format(dateFormats.MONTH_YEAR))
    .listCollections();

  console.log('fetched collectionsForYesterdaysMonth');

  collectionsForYesterdaysMonth
    .forEach(collRef => {
      secondRange
        .forEach(date => {
          const promise = collRef
            .doc(`${date}`)
            .get();

          attendanceDocPromises
            .push(promise);
        });
    });


  if (fetchPreviousMonthDocs) {
    console.log('fetching collectionsForPrevMonths');

    const collectionsForPrevMonths = await locals
      .officeDoc
      .ref
      .collection(subcollectionNames.ATTENDANCES)
      .doc(momentPrevMonth.format(dateFormats.MONTH_YEAR))
      .listCollections();

    console.log('fetched collectionsForPrevMonths');

    collectionsForPrevMonths
      .forEach(colRef => {
        firstRange
          .forEach(date => {
            const promise = colRef
              .doc(`${date}`)
              .get();

            attendanceDocPromises
              .push(promise);
          });
      });
  }

  console.log('fetching attendanceSnapshots', attendanceDocPromises.length);

  const attendanceSnapshots = await Promise
    .all(attendanceDocPromises);

  console.log('fetching attendanceSnapshots');

  attendanceSnapshots
    .forEach(doc => {
      const { path } = doc.ref;
      const parts = path.split('/');
      const date = Number(doc.id);
      const [
        monthString,
      ] = parts[3]
        .split(' ');
      const month = allMonths[monthString];
      const phoneNumber = parts[4];
      const id = `${date}_${month}_${phoneNumber}`;
      const data = doc.data() || {};

      if (locals.employeesData[phoneNumber]) {
        data
          .branchName = locals.employeesData[phoneNumber]['Base Location'];
      }

      if (data.leaveType) {
        allLeaveTypes
          .add(data.leaveType);

        const lt = leaveTypesMap
          .get(phoneNumber) || {};

        lt[
          data.leaveType
        ] = lt[data.leaveType] || 0;

        lt[
          data.leaveType
        ]++;

        leaveTypesMap
          .set(phoneNumber, lt);
      }

      if (data.onAr) {
        const onArCount = arCountMap
          .get(phoneNumber) || 0;

        arCountMap
          .set(phoneNumber, onArCount + 1);
      }

      if (data.weeklyOff) {
        const weeklyOffCount = weeklyOffCountMap
          .get(phoneNumber) || 0;

        weeklyOffCountMap
          .set(phoneNumber, weeklyOffCount + 1);
      }

      if (data.holiday) {
        const holidayCount = holidayCountMap
          .get(phoneNumber) || 0;

        holidayCountMap
          .set(phoneNumber, holidayCount + 1);
      }

      if (data.statusForDay) {
        const statusForDayCount = statusForDayMap
          .get(phoneNumber) || 0;

        if ((statusForDayCount + 1) < totalDays) {
          statusForDayMap
            .set(phoneNumber, statusForDayCount + 1);
        }
      }

      allStatusObjects
        .set(id, data);

      allPhoneNumbers
        .add(phoneNumber);
    });

  const authFetchPromises = [];
  let rowIndex = 0;

  allPhoneNumbers
    .forEach(phoneNumber => {
      const rangeCallback = (date, moment) => {
        const month = moment.month();
        const year = moment.year();
        const id = `${date}_${month}_${phoneNumber}`;
        const el = allStatusObjects.get(id) || {};
        const isYesterday = momentYesterday.date() === date
          && momentYesterday.month() === month
          && momentYesterday.year();

        if (isYesterday
          && locals.employeesData[phoneNumber]) {
          const interm = getStatusForDay({
            numberOfCheckIns: el.numberOfCheckIns || 0,
            minimumDailyActivityCount: locals.employeesData[phoneNumber]['Minimum Daily Activity Count'],
            minimumWorkingHours: locals.employeesData[phoneNumber]['Minimum Working Hours'],
            hoursWorked: momentTz(el.lastCheckInTimestamp).diff(momentTz(el.firstCheckInTimestamp), 'hours'),
          });

          if (typeof interm === 'number'
            && el.firstCheckInTimestamp) {
            el
              .statusForDay = interm;

            newStatusMap
              .set(phoneNumber, interm);
          }
        }

        if (holidaySet.has(phoneNumber)
          || weeklyOffSet.has(phoneNumber)) {
          el
            .statusForDay = 1;

          if (locals.employeesData[phoneNumber]) {
            el
              .branchName = locals.employeesData[phoneNumber]['Base Location'];
          }
        }

        if (el.hasOwnProperty('statusForDay')) {
          const oldSum = statusForDaySumMap.get(phoneNumber) || 0;
          const newSum = oldSum + (el.statusForDay || 0);

          statusForDaySumMap
            .set(phoneNumber, newSum);
        }

        [
          getFieldValue(locals.employeesData, phoneNumber, 'Name'),
          phoneNumber,
          getFieldValue(locals.employeesData, phoneNumber, 'Employee Code'),
          getFieldValue(locals.employeesData, phoneNumber, 'Base Location'),
          getFieldValue(locals.employeesData, phoneNumber, 'Region'),
          getFieldValue(locals.employeesData, phoneNumber, 'Department'),
          momentTz().date(date).month(month).year(year).format(dateFormats.DATE),
          getSignUpDate({
            timezone,
            phoneNumber,
            employeesData: locals.employeesData,
            yesterdaysMonth: momentYesterday.month(),
          }),
          getType(el),
        ].forEach((value, innerIndex) => {
          payrollSheet
            .cell(`${alphabetsArray[innerIndex]}${rowIndex + 2}`)
            .value(value);
        });

        payrollSheet
          .cell(`J${rowIndex + 2}`)
          .value(el.statusForDay || '');

        if (!el.onAr
          && !el.onLeave
          && el.firstCheckInTimestamp
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

      const updatesFetch = rootCollections
        .updates
        .where('phoneNumber', '==', phoneNumber)
        .limit(1)
        .get();

      authFetchPromises
        .push(updatesFetch);
    });

  console.log('fetching updateDocsSnaps');

  const updateDocsSnaps = await Promise
    .all(authFetchPromises);

  console.log('fetched updateDocsSnaps');

  updateDocsSnaps
    .forEach(snap => {
      if (snap.empty) {
        return;
      }

      const doc = snap.docs[0];
      const phoneNumber = doc.get('phoneNumber');

      uidsMap
        .set(phoneNumber, doc.id);
    });

  if (writeAttendanceDocs) {
    const numberOfDocs = allPhoneNumbers.size + uidsMap.size;
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

    /**
     * Batch supports 500 docs simultaneously, but we are updating
     * two docs in a single batch, so some batches might get 501 docs
     * in a single instance. 498 updates at once fixes this issue.
     */
    const MAX_UPDATES = 498;

    allPhoneNumbers
      .forEach(phoneNumber => {
        const ref = (() => {
          if (attendanceUpdatesRefMap.has(phoneNumber)) {
            return attendanceUpdatesRefMap
              .get(phoneNumber);
          }

          return locals
            .officeDoc
            .ref
            .collection('Attendances')
            .doc(momentYesterday.format(dateFormats.MONTH_YEAR))
            .collection(phoneNumber)
            .doc(`${momentYesterday.date()}`);
        })();

        if (docsCounter > MAX_UPDATES) {
          docsCounter = 0;
          batchIndex++;
        }

        const batch = batchArray[
          batchIndex
        ];

        const update = {
          phoneNumber,
          date: momentYesterday.date(),
          month: momentYesterday.month(),
          year: momentYesterday.year(),
          holiday: holidaySet.has(phoneNumber),
          weeklyOff: weeklyOffSet.has(phoneNumber),
        };

        update
          .statusForDay = newStatusMap.get(phoneNumber) || 0;

        if (locals.employeesData[phoneNumber]) {
          update
            .branchName = locals.employeesData[phoneNumber]['Base Location'];
        }

        if (uidsMap.has(phoneNumber)) {
          const uid = uidsMap.get(phoneNumber);

          docsCounter++;

          batch
            .set(rootCollections.updates.doc(uid), {
              lastStatusDocUpdateTimestamp: Date.now()
            }, {
              merge: true,
            });
        }

        docsCounter++;

        batch.set(ref, update, {
          merge: true,
        });
      });

    await Promise
      .all(batchArray.map(batch => batch.commit()));
  }

  /**
   * Converting this set to an array in order to preserve
   * the order of the elements.
   * The summary sheet will use this order to put the dynamically generated
   * columns and their values.
   */
  allLeaveTypes = [...allLeaveTypes.values()];

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

  let summaryRowIndex = 0;

  allPhoneNumbers
    .forEach(phoneNumber => {
      const values = [
        getFieldValue(locals.employeesData, phoneNumber, 'Name'),
        phoneNumber,
        getFieldValue(locals.employeesData, phoneNumber, 'Employee Code'),
        getFieldValue(locals.employeesData, phoneNumber, 'Base Location'),
        getFieldValue(locals.employeesData, phoneNumber, 'Region'),
        getFieldValue(locals.employeesData, phoneNumber, 'Department'),
        arCountMap.get(phoneNumber) || 0, // ar count
        weeklyOffCountMap.get(phoneNumber) || 0, // weekly off count
        holidayCountMap.get(phoneNumber) || 0, // holiday count
        statusForDayMap.get(phoneNumber) || '', // MTD
        totalDays, // total days
        statusForDaySumMap.get(phoneNumber) || 0, // payable days
      ];

      const leaveTypesForUser = leaveTypesMap
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
