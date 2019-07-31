'use strict';

const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const {
  dateFormats,
  reportNames,
} = require('../../admin/constants');
const {
  alphabetsArray,
  dateStringWithOffset,
  getEmployeeDetailsString,
} = require('./report-utils');
const {
  db,
  rootCollections,
} = require('../../admin/admin');

const roundToNearestQuarter = number => {
  return Math.floor(number / 0.25) * 0.25;
};

const getDefaultStatusObject = () => ({
  onLeave: false,
  onAr: false,
  holiday: false,
  weeklyOff: false,
  firstCheckIn: '',
  lastCheckIn: '',
  statusForDay: 0,
  numberOfCheckIns: 0,
});

const getDatesBetween = (startMoment, endMoment) => {
  const cycleStart = startMoment.clone();
  const cycleEnd = endMoment.clone();
  const numberOfDays = endMoment.diff(cycleStart, 'days');
  const result = [];

  result
    .push({
      month: cycleEnd.month(),
      date: cycleEnd.date(),
      year: cycleEnd.year(),
      formattedDate: cycleEnd.format('D[-]MMM'),
      monthYear: cycleEnd.format(dateFormats.MONTH_YEAR),
    });

  for (let start = numberOfDays; start > 0; start--) {
    const interm = cycleEnd.subtract(1, 'day');

    result
      .push({
        date: interm.date(),
        month: interm.month(),
        year: interm.year(),
        formattedDate: interm.format('D[-]MMM'),
        monthYear: interm.format(dateFormats.MONTH_YEAR),
      });
  }

  return result;
};

const getPayDaySheetTopRow = allDates => {
  const topRowValues = [
    'Employee Name',
    'Employee Code',
    'Live Since',
  ];

  // Dates for curr and prev months
  allDates
    .forEach(dateItem => {
      topRowValues
        .push(dateItem.formattedDate);
    });

  topRowValues
    .push(
      'Total Payable Days',
      'Employee Details'
    );

  return topRowValues;
};

const getPaydayTimingsSheetValue = options => {
  const {
    statusObject,
    date,
  } = options;

  if (statusObject[date].onLeave) {
    return 'ON LEAVE';
  }

  if (statusObject[date].onAr) {
    return 'ON DUTY';
  }

  if (statusObject[date].weeklyOff) {
    return 'WEEKLY OFF';
  }

  if (statusObject[date].holiday) {
    return 'HOLIDAY';
  }

  if (!statusObject[date].firstCheckIn) {
    return `-- to --, ${statusObject[date].numberOfCheckIns || 0}`;
  }

  return `${statusObject[date].firstCheckIn}`
    + ` to`
    + ` ${statusObject[date].lastCheckIn},`
    + ` ${statusObject[date].numberOfCheckIns || 0}`;
};

const commitStatuses = (statusMap, momentYesterday, officeId) => {
  const dateYesterday = momentYesterday.date();
  const monthYearString = momentYesterday.format(dateFormats.MONTH_YEAR);
  const numberOfDocs = statusMap.size;
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

  statusMap.forEach((statusObject, phoneNumber) => {
    const ref = rootCollections
      .offices
      .doc(officeId)
      .collection('Statuses')
      .doc(monthYearString)
      .collection('Employees')
      .doc(phoneNumber);

    if (docsCounter > 499) {
      docsCounter = 0;
      batchIndex++;
    }

    docsCounter++;

    batchArray[batchIndex].set(ref, {
      statusObject: {
        [dateYesterday]: statusObject,
      },
    }, {
        merge: true,
      });
  });

  return Promise
    .all(batchArray.map(batch => batch.commit()));
};

const getPayDayTimingsTopRow = allDates => {
  const topRowValues = ['Employee Name'];

  allDates
    .forEach(dateItem => {
      topRowValues
        .push(dateItem.formattedDate);
    });

  return topRowValues;
};


module.exports = async locals => {
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const timestampFromTimer = locals
    .change
    .after
    .get('timestamp');
  const momentToday = momentTz(timestampFromTimer)
    .tz(timezone)
    .startOf('day');
  const momentYesterday = momentToday
    .clone()
    .subtract(1, 'day');
  const firstDayOfMonthlyCycle = locals
    .officeDoc
    .get('attachment.First Day Of Monthly Cycle.value') || 1;
  const fetchPreviousMonthDocs = firstDayOfMonthlyCycle < momentYesterday.date();
  const cycleStartMoment = (() => {
    if (fetchPreviousMonthDocs) {
      let start = momentYesterday
        .clone()
        .startOf('month')
        .date(firstDayOfMonthlyCycle);

      const isPrevMonth = firstDayOfMonthlyCycle > momentYesterday.date();

      if (isPrevMonth) {
        start = start.subtract(1, 'month');
      }

      return start;
    }

    return momentYesterday
      .clone()
      .date(firstDayOfMonthlyCycle);
  })();

  /** Just for better readability. */
  const cycleEndMoment = momentYesterday;
  const addendumQueryStart = momentYesterday
    .clone()
    .hours(5)
    .minutes(30)
    .valueOf();
  const addendumQueryEnd = momentToday
    .clone()
    .hours(5)
    .minutes(30)
    .valueOf();
  const allDates = getDatesBetween(cycleStartMoment, cycleEndMoment);
  const monthYearString = momentYesterday
    .format(dateFormats.MONTH_YEAR);
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

  if (fetchPreviousMonthDocs) {
    const prevMonth = momentYesterday
      .clone()
      .subtract(1, 'month')
      .format(dateFormats.MONTH_YEAR);
    const p = locals
      .officeDoc
      .ref
      .collection('Statuses')
      .doc(prevMonth)
      .collection('Employees')
      .get();

    promises.push(p);
  }

  const employeePhoneNumbers = Object.keys(locals.employeesData);
  /**
   * Employees who are on Leave, branch holiday and weekly off
   */
  const allowedToBeInactive = new Set();

  try {
    const [
      worksheet,
      statusObjectsCurrMonth,
      statusObjectsPrevMonth, // could be undefined
    ] = await Promise.all(promises);

    const paydaySheet = worksheet
      .addSheet(`PayDay_${momentYesterday.format(dateFormats.MONTH_YEAR)}`);
    const paydayTimingsSheet = worksheet
      .addSheet(`PayDay Timings_${momentYesterday.format(dateFormats.MONTH_YEAR)}`);

    paydaySheet
      .row(1)
      .style('bold', true);
    paydayTimingsSheet
      .row(1)
      .style('bold', true);

    getPayDaySheetTopRow(allDates)
      .forEach((value, index) => {
        paydaySheet
          .cell(`${alphabetsArray[index]}1`)
          .value(value);
      });

    getPayDayTimingsTopRow(allDates)
      .forEach((value, index) => {
        paydayTimingsSheet
          .cell(`${alphabetsArray[index]}1`)
          .value(value);
      });

    // removing the default sheet
    worksheet
      .deleteSheet('Sheet1');
    const dateYesterday = momentYesterday.date();

    statusObjectsCurrMonth.forEach(doc => {
      const phoneNumber = doc.id;
      const statusObject = doc.get('statusObject');

      statusObject[
        dateYesterday
      ] = statusObject[dateYesterday] || getDefaultStatusObject();

      if (statusObject[dateYesterday].onLeave
        || statusObject[dateYesterday].onAr
        || statusObject[dateYesterday].weeklyOff
        || statusObject[dateYesterday].holiday) {
        allowedToBeInactive.add(phoneNumber);
      }
    });

    const addendumPromises = [];
    const queryIndexeByPhoneNumber = [];
    const yesterdaysStatusMap = new Map();

    employeePhoneNumbers.forEach(phoneNumber => {
      if (allowedToBeInactive.has(phoneNumber)) {
        return;
      }

      const checkDistanceAccurate = locals
        .employeesData[phoneNumber]['Location Validation Check'] || '';

      let baseQuery = locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('timestamp', '>=', addendumQueryStart)
        .where('timestamp', '<', addendumQueryEnd);

      if (checkDistanceAccurate) {
        baseQuery = baseQuery
          .where('distanceAccurate', '==', true);
      }

      baseQuery = baseQuery
        .where('user', '==', phoneNumber)
        .orderBy('timestamp')
        .get();

      queryIndexeByPhoneNumber.push(phoneNumber);
      addendumPromises.push(baseQuery);
    });

    // const createData = momentTz()
    //   .format(dateFormats.DATE)
    //   === momentToday
    //     .format(dateFormats.DATE);

    const addendumDocSnapshots = await Promise.all(addendumPromises);

    addendumDocSnapshots.forEach((snap, index) => {
      const phoneNumber = queryIndexeByPhoneNumber[index];
      const numberOfCheckIns = snap.size;

      if (numberOfCheckIns === 0) {
        yesterdaysStatusMap.set(phoneNumber, getDefaultStatusObject());

        return;
      }

      const firstDoc = snap.docs[0];
      const lastDoc = snap.docs[snap.docs.length - 1];
      const firstActionTimestamp = firstDoc.get('timestamp');
      const lastActionTimestamp = lastDoc.get('timestamp');
      const hoursWorked = momentTz(lastActionTimestamp)
        .diff(firstActionTimestamp, 'hours');
      const minimumDailyActivityCount = locals
        .employeesData[phoneNumber]['Minimum Daily Activity Count'] || 1;
      const minimumWorkingHours = locals
        .employeesData[phoneNumber]['Minimum Working Hours'] || 1;

      const statusForDay = (() => {
        let activityRatio = numberOfCheckIns / minimumDailyActivityCount;

        if (activityRatio > 1) {
          activityRatio = 1;
        }

        /** Could be `undefined`, so ignoring further actions related it it */
        if (!minimumWorkingHours) {
          return activityRatio;
        }

        let workHoursRatio = hoursWorked / minimumWorkingHours;

        const minOfRatios = Math.min(activityRatio, workHoursRatio);
        const rev = 1 / minimumDailyActivityCount;

        if (minOfRatios <= rev) {
          return rev;
        }

        return Math.floor(minOfRatios / rev) * rev;
      })();

      const firstAction = momentTz(firstActionTimestamp)
        .tz(timezone)
        .format(dateFormats.TIME);
      const lastAction = momentTz(lastActionTimestamp)
        .tz(timezone)
        .format(dateFormats.TIME);

      yesterdaysStatusMap
        .set(phoneNumber, {
          numberOfCheckIns,
          firstCheckIn: firstAction,
          lastCheckIn: lastAction,
          firstCheckInTimestamp: firstActionTimestamp,
          lastCheckInTimestamp: lastActionTimestamp,
          weeklyOff: false,
          holiday: false,
          statusForDay: roundToNearestQuarter(statusForDay),
        });
    });

    await commitStatuses(
      yesterdaysStatusMap,
      momentYesterday,
      locals.officeDoc.id
    );

    const allDocs = []
      .concat(
        ((statusObjectsPrevMonth || []).docs) || [],
        statusObjectsCurrMonth.docs
      );

    const allPhoneNumbers = new Set();
    const statusObjectsMap = new Map();

    allDocs.forEach(doc => {
      const { path } = doc.ref;
      const parts = path.split('/');
      const monthYearString = parts[3];
      const phoneNumber = parts[parts.length - 1];

      if (!locals.employeesData[phoneNumber]) {
        return;
      }

      const { statusObject } = doc.data();

      allPhoneNumbers
        .add(phoneNumber);
      statusObjectsMap
        .set(`${phoneNumber}-${monthYearString}`, statusObject);
    });

    const monthYearString = momentYesterday.format(dateFormats.MONTH_YEAR);

    yesterdaysStatusMap.forEach((statusObjectForYesterday, phoneNumber) => {
      const oldStatusObject = statusObjectsMap.get(`${phoneNumber}-${monthYearString}`) || {};
      oldStatusObject[dateYesterday] = statusObjectForYesterday;

      statusObjectsMap.set(`${phoneNumber}-${monthYearString}`, oldStatusObject);
    });

    /** Set (`allPhoneNumbers`) doesn't have an index */
    let index = 0;

    allPhoneNumbers.forEach(phoneNumber => {
      const createTime = (() => {
        if (locals.employeesData[phoneNumber]) {
          return locals.employeesData[phoneNumber].createTime;
        }

        return '';
      })();
      const liveSince = dateStringWithOffset({
        timezone,
        timestampToConvert: createTime,
        format: dateFormats.DATE,
      });
      const name = (() => {
        if (locals.employeesData[phoneNumber]) {
          return locals.employeesData[phoneNumber].Name;
        }

        return phoneNumber;
      })();
      const employeeCode = (() => {
        if (locals.employeesData[phoneNumber]) {
          return locals.employeesData[phoneNumber]['Employee Code'];
        }

        return '';
      })();

      const columnIndex = index + 2;

      paydaySheet
        .cell(`A${columnIndex}`)
        .value(name);
      paydaySheet
        .cell(`B${columnIndex}`)
        .value(employeeCode);
      paydaySheet
        .cell(`C${columnIndex}`)
        .value(liveSince);
      paydayTimingsSheet
        .cell(`A${columnIndex}`)
        .value(name);

      let totalCount = 0;
      let paydaySheetAlphabetIndex = 3;
      let paydayTimingsSheetIndex = 1;

      allDates.forEach(dateObject => {
        const {
          date,
          monthYear,
        } = dateObject;
        const statusObject = statusObjectsMap.get(`${phoneNumber}-${monthYear}`) || {};
        const paydaySheetCell = `${alphabetsArray[paydaySheetAlphabetIndex]}${columnIndex}`;
        const paydayTimingsSheetCell = `${alphabetsArray[paydayTimingsSheetIndex]}${columnIndex}`;

        statusObject[date] = statusObject[date] || getDefaultStatusObject();

        const paydaySheetValue = (() => {
          if (date === dateYesterday
            && monthYear === monthYearString) {
            return (yesterdaysStatusMap.get(phoneNumber) || {}).statusForDay || 0;
          }

          return statusObject[date].statusForDay || 0;
        })();

        paydaySheet
          .cell(paydaySheetCell)
          .value(paydaySheetValue);
        paydayTimingsSheet
          .cell(paydayTimingsSheetCell)
          .value(getPaydayTimingsSheetValue({ statusObject, date }));

        paydaySheetAlphabetIndex++;
        paydayTimingsSheetIndex++;
        totalCount += paydaySheetValue;
      });

      paydaySheet
        .cell(`${alphabetsArray[paydaySheetAlphabetIndex++]}${columnIndex}`)
        .value(totalCount);
      paydaySheet
        .cell(`${alphabetsArray[paydaySheetAlphabetIndex++]}${columnIndex}`)
        .value(getEmployeeDetailsString(locals.employeesData, phoneNumber));

      index++;
    });

    locals
      .messageObject
      .attachments
      .push({
        fileName: `Payroll Report_`
          + `${locals.officeDoc.get('office')}`
          + `_${momentToday.format(dateFormats.DATE)}.xlsx`,
        content: await worksheet.outputAsync('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

    console.log(JSON.stringify({
      office: locals.officeDoc.get('office'),
      report: reportNames.PAYROLL,
      to: locals.messageObject.to,
    }, ' ', 2));

    return locals
      .sgMail
      .sendMultiple(locals.messageObject);
  } catch (error) {
    console.error(error);
  }
};
