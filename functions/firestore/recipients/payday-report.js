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
  // getEmployeeDetailsString,
} = require('./report-utils');
const {
  db,
} = require('../../admin/admin');



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

  topRowValues.push('Employee Details');

  return topRowValues;
};

const getPayDayTimingsTopRow = (momentYesterday) => {
  const topRowValues = ['Employee Name'];
  const monthName = monthsArray[momentYesterday.month()];

  for (let dayNumber = momentYesterday.date(); dayNumber >= 1; dayNumber--) {
    topRowValues.push(`${monthName}-${dayNumber}`);
  }

  topRowValues.push(
    'DAYS WITH DEDUCTIONS',
    'TOTAL DEDUCTIONS'
  );

  return topRowValues;
};

const getEmployeeData = (employeesData, phoneNumber) => {
  if (!employeesData[phoneNumber]) return {};

  return {
    name: employeesData[phoneNumber].name,
    employeeContact: phoneNumber,
    employeeCode: employeesData[phoneNumber]['Employee Code'],
    designation: employeesData[phoneNumber].Designation,
    department: employeesData[phoneNumber].Department,
    baseLocation: employeesData[phoneNumber]['Base Location'],
    firstSupervisor: employeesData[phoneNumber]['First Supervisor'],
    secondSupervisor: employeesData[phoneNumber]['Second Supervisor'],
    thirdSupervisor: employeesData[phoneNumber]['Third Supervisor'],
    dailyStartTime: employeesData[phoneNumber]['Daily Start Time'],
    dailyEndTime: employeesData[phoneNumber]['Daily End Time'],
    minimumWorkingHours: employeesData[phoneNumber]['Minimum Working Hours'],
    minimumActivityCount: employeesData[phoneNumber]['Minimum Activity Count'],
    monthlyOffDays: employeesData[phoneNumber]['Monthly Off Days'],
    locationValidationCheck: employeesData[phoneNumber]['Location Validation Check'],
  };
};

const getDefaultStatusObject = () => ({
  onLeave: false,
  onDuty: false,
  holiday: false,
  weeklyOff: false,
  blank: true,
  halfDay: false,
  fullDay: false,
  late: false,
  firstCheckIn: '',
  lastCheckIn: '',
  statusForDay: 0,
});

const executeSequentially = (batchFactories, firstBatch) => {
  if (batchFactories.length === 0) {
    return firstBatch.commit();
  }

  let result = Promise.resolve();

  batchFactories.forEach((factory, index) => {
    result = result
      .then(factory)
      .then(() => console.log('committed index', index))
      .catch((error) => console.error('BatchError:', error));
  });

  return result;
};

const getRef = (docRefsMap, phoneNumber) =>
  docRefsMap.get(phoneNumber);


const commitMultiBatch = (statusObjectsMap, docRefsMap, momentYesterday) => {
  let batch = db.batch();
  const batchFactories = [];
  let currentDocsCount = 0;

  statusObjectsMap.forEach((statusObject, phoneNumber) => {
    currentDocsCount++;

    /** Max 500 docs allowed for a single batch */
    if (currentDocsCount === 499) {
      batchFactories.push(() => batch.commit());

      batch = db.batch();
      /** Reset the counter for the next batch object */
      currentDocsCount = 0;
    }

    const ref = getRef(docRefsMap, phoneNumber);

    batch.set(ref, {
      statusObject,
      phoneNumber,
      month: momentYesterday.month(),
      year: momentYesterday.year(),
    }, {
        merge: true,
      });
  });

  return executeSequentially(batchFactories, batch);
};

// https://stackoverflow.com/questions/19700283/how-to-convert-time-milliseconds-to-hours-min-sec-format-in-javascript
const msToTime = (duration) => {
  const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

  return (hours < 10) ? 0 + hours : hours;
};


module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const timestampFromTimer = locals.change.after.get('timestamp');
  const momentToday = momentTz(timestampFromTimer).tz(timezone);
  // Don't modify the original momentToday object
  const yesterday = momentToday.clone().subtract(1, 'day').startOf('day');
  const employeesData = locals.officeDoc.get('employeesData');
  const employeePhoneNumbersList = Object.keys(employeesData);
  const yesterdayDate = yesterday.date();
  const yesterdayStartTimestamp = yesterday.startOf('day').valueOf();
  const yesterdayEndTimestamp = yesterday.endOf('day').valueOf();
  const docRefsMap = new Map();
  const checkinPromises = [];
  /** Stores the phone number at the index with checkIn query */
  const checkInQueryIndexex = [];
  const onLeaveSet = new Set();
  const onDutySet = new Set();
  const branchesWithHoliday = new Set();
  const branchHolidaySet = new Set();
  /** Docs which will be deleted */
  locals.nonEmployeeMontlyDocsIdSet = new Set();
  locals.branchesWithHoliday = new Set();
  const statusObjectsMap = new Map();
  const leavesSet = new Set();
  const weeklyOffSet = new Set();

  let paydaySheet;
  let paydayTimingsSheet;

  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Monthly')
        .where('month', '==', yesterday.month())
        .where('year', '==', yesterday.year())
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
    .then((result) => {
      const [
        monthlyDocsQuery,
        branchDocsQuery,
        worksheet,
      ] = result;

      monthlyDocsQuery.forEach(doc => {
        const { phoneNumber, statusObject } = doc.data();

        if (!employeesData[phoneNumber]) {
          locals.nonEmployeeMontlyDocsIdSet.add(doc.id);

          return;
        }

        docRefsMap.set(phoneNumber, doc.ref);

        if (!statusObject[yesterdayDate]) {
          statusObject[yesterdayDate] = getDefaultStatusObject();
        }

        Object.keys(statusObject).forEach((date) => {
          const dateNumber = Number(date);

          /** We are conserned only with the dates until yesterday of this month */
          if (dateNumber > yesterdayDate) return;

          if (!statusObject[dateNumber]) {
            statusObject[dateNumber] = {};
          }

          /**
           * `Note`: Return statement should be added after every `if` clause
           * while adding something below every block.
           * The arrangement is by order of priority.
           */
          if (statusObject[dateNumber].onLeave
            && dateNumber === yesterdayDate) {
            statusObject[yesterdayDate].blank = false;
            leavesSet.add(phoneNumber);
          }

          if (statusObject[dateNumber].onDuty
            && dateNumber === yesterdayDate) {
            statusObject[yesterdayDate].blank = false;
            onDutySet.add(phoneNumber);
          }

          if (dateNumber === yesterdayDate
            && branchesWithHoliday.has(employeesData[phoneNumber]['Base Location'])) {
            statusObject[yesterdayDate].holiday = true;
            statusObject[yesterdayDate].blank = false;

            branchHolidaySet.add(phoneNumber);
          }
        });

        if (!statusObject[yesterdayDate]) {
          statusObject[yesterdayDate] = getDefaultStatusObject();
        }

        statusObjectsMap.set(phoneNumber, statusObject);
      });

      branchDocsQuery.forEach(branchDoc => {
        branchDoc.get('schedule').forEach(schedule => {
          if (schedule.startTime >= yesterdayStartTimestamp
            && schedule.endTime < yesterdayEndTimestamp) {
            locals.branchesWithHoliday.add(branchDoc.get('attachment.Name.value'));
          }
        });
      });

      locals
        .worksheet = worksheet;
      paydaySheet = worksheet
        .addSheet(
          `PayDay_${yesterday.format(dateFormats.MONTH_YEAR)}`
        );
      paydayTimingsSheet = worksheet
        .addSheet(
          `PayDay Timings_${yesterday.format(dateFormats.MONTH_YEAR)}`
        );

      paydaySheet.row(1).style('bold', true);
      paydayTimingsSheet.row(1).style('bold', true);

      getPayDaySheetTopRow(yesterday).forEach((value, index) => {
        paydaySheet.cell(`${alphabetsArray[index]}1`).value(value);
      });
      getPayDayTimingsTopRow(yesterday).forEach((value, index) => {
        paydayTimingsSheet.cell(`${alphabetsArray[index]}1`).value(value);
      });

      // removing the default sheet
      worksheet.deleteSheet('Sheet1');

      employeePhoneNumbersList.forEach(phoneNumber => {
        if (!docRefsMap.has(phoneNumber)) {
          docRefsMap.set(phoneNumber, locals.officeDoc.ref.collection('Monthly').doc());
        }

        const statusObject = statusObjectsMap.get(phoneNumber) || getDefaultStatusObject();
        const checkDistanceAccurate = employeesData[phoneNumber].locationValidationCheck;

        if (!statusObject[yesterdayDate]) {
          statusObject[yesterdayDate] = getDefaultStatusObject();
        }

        const weeklyOffWeekdayName = employeesData[phoneNumber]['Weekly Off'];
        const weekdayName = weekdaysArray[yesterday.day()];

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
          .where('month', '==', yesterday.month())
          .where('year', '==', yesterday.year())
          .where('user', '==', phoneNumber);

        if (checkDistanceAccurate) {
          baseQuery = baseQuery
            .where('distanceAccurate', '==', true);
        }

        checkinPromises.push(
          baseQuery
            .orderBy('timestamp')
            .get()
        );
      });

      return Promise.all(checkinPromises);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        const phoneNumber = checkInQueryIndexex[index];
        const statusObject = statusObjectsMap.get(phoneNumber);

        // reportValueYesterdayMap.set(phoneNumber, reportValue);

        statusObject[yesterdayDate].numberOfCheckIns = snapShot.size;

        /** Number of checkins is 0 */
        if (snapShot.empty) {
          statusObject[yesterdayDate].blank = true;

          // The person did nothing
          statusObject.statusForDay = 0;

          statusObjectsMap.set(phoneNumber, statusObject);

          return;
        }

        const firstCheckInTimestamp = snapShot.docs[0].get('timestamp');
        const lastCheckInTimestamp = snapShot.docs[snapShot.size - 1].get('timestamp');
        // const checkInDiff = Math.abs(lastCheckInTimestamp - firstCheckInTimestamp);
        const firstCheckInTimestampFormatted = dateStringWithOffset({
          timezone,
          timestampToConvert: firstCheckInTimestamp,
          format: dateFormats.TIME,
        });
        const lastCheckInTimestampFormatted = dateStringWithOffset({
          timezone,
          timestampToConvert: lastCheckInTimestamp,
          format: dateFormats.TIME,
        });

        if (!statusObject[yesterdayDate]) {
          statusObject[yesterdayDate] = getDefaultStatusObject();

          statusObjectsMap.set(phoneNumber, statusObject);
        }

        statusObject[yesterdayDate].blank = false;
        statusObject[yesterdayDate].firstCheckIn = firstCheckInTimestampFormatted;
        statusObject[yesterdayDate].lastCheckIn = lastCheckInTimestampFormatted;

        const minimumActivityCount =
          employeesData[phoneNumber].minimumActivityCount || 1;

        statusObject[yesterdayDate].statusForDay = (() => {
          let result = snapShot.size / minimumActivityCount;

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

      console.log(statusObjectsMap);

      // return commitMultiBatch(statusObjectsMap, docRefsMap, yesterday);
      return;
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

        locals
          .paydaySheet
          .cell(`A${columnIndex}`)
          .value(employeesData[phoneNumber].name);
        locals
          .paydaySheet
          .cell(`B${columnIndex}`)
          .value(employeesData[phoneNumber]['Employee Code']);
        locals
          .paydaySheet
          .cell(`C${columnIndex}`)
          .value(employeesData[phoneNumber].Gender);
        locals
          .paydaySheet
          .cell(`D${columnIndex}`)
          .value(liveSince);

        locals
          .paydayTimingsSheet
          .cell(`A${columnIndex}`)
          .value(employeesData[phoneNumber].name);

        let paydaySheetAlphabetIndex = 4;
        let paydayTimingsSheetIndex = 1;
        let totalCount = 0;
        let daysWithDeductionsCount = 0;
        let totalDeductions = 0;

        for (let date = yesterdayDate; date >= 1; date--) {
          const paydaySheetCell = `${alphabetsArray[paydaySheetAlphabetIndex]}${columnIndex}`;
          const paydayTimingsSheetCell = `${alphabetsArray[paydayTimingsSheetIndex]}${columnIndex}`;
          const paydaySheetValue = statusObject[date].statusForDay;

          const paydayTimingsShetValue = (() => {
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

            const checkInDiff = Math.abs(lastCheckInTimestamp - firstCheckInTimestamp);
            const minimumWorkingHours = employeesData[phoneNumber].minimumWorkingHours;
            const minimumActivityCount = employeesData[phoneNumber].minimumActivityCount;

            // const numbero
            if (checkInDiff < minimumWorkingHours) {
              return `Total hours: ${msToTime(checkInDiff)} < Min hours: ${minimumWorkingHours}`;
            }

            if (statusObject[date].numberOfCheckIns < minimumActivityCount) {
              return `Count: ${statusObject[date].numberOfCheckIns}. Min Count: ${minimumActivityCount}`;
            }

            return `${statusObject[date].firstCheckIn | statusObject[date].lastCheckIn}`;
          })();

          paydaySheet
            .cell(paydaySheetCell)
            .value(paydaySheetValue);

          totalCount += Number(paydaySheetValue);

          paydayTimingsSheet
            .cell(paydayTimingsSheetCell)
            .value(paydayTimingsShetValue);

          paydaySheetAlphabetIndex++;
          paydayTimingsSheetIndex++;
        }

        paydaySheet
          .cell(`${alphabetsArray[paydaySheetAlphabetIndex++]}${columnIndex}`)
          .value(totalCount);
        paydaySheet
          .cell(`${alphabetsArray[paydaySheetAlphabetIndex++]}${columnIndex}`)
          .value(getEmployeeData(employeesData, phoneNumber));

        paydayTimingsSheet
          .cell(`${alphabetsArray[paydayTimingsSheetIndex++]}`)
          .value(daysWithDeductionsCount);
        paydayTimingsSheet
          .cell(`${alphabetsArray[paydayTimingsSheetIndex++]}`)
          .value(totalDeductions);
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

      locals
        .messageObject
        .attachments
        .push({
          fileName: `Payroll Report_${office}_${fullDateString}.xlsx`,
          content,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log({
        office,
        report: reportNames.PAYROLL,
        to: locals.messageObject.to,
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    // .then(() => locals.worksheet.toFileAsync('/tmp/tmpFile.xlsx'))
    .catch(console.error);
};
