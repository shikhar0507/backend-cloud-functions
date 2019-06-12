'use strict';

const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const {
  dateFormats,
  reportNames,
} = require('../../admin/constants');
const {
  monthsArray,
  weekdaysArray,
  alphabetsArray,
  dateStringWithOffset,
  getEmployeeDetailsString,
} = require('./report-utils');
const {
  db,
} = require('../../admin/admin');

const msToTime = (duration) => {
  if (!duration || isNaN(duration)) {
    return `00:00`;
  }

  let minutes = Math.floor((duration / (1000 * 60)) % 60);
  let hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

  hours = (hours < 10) ? '0' + hours : hours;
  minutes = (minutes < 10) ? '0' + minutes : minutes;

  return `${hours}:${minutes}`;
};

const getPayDaySheetTopRow = (momentYesterday) => {
  const topRowValues = [
    'Employee Name',
    'Employee Code',
    'Gender',
    'Live Since',
  ];

  const monthName = monthsArray[momentYesterday.month()];

  for (let dayNumber = momentYesterday.date(); dayNumber >= 1; dayNumber--) {
    topRowValues.push(`${monthName}-${dayNumber}`);
  }

  topRowValues.push('Total', 'Employee Details');

  return topRowValues;
};

const getPayDayTimingsTopRow = (momentYesterday) => {
  const topRowValues = ['Employee Name'];
  const monthName = monthsArray[momentYesterday.month()];

  for (let dayNumber = momentYesterday.date(); dayNumber >= 1; dayNumber--) {
    topRowValues.push(`${monthName}-${dayNumber}`);
  }

  topRowValues.push(
    'Days With Deductions',
    'Total Deductions'
  );

  return topRowValues;
};


const getDefaultStatusObject = () => ({
  onLeave: false,
  onDuty: false,
  holiday: false,
  weeklyOff: false,
  firstCheckIn: '',
  lastCheckIn: '',
  statusForDay: 0,
  numberOfCheckIns: 0,
});

const executeSequentially = (batchFactories) => {
  let result = Promise.resolve();

  batchFactories.forEach((factory, index) => {
    result = result
      .then(factory)
      .then(() => console.log('committed index', index))
      .catch(error => console.error('BatchError:', error));
  });

  return result;
};

const commitMultiBatch = (statusObjectsMap, docRefsMap, momentYesterday) => {
  const batchesArray = [];
  let batchDocsCount = 0;
  let currentBatchIndex = 0;
  const batchFactories = [];
  const month = momentYesterday.month();
  const year = momentYesterday.year();

  statusObjectsMap.forEach((statusObject, phoneNumber) => {
    const ref = docRefsMap.get(phoneNumber);
    const batch = (() => {
      const batchPart = db.batch();

      if (batchesArray.length === 0) {
        batchesArray.push(batchPart);
      }

      if (batchDocsCount > 499) {
        // reset count
        batchDocsCount = 0;
        batchesArray.push(batchPart);

        currentBatchIndex++;
        batchFactories.push(() => batchPart.commit());
      }

      return batchesArray[currentBatchIndex];
    })();

    batchDocsCount++;

    batch.set(ref, {
      statusObject,
      phoneNumber,
      month,
      year,
    }, {
        merge: true,
      });
  });

  if (batchesArray.length === 1) {
    return batchesArray[0].commit();
  }

  return executeSequentially(batchFactories);
};


module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const timestampFromTimer = locals.change.after.get('timestamp');
  const momentToday = momentTz(timestampFromTimer).tz(timezone);
  // Don't modify the original momentToday object
  const momentYesterday = momentToday.clone().subtract(1, 'day').startOf('day');
  const employeesData = locals.employeesData;
  const employeePhoneNumbersList = Object.keys(employeesData);
  const yesterdayDate = momentYesterday.date();
  const yesterdayStartTimestamp = momentYesterday.startOf('day').valueOf();
  const yesterdayEndTimestamp = momentYesterday.endOf('day').valueOf();
  const docRefsMap = new Map();
  const checkinPromises = [];
  /** Stores the phone number at the index with checkIn query */
  const checkInQueryIndexex = [];
  const onLeaveSet = new Set();
  const onDutySet = new Set();
  const branchesWithHoliday = new Set();
  const branchHolidaySet = new Set();
  const statusObjectsMap = new Map();
  const leavesSet = new Set();
  const weeklyOffSet = new Set();
  const monthlyDocsToDelete = db.batch();

  console.log({
    momentToday: momentToday.format(dateFormats.DATE),
    momentYesterday: momentYesterday.format(dateFormats.DATE),
  });

  const toDelete = [];

  let paydaySheet;
  let paydayTimingsSheet;

  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Monthly')
        .where('month', '==', momentYesterday.month())
        .where('year', '==', momentYesterday.year())
        .get(),
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'branch')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then(result => {
      const [
        monthlyDocsQuery,
        branchDocsQuery,
        worksheet,
      ] = result;

      console.log('Docs read:', monthlyDocsQuery.size);

      monthlyDocsQuery.forEach(doc => {
        const { phoneNumber, statusObject } = doc.data();

        if (!employeesData[phoneNumber]) {
          monthlyDocsToDelete.delete(doc.ref);
          toDelete.push(phoneNumber);

          return;
        }

        docRefsMap.set(phoneNumber, doc.ref);
        statusObject[yesterdayDate] = statusObject[yesterdayDate] || getDefaultStatusObject();
        statusObjectsMap.set(phoneNumber, statusObject);
      });

      console.log('toDelete', JSON.stringify(toDelete));

      branchDocsQuery.forEach(branchDoc => {
        branchDoc.get('schedule').forEach(schedule => {
          // Yesterday's date doesn't belong to a branch holiday
          if (schedule.startTime < yesterdayStartTimestamp
            || schedule.endTime > yesterdayEndTimestamp) {
            return;
          }

          branchesWithHoliday.add(branchDoc.get('attachment.Name.value'));
        });
      });

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

      paydaySheet.row(1).style('bold', true);
      paydayTimingsSheet.row(1).style('bold', true);

      getPayDaySheetTopRow(momentYesterday).forEach((value, index) => {
        paydaySheet.cell(`${alphabetsArray[index]}1`).value(value);
      });
      getPayDayTimingsTopRow(momentYesterday).forEach((value, index) => {
        paydayTimingsSheet.cell(`${alphabetsArray[index]}1`).value(value);
      });

      // removing the default sheet
      worksheet.deleteSheet('Sheet1');

      employeePhoneNumbersList.forEach(phoneNumber => {
        if (!docRefsMap.has(phoneNumber)) {
          docRefsMap.set(phoneNumber, locals.officeDoc.ref.collection('Monthly').doc());
        }

        const statusObject = statusObjectsMap.get(phoneNumber);
        const checkDistanceAccurate = employeesData[phoneNumber]['Location Validation Check'];

        if (!statusObject[yesterdayDate]) {
          statusObject[yesterdayDate] = getDefaultStatusObject();
        }

        /** Base Location is a branch */
        if (branchesWithHoliday.has(employeesData[phoneNumber]['Base Location'])) {
          statusObject[yesterdayDate].holiday = true;
          branchHolidaySet.add(phoneNumber);
        }

        const weeklyOffWeekdayName = employeesData[phoneNumber]['Weekly Off'];
        const weekdayName = weekdaysArray[momentYesterday.day()];

        if (weeklyOffWeekdayName === weekdayName) {
          statusObject[yesterdayDate].weeklyOff = true;
          weeklyOffSet.add(phoneNumber);
        }

        statusObjectsMap.set(phoneNumber, statusObject);

        /**
         * People with status equaling to `leave`, `branch holiday`,
         * `weekly off` or `on duty` don't need their `check-ins`
         * brought in because all the statuses have higher priority.
         */
        if (leavesSet.has(phoneNumber)
          || branchHolidaySet.has(phoneNumber)
          || weeklyOffSet.has(phoneNumber)
          || onDutySet.has(phoneNumber)) {

          return;
        }

        checkInQueryIndexex.push(phoneNumber);

        /**
         * INDEXED: template Ascending timestamp Ascending
         */
        let baseQuery = locals
          .officeDoc
          .ref
          .collection('Addendum')
          .where('template', '==', 'check-in')
          .where('date', '==', yesterdayDate)
          .where('month', '==', momentYesterday.month())
          .where('year', '==', momentYesterday.year())
          .where('user', '==', phoneNumber);

        if (checkDistanceAccurate) {
          baseQuery = baseQuery
            .where('distanceAccurate', '==', true);
        }

        checkinPromises.push(
          baseQuery
            // Ascending is required in order to get the first
            // checkIn in the first position and the last checkIn
            // in the last position of the query result.
            .orderBy('timestamp', 'asc')
            .get()
        );
      });

      return Promise.all(checkinPromises);
    })
    .then(snapShots => {
      snapShots.forEach((snapShot, index) => {
        const phoneNumber = checkInQueryIndexex[index];
        const statusObject = statusObjectsMap.get(phoneNumber);

        statusObject[yesterdayDate].numberOfCheckIns = snapShot.size;

        /** Number of checkins is 0 */
        if (snapShot.empty) {
          statusObject[yesterdayDate].blank = true;
          // The person did nothing
          statusObject[yesterdayDate].statusForDay = 0;
          statusObjectsMap.set(phoneNumber, statusObject);

          return;
        }

        const firstCheckInTimestamp = snapShot.docs[0].get('timestamp');
        const lastCheckInTimestamp = snapShot.docs[snapShot.size - 1].get('timestamp');

        if (!statusObject[yesterdayDate]) {
          statusObject[yesterdayDate] = getDefaultStatusObject();
          statusObjectsMap.set(phoneNumber, statusObject);
        }

        statusObject[yesterdayDate].firstCheckInTimestamp = firstCheckInTimestamp;
        statusObject[yesterdayDate].lastCheckInTimestamp = lastCheckInTimestamp;

        statusObject[yesterdayDate].firstCheckIn = dateStringWithOffset({
          timezone,
          timestampToConvert: firstCheckInTimestamp,
          format: dateFormats.TIME,
        });
        statusObject[yesterdayDate].lastCheckIn = dateStringWithOffset({
          timezone,
          timestampToConvert: lastCheckInTimestamp,
          format: dateFormats.TIME,
        });

        const minimumDailyActivityCount = employeesData[phoneNumber]['Minimum Daily Activity Count'] || 1;

        statusObject[yesterdayDate].statusForDay = (() => {
          let result = snapShot.size / minimumDailyActivityCount;

          if (result > 1
            || onLeaveSet.has(phoneNumber)
            || onDutySet.has(phoneNumber)
            || weeklyOffSet.has(phoneNumber)
            || branchHolidaySet.has(phoneNumber)) {
            result = 1;
          }

          return result;
        })();

        /** Updating the map after updating the status object */
        statusObjectsMap.set(phoneNumber, statusObject);
      });

      return commitMultiBatch(statusObjectsMap, docRefsMap, momentYesterday);
    })
    .then(() => {
      if (yesterdayDate !== 5) {
        return Promise.resolve();
      }

      // Clearing removed employees on 5th of the month
      return monthlyDocsToDelete.commit();
    })
    .then(() => {
      if (locals.createOnlyData) {
        locals.sendMail = false;
      }

      if (!locals.sendMail) {
        return Promise.resolve({});
      }

      employeePhoneNumbersList.forEach((phoneNumber, index) => {
        const statusObject = statusObjectsMap.get(phoneNumber);
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
          .value(employeesData[phoneNumber].Gender || '');
        paydaySheet
          .cell(`D${columnIndex}`)
          .value(liveSince);

        paydayTimingsSheet
          .cell(`A${columnIndex}`)
          .value(employeesData[phoneNumber].Name);

        let totalCount = 0;
        let paydaySheetAlphabetIndex = 4;
        let paydayTimingsSheetIndex = 1;
        let daysWithDeductionsCount = 0;

        for (let date = yesterdayDate; date >= 1; date--) {
          const paydaySheetCell = `${alphabetsArray[paydaySheetAlphabetIndex]}${columnIndex}`;
          const paydayTimingsSheetCell = `${alphabetsArray[paydayTimingsSheetIndex]}${columnIndex}`;

          // Fallback for the case where an employee is added in the middle of the month
          statusObject[date] = statusObject[date] || getDefaultStatusObject();

          const paydaySheetValue = (() => {
            if (statusObject[date].onLeave
              || statusObject[date].onDuty
              || statusObject[date].weeklyOff
              || statusObject[date].holiday) {
              return 1;
            }

            return statusObject[date].statusForDay || 0;
          })();

          const getPaydayTimingsSheetValue = () => {
            if (statusObject[date].onLeave) {
              return 'ON LEAVE';
            }

            if (statusObject[date].onDuty) {
              return 'ON DUTY';
            }

            if (statusObject[date].weeklyOff) {
              return 'WEEKLY OFF';
            }

            if (statusObject[date].holiday) {
              return 'HOLIDAY';
            }

            const firstCheckInTimestamp = statusObject[date].firstCheckInTimestamp;
            const lastCheckInTimestamp = statusObject[date].lastCheckInTimestamp;
            const minimumWorkingHours = employeesData[phoneNumber]['Minimum Working Hours'] || 0;
            const minimumDailyActivityCount = employeesData[phoneNumber]['Minimum Daily Activity Count'] || 1;
            const adjustedFirstCheckIn = momentTz(firstCheckInTimestamp).tz(timezone);
            const adjustedLastCheckIn = momentTz(lastCheckInTimestamp).tz(timezone);
            const checkInDiffInHours = adjustedLastCheckIn.diff(adjustedFirstCheckIn, 'hours', true);
            const hoursWorked = msToTime(lastCheckInTimestamp - firstCheckInTimestamp);

            // Checkins difference between the first and the last checkin is < than the
            // expected hours
            if (!statusObject[date].firstCheckIn
              || (checkInDiffInHours < minimumWorkingHours)
              || (statusObject[date].numberOfCheckIns < minimumDailyActivityCount)) {
              daysWithDeductionsCount++;

              return `Hours Worked:`
                + ` ${hoursWorked}.`
                + ` Number of Check-ins: ${statusObject[date].numberOfCheckIns || 0}`;
            }

            return `Hours Worked:`
              + ` ${hoursWorked}.`
              + ` ${statusObject[`${date}`].firstCheckIn} | ${statusObject[date].lastCheckIn}`;
          };

          totalCount += paydaySheetValue;

          paydaySheet
            .cell(paydaySheetCell)
            .value(paydaySheetValue);
          paydayTimingsSheet
            .cell(paydayTimingsSheetCell)
            .value(getPaydayTimingsSheetValue());

          paydaySheetAlphabetIndex++;
          paydayTimingsSheetIndex++;
        }

        paydaySheet
          .cell(`${alphabetsArray[paydaySheetAlphabetIndex++]}${columnIndex}`)
          .value(totalCount);
        paydaySheet
          .cell(`${alphabetsArray[paydaySheetAlphabetIndex++]}${columnIndex}`)
          .value(getEmployeeDetailsString(employeesData, phoneNumber));

        paydayTimingsSheet
          .cell(`${alphabetsArray[paydayTimingsSheetIndex++]}${columnIndex}`)
          .value(daysWithDeductionsCount);
        paydayTimingsSheet
          .cell(`${alphabetsArray[paydayTimingsSheetIndex++]}${columnIndex}`)
          // Total Deductions
          .value(yesterdayDate - totalCount);
      });

      return locals.worksheet.outputAsync('base64');
    })
    .then(content => {
      if (!locals.sendMail) {
        return Promise.resolve({});
      }

      const fullDateString = momentToday.format(dateFormats.DATE);

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

      // return locals.sgMail.sendMultiple(locals.messageObject);

      return locals
        .worksheet
        .toFileAsync(`/tmp/${fileName}`);
    })
    .catch(console.error);
};
