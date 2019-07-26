'use strict';

const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const {
  dateFormats,
  reportNames,
} = require('../../admin/constants');
const {
  weekdaysArray,
  alphabetsArray,
  dateStringWithOffset,
  getEmployeeDetailsString,
} = require('./report-utils');
const {
  db,
} = require('../../admin/admin');

const roundToNearestQuarter = number => Math.floor(number / 0.25) * 0.25;

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

const commitMultiBatch = (statusObjectsMap, docRefsMap, momentYesterday) => {
  const month = momentYesterday
    .month();
  const year = momentYesterday
    .year();
  let docsCounter = 0;
  const numberOfDocs = statusObjectsMap.size;
  const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
  const numberOfBatches = Math
    .round(
      Math
        .ceil(numberOfDocs / MAX_DOCS_ALLOWED_IN_A_BATCH)
    );
  const batchArray = Array
    .from(Array(numberOfBatches)).map(() => db.batch());
  let batchIndex = 0;
  const data = {};

  statusObjectsMap
    .forEach((statusObject, phoneNumber) => {
      const ref = docRefsMap.get(phoneNumber);

      if (docsCounter > 499) {
        console.log('reset batch...');
        docsCounter = 0;
        batchIndex++;
      }

      docsCounter++;

      if (data[batchIndex]) {
        data[batchIndex].count = docsCounter;
      } else {
        data[batchIndex] = { count: docsCounter };
      }

      batchArray[batchIndex].set(ref, {
        phoneNumber,
        month,
        year,
        statusObject,
      }, {
          merge: true,
        });
    });

  console.log('BatchCounter', data);

  return Promise
    .all(batchArray.map(batch => batch.commit()));
};

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
    });

  for (let start = numberOfDays; start > 0; start--) {
    const interm = cycleEnd.subtract(1, 'day');

    result
      .push({
        date: interm.date(),
        month: interm.month(),
        year: interm.year(),
        formattedDate: interm.format('D[-]MMM'),
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

const getPayDayTimingsTopRow = allDates => {
  const topRowValues = ['Employee Name'];

  allDates
    .forEach(dateItem => {
      topRowValues
        .push(dateItem.formattedDate);
    });

  return topRowValues;
};

const getPaydayTimingsSheetValue = (statusObject, date) => {
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


module.exports = locals => {
  const office = locals
    .officeDoc
    .get('office');
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const timestampFromTimer = locals
    .change
    .after
    .get('timestamp');
  const momentToday = momentTz(timestampFromTimer)
    .tz(timezone);
  /** 'NOTE': Don't modify the original momentToday object */
  const momentYesterday = momentToday
    .clone()
    .subtract(1, 'day')
    .startOf('day');
  const employeesData = locals.employeesData;
  const employeePhoneNumbersList = Object
    .keys(employeesData);
  const yesterdayDate = momentYesterday
    .date();
  const yesterdayStartTimestamp = momentYesterday
    .startOf('day')
    .valueOf();
  const yesterdayEndTimestamp = momentYesterday
    .endOf('day')
    .valueOf();
  const docRefsMap = new Map();
  const checkinPromises = [];
  /** Stores the phone number at the index with checkIn query */
  const checkInQueryIndex = [];
  const onLeaveSet = new Set();
  const onArSet = new Set();
  const branchesWithHoliday = new Set();
  const branchHolidaySet = new Set();
  const statusObjectsMapForCurrentMonth = new Map();
  const statusObjectsMapForPreviousMonth = new Map();
  const leavesSet = new Set();
  const weeklyOffSet = new Set();
  const firstDayOfMonthlyCycle = locals
    .officeDoc
    .get('attachment.First Day Of Monthly Cycle.value') || 1;

  /**
   * Yesterday's date is before the previous cycle start
   * We will have to fetch docs for the current and previous month
   * since the docs are created by Month for each employee.
   */
  const fetchPreviousMonthDocs = firstDayOfMonthlyCycle !== 1;
  const cycleStartMoment = (() => {
    if (fetchPreviousMonthDocs) {
      return momentYesterday
        .clone()
        .subtract(1, 'month')
        .startOf('month')
        .date(firstDayOfMonthlyCycle);
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
  let paydaySheet;
  let paydayTimingsSheet;
  let prevMonthDocs;

  const promises = [
    xlsxPopulate
      .fromBlankAsync(),
    locals
      .officeDoc
      .ref
      .collection('Activities')
      .where('template', '==', 'branch')
      .get(),
    locals
      .officeDoc
      .ref
      .collection('Monthly')
      .where('month', '==', momentYesterday.month())
      .where('year', '==', momentYesterday.year())
      .get()
  ];

  if (fetchPreviousMonthDocs) {
    promises
      .push(locals
        .officeDoc
        .ref
        .collection('Monthly')
        .where('month', '==', cycleStartMoment.month())
        .where('year', '==', cycleStartMoment.year())
        .get()
      );
  }

  return Promise
    .all(promises)
    .then(result => {
      const [
        worksheet,
        branchDocsQuery,
        monthlyDocsQuery,
        optionalMonthyMinus1Query, // This could be undefined
      ] = result;

      prevMonthDocs = optionalMonthyMinus1Query ? optionalMonthyMinus1Query.docs : null;

      if (prevMonthDocs) {
        prevMonthDocs
          .forEach(doc => {
            const {
              statusObject,
              phoneNumber,
            } = doc.data();

            statusObjectsMapForPreviousMonth
              .set(
                phoneNumber,
                statusObject
              );
          });
      }

      locals
        .worksheet = worksheet;
      paydaySheet = worksheet
        .addSheet(
          `PayDay_${momentYesterday.format(dateFormats.MONTH_YEAR)}`
        );
      paydayTimingsSheet = worksheet
        .addSheet(
          `PayDay Timings_${momentYesterday.format(dateFormats.MONTH_YEAR)}`
        );

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

      monthlyDocsQuery
        .forEach(doc => {
          const {
            phoneNumber,
            statusObject,
          } = doc.data();

          if (!employeesData[phoneNumber]) {
            return;
          }

          docRefsMap
            .set(
              phoneNumber,
              doc.ref
            );

          statusObject[
            yesterdayDate
          ] = statusObject[yesterdayDate] || getDefaultStatusObject();

          statusObjectsMapForCurrentMonth
            .set(
              phoneNumber,
              statusObject
            );
        });

      branchDocsQuery
        .forEach(branchDoc => {
          const scheduleArray = branchDoc.get('schedule');

          scheduleArray
            .forEach(schedule => {
              // Yesterday's date doesn't belong to a branch holiday
              if (schedule.startTime < yesterdayStartTimestamp
                || schedule.endTime > yesterdayEndTimestamp) {
                return;
              }

              const branchName = branchDoc
                .get('attachment.Name.value');

              branchesWithHoliday
                .add(branchName);
            });
        });

      employeePhoneNumbersList
        .forEach(phoneNumber => {
          if (!docRefsMap.has(phoneNumber)) {
            docRefsMap.set(
              phoneNumber,
              locals
                .officeDoc
                .ref
                .collection('Monthly')
                .doc()
            );
          }

          const statusObject = statusObjectsMapForCurrentMonth
            .get(phoneNumber) || {};
          const checkDistanceAccurate =
            employeesData[phoneNumber]['Location Validation Check'];

          statusObject[yesterdayDate] =
            statusObject[yesterdayDate] || getDefaultStatusObject();

          const employeeBaseLocation =
            employeesData[phoneNumber]['Base Location'];

          /** Base Location is a branch */
          if (branchesWithHoliday.has(employeeBaseLocation)) {
            statusObject[
              yesterdayDate
            ].holiday = true;

            statusObject[
              yesterdayDate
            ].statusForDay = 1;

            branchHolidaySet
              .add(phoneNumber);
          }

          const weeklyOffWeekdayName =
            employeesData[phoneNumber]['Weekly Off'];
          const weekdayName = weekdaysArray[momentYesterday.day()];

          if (weeklyOffWeekdayName === weekdayName) {
            statusObject[
              yesterdayDate
            ].weeklyOff = true;

            statusObject[
              yesterdayDate
            ].statusForDay = 1;

            weeklyOffSet
              .add(phoneNumber);
          }

          statusObjectsMapForCurrentMonth
            .set(
              phoneNumber,
              statusObject
            );

          /**
           * People with status set to `leave`, `branch holiday`,
           * `weekly off` or `on duty` don't need their `check-ins`
           * brought in a status with a higher priority has already been
           * set for them.
           */
          if (leavesSet.has(phoneNumber)
            || branchHolidaySet.has(phoneNumber)
            || weeklyOffSet.has(phoneNumber)
            || onArSet.has(phoneNumber)) {

            return;
          }

          checkInQueryIndex
            .push(phoneNumber);

          // TODO: Delete index `template` Ascending `timestamp` Ascending
          // That was used in old payroll code.
          let baseQuery = locals
            .officeDoc
            .ref
            .collection('Addendum')
            /** Queries from 5:30 yesterday to 5:30 today */
            .where('timestamp', '>=', addendumQueryStart)
            .where('timestamp', '<', addendumQueryEnd);

          if (checkDistanceAccurate) {
            baseQuery = baseQuery
              .where('distanceAccurate', '==', true);
          }

          checkinPromises
            .push(
              baseQuery
                .where('user', '==', phoneNumber)
                .orderBy('timestamp', 'asc')
                .get()
            );
        });

      return Promise
        .all(checkinPromises);
    })
    .then(snapShots => {
      snapShots
        .forEach((snapShot, index) => {
          const phoneNumber = checkInQueryIndex[index];
          const statusObject = statusObjectsMapForCurrentMonth
            .get(phoneNumber);
          const numberOfActionsInTheDay = snapShot.size;

          statusObject[
            yesterdayDate
          ].numberOfCheckIns = numberOfActionsInTheDay;

          /** Number of checkins is 0 */
          if (numberOfActionsInTheDay === 0) {
            statusObject[
              yesterdayDate
            ].blank = true;
            // The person did nothing
            statusObject[
              yesterdayDate
            ].statusForDay = 0;

            statusObjectsMapForCurrentMonth
              .set(
                phoneNumber,
                statusObject
              );

            return;
          }

          const firstCheckInTimestamp =
            snapShot
              .docs[0]
              .get('timestamp');
          const lastDocIndex = numberOfActionsInTheDay - 1;
          const lastCheckInTimestamp =
            snapShot
              .docs[lastDocIndex]
              .get('timestamp');

          statusObject[yesterdayDate] =
            statusObject[
            yesterdayDate
            ] || getDefaultStatusObject();

          statusObjectsMapForCurrentMonth
            .set(
              phoneNumber,
              statusObject
            );

          statusObject[
            yesterdayDate
          ].firstCheckInTimestamp = firstCheckInTimestamp;
          statusObject[
            yesterdayDate
          ].lastCheckInTimestamp = lastCheckInTimestamp;
          statusObject[
            yesterdayDate
          ].firstCheckIn = dateStringWithOffset({
            timezone,
            timestampToConvert: firstCheckInTimestamp,
            format: dateFormats.TIME,
          });
          statusObject[
            yesterdayDate
          ].lastCheckIn = dateStringWithOffset({
            timezone,
            timestampToConvert: lastCheckInTimestamp,
            format: dateFormats.TIME,
          });

          const hoursWorked =
            momentTz(lastCheckInTimestamp)
              .diff(firstCheckInTimestamp, 'hours');
          const minimumWorkingHours =
            employeesData[phoneNumber]['Minimum Working Hours'];
          const minimumDailyActivityCount =
            /**
             * Division by undefined (= NaN) might result in unexpected
             * values in the final excel sheet
             */
            employeesData[phoneNumber]['Minimum Daily Activity Count'] || 1;

          statusObject[
            yesterdayDate
          ].statusForDay = (() => {
            if (onLeaveSet.has(phoneNumber)
              || onArSet.has(phoneNumber)
              || weeklyOffSet.has(phoneNumber)
              || branchHolidaySet.has(phoneNumber)) {
              return 1;
            }

            let activityRatio = numberOfActionsInTheDay / minimumDailyActivityCount;

            if (activityRatio > 1) {
              activityRatio = 1;
            }

            /** Could be `undefined`, so ignoring further actions related it it */
            if (!minimumWorkingHours) {
              return activityRatio;
            }

            let workHoursRatio = hoursWorked / minimumWorkingHours;

            if (workHoursRatio > 1) {
              workHoursRatio = 1;
            }

            return activityRatio > workHoursRatio ? workHoursRatio : activityRatio;
          })();

          statusObject[
            yesterdayDate
          ].statusForDay = roundToNearestQuarter(
            statusObject[yesterdayDate].statusForDay
          );

          if (minimumDailyActivityCount) {
            const rev = 1 / minimumDailyActivityCount;

            if (statusObject[yesterdayDate].statusForDay <= rev) {
              return statusObject[yesterdayDate].statusForDay = rev;
            } else {
              statusObject[
                yesterdayDate
              ].statusForDay = Math
                .floor(statusObject[yesterdayDate].statusForDay / rev) * rev;
            }
          }

          if (statusObject[yesterdayDate].statusForDay > 1) {
            statusObject[
              yesterdayDate
            ].statusForDay = 1;
          }

          /** Updating the map after updating the status object */
          statusObjectsMapForCurrentMonth
            .set(
              phoneNumber,
              statusObject
            );
        });

      return commitMultiBatch(
        statusObjectsMapForCurrentMonth,
        docRefsMap,
        momentYesterday
      );
    })
    .then(() => {
      if (locals.createOnlyData) {
        locals
          .sendMail = false;
      }

      if (!locals.sendMail) {
        return Promise
          .resolve();
      }

      const prevMonth = cycleStartMoment
        .month();

      employeePhoneNumbersList
        .forEach((phoneNumber, index) => {
          const columnIndex = index + 2;
          const liveSince = dateStringWithOffset({
            timezone,
            timestampToConvert: employeesData[phoneNumber].createTime,
            format: dateFormats.DATE,
          });

          paydaySheet
            .cell(`A${columnIndex}`)
            .value(employeesData[phoneNumber].Name);
          paydaySheet
            .cell(`B${columnIndex}`)
            .value(employeesData[phoneNumber]['Employee Code']);
          paydaySheet
            .cell(`C${columnIndex}`)
            .value(liveSince);
          paydayTimingsSheet
            .cell(`A${columnIndex}`)
            .value(employeesData[phoneNumber].Name);

          let totalCount = 0;
          let paydaySheetAlphabetIndex = 3;
          let paydayTimingsSheetIndex = 1;

          allDates
            .forEach(item => {
              const { month, date } = item;

              const statusObject = (() => {
                if (fetchPreviousMonthDocs
                  && month === prevMonth) {
                  return statusObjectsMapForPreviousMonth
                    .get(phoneNumber) || {};
                }

                return statusObjectsMapForCurrentMonth
                  .get(phoneNumber) || {};
              })();
              const paydaySheetCell =
                `${alphabetsArray[paydaySheetAlphabetIndex]}${columnIndex}`;
              const paydayTimingsSheetCell =
                `${alphabetsArray[paydayTimingsSheetIndex]}${columnIndex}`;

              // Fallback for the case where an employee is added in the middle of the month
              statusObject[
                date
              ] = statusObject[date] || getDefaultStatusObject();

              const paydaySheetValue = (() => {
                if (statusObject[date].onLeave
                  || statusObject[date].onAr
                  || statusObject[date].weeklyOff
                  || statusObject[date].holiday) {
                  return 1;
                }

                return statusObject[
                  date
                ].statusForDay || 0;
              })();

              totalCount += paydaySheetValue;

              paydaySheet
                .cell(paydaySheetCell)
                .value(paydaySheetValue);

              paydayTimingsSheet
                .cell(paydayTimingsSheetCell)
                .value(getPaydayTimingsSheetValue(statusObject, date));

              paydaySheetAlphabetIndex++;
              paydayTimingsSheetIndex++;
            });

          paydaySheet
            .cell(`${alphabetsArray[paydaySheetAlphabetIndex++]}${columnIndex}`)
            .value(totalCount);
          paydaySheet
            .cell(`${alphabetsArray[paydaySheetAlphabetIndex++]}${columnIndex}`)
            .value(getEmployeeDetailsString(employeesData, phoneNumber));
        });

      return locals
        .worksheet
        .outputAsync('base64');
    })
    .then(content => {
      if (!locals.sendMail) {
        return Promise
          .resolve();
      }

      const fullDateString = momentToday
        .format(dateFormats.DATE);

      locals
        .messageObject['dynamic_template_data'] = {
          office,
          date: fullDateString,
          subject: `Payroll Report_${office}_${fullDateString}`,
        };

      const fileName = `Payroll Report_${office}_${fullDateString}.xlsx`;

      locals
        .messageObject
        .attachments
        .push({
          fileName,
          content,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log({
        office,
        report: reportNames.PAYROLL,
        to: locals.messageObject.to,
      });

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
