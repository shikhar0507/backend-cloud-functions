'use strict';

const {
  db,
} = require('../../admin/admin');
const {
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  weekdaysArray,
  dateStringWithOffset,
  alphabetsArray,
  monthsArray,
} = require('./report-utils');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');

const getDefaultStatusObject = () => {
  return {
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
  };
};

const executeSequentially = (batchFactories, batch) => {
  if (batchFactories.length === 0) {
    return batch.commit();
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
// statusObjectsMap, docRefsMap, yesterday
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

    const ref = getRef(docRefsMap, phoneNumber, statusObject);

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

const getZeroCountsObject = () => {
  return {
    fullDay: 0,
    halfDay: 0,
    onLeave: 0,
    holiday: 0,
    blank: 0,
    late: 0,
    onDuty: 0,
    weeklyOff: 0,
  };
};

const topRow = (momentYesterday) => {
  const topRowValues = [
    'Employee Name',
    'Employee Contact',
    'Department',
    'Base Location',
    'Live Since',
  ];

  const monthName = monthsArray[momentYesterday.month()];

  for (let dayNumber = momentYesterday.date(); dayNumber >= 1; dayNumber--) {
    topRowValues.push(`${monthName}-${dayNumber}`, 'STATUS');
  }

  const lastValues = [
    'FULL DAY',
    'HALF DAY',
    'LEAVE',
    'HOLIDAY',
    'BLANK',
    'LATE',
    'ON DUTY',
    'WEEKLY OFF',
    'TOTAL',
  ];

  lastValues
    .forEach((value) => topRowValues.push(value));

  return topRowValues;
};

module.exports = (locals) => {
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const todayFromTimestamp = locals.change.after.get('timestamp');
  const office = locals.officeDoc.get('office');
  const peopleWithBlank = new Set();
  const countsObject = {};
  const leavesSet = new Set();
  const branchHolidaySet = new Set();
  const weeklyOffSet = new Set();
  /** People with the status ON DUTY */
  const onDutySet = new Set();
  const branchesWithHoliday = new Set();
  const yesterday = momentTz(todayFromTimestamp).tz(timezone).subtract(1, 'days');
  const yesterdayDate = yesterday.date();
  const yesterdayStartTimestamp = yesterday.startOf('day').valueOf();
  const yesterdayEndTimestamp = yesterday.endOf('day').valueOf();
  const employeesData = locals.officeDoc.get('employeesData') || {};
  const employeesPhoneNumberList = Object.keys(employeesData);
  const fullDateString = momentTz(todayFromTimestamp)
    .tz(timezone)
    .format(dateFormats.DATE);
  const statusObjectsMap = new Map();
  const checkInPromises = [];
  const NUM_MILLI_SECS_IN_HOUR = 3600 * 1000;
  const EIGHT_HOURS = NUM_MILLI_SECS_IN_HOUR * 8;
  const FOUR_HOURS = NUM_MILLI_SECS_IN_HOUR * 4;
  const docRefsMap = new Map();
  let sheet;
  let workbook;
  const phoneNumbersByQueryIndex = [];

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

      workbook = worksheet;

      sheet = worksheet.sheet('Sheet1');
      sheet.row(1).style('bold', true);

      branchDocsQuery.forEach((branchDoc) => {
        branchDoc.get('schedule').forEach((schedule) => {
          if (schedule.startTime >= yesterdayStartTimestamp
            && schedule.endTime < yesterdayEndTimestamp) {
            branchesWithHoliday.add(branchDoc.get('attachment.Name.value'));
          }
        });
      });

      monthlyDocsQuery
        .docs
        .forEach((doc) => {
          const { phoneNumber, statusObject } = doc.data();

          docRefsMap.set(phoneNumber, doc.ref);

          if (!employeesData[phoneNumber]) {
            return;
          }

          if (!countsObject[phoneNumber]) {
            countsObject[phoneNumber] = getZeroCountsObject();
          }

          if (!statusObject[yesterdayDate]) {
            statusObject[yesterdayDate] = getDefaultStatusObject();
          }

          Object
            .keys(statusObject)
            .forEach((date) => {
              const dateNumber = Number(date);
              // `Note`: Return statement should be added after every `if` clause
              // while adding something below every block.
              // The arrangement is by order of priority

              /**
               * Not counting anything after the current date because
               * we are generating data only up to the date of yesterday.
               *
               * Data from the future will be filled to the csv file when the
               * date arrives, but not returning here will mess up the count
               * because the payrollObject might contain a future LEAVE, or ON DUTY
               * status for someone.
               */
              if (dateNumber > yesterdayDate) return;

              if (statusObject[dateNumber].onLeave) {
                if (dateNumber === yesterdayDate) {
                  statusObject[yesterdayDate].blank = false;
                  leavesSet.add(phoneNumber);
                }

                countsObject[phoneNumber].onLeave++;
              }

              if (statusObject[dateNumber].onDuty) {
                if (dateNumber === yesterdayDate) {
                  statusObject[yesterdayDate].blank = false;
                  onDutySet.add(phoneNumber);
                }

                countsObject[phoneNumber].onDuty++;
              }

              /**
               * We are using a !== (not) clause here to compare
               * the dateNumber with yesterdaysDate because
               * the above two values onLeave and onDuty (booleans)
               * are set at the time of creation.
               *
               * All other values like weeklyOff, holiday, fullDay, halfDay
               * and late are put in the repot on the current date - 1 at runtime.
               */
              if (statusObject[dateNumber].holiday) {
                // if (dateNumber !== yesterdayDate) {
                // statusObject[yesterdayDate].blank = false;
                // branchHolidaySet.add(phoneNumber);
                // }

                countsObject[phoneNumber].holiday++;
              }

              if (statusObject[dateNumber].weeklyOff) {
                // if (dateNumber !== yesterdayDate) {
                // statusObject[yesterdayDate].blank = false;
                // weeklyOffSet.add(phoneNumber);
                // }

                countsObject[phoneNumber].weeklyOff++;
              }

              if (statusObject[dateNumber].halfDay) {
                // if (dateNumber !== yesterdayDate) {
                //   statusObject[yesterdayDate].blank = false;
                // }

                countsObject[phoneNumber].halfDay++;
              }

              if (statusObject[dateNumber].fullDay) {
                // if (dateNumber !== yesterdayDate) {
                //   statusObject[yesterdayDate].blank = false;
                // }

                countsObject[phoneNumber].fullDay++;
              }

              if (statusObject[dateNumber].late) {
                // if (dateNumber !== yesterdayDate) {
                //   statusObject[yesterdayDate].blank = false;
                // }

                countsObject[phoneNumber].late++;
              }

              if (statusObject[dateNumber].blank) {
                countsObject[phoneNumber].blank++;
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

      employeesPhoneNumberList.forEach((phoneNumber) => {
        if (!countsObject[phoneNumber]) {
          countsObject[phoneNumber] = getZeroCountsObject();
        }

        if (!docRefsMap.has(phoneNumber)) {
          docRefsMap.set(phoneNumber, locals.officeDoc.ref.collection('Monthly').doc());
        }

        const statusObject = statusObjectsMap.get(phoneNumber) || getDefaultStatusObject();

        if (!statusObject[yesterdayDate]) {
          statusObject[yesterdayDate] = getDefaultStatusObject();
        }

        const weeklyOffWeekdayName = employeesData[phoneNumber]['Weekly Off'];
        const weekdayName = weekdaysArray[yesterday.day()];

        if (weeklyOffWeekdayName === weekdayName) {
          statusObject[yesterdayDate].weeklyOff = true;
          countsObject[phoneNumber].weeklyOff++;

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

        /**
         * Using `orderBy` ascending because first and last check-in timestamp
         * is used to calculate `LATE`, `HALF DAY`, or `FULL DAY`.
         */
        const query = locals
          .officeDoc
          .ref
          .collection('Addendum')
          .where('template', '==', 'check-in')
          .where('date', '==', yesterdayDate)
          .where('month', '==', yesterday.month())
          .where('year', '==', yesterday.year())
          .where('user', '==', phoneNumber)
          .where('distanceAccurate', '==', true)
          .orderBy('timestamp', 'asc')
          .get();

        phoneNumbersByQueryIndex.push(phoneNumber);

        checkInPromises.push(query);
      });

      return Promise.all(checkInPromises);
    })
    .then((checkInActivitiesAddendumQuery) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      checkInActivitiesAddendumQuery.forEach((snapShot) => {
        if (snapShot.empty) {
          // This person did nothing on the day. Report will
          // show `BLANK` for the date

          return;
        }

        const addendumDoc = snapShot.docs[0];
        const phoneNumber = addendumDoc.get('user');
        const firstCheckInTimestamp = snapShot.docs[0].get('timestamp');
        const lastCheckInTimestamp = snapShot.docs[snapShot.size - 1].get('timestamp');
        const checkInDiff = Math.abs(lastCheckInTimestamp - firstCheckInTimestamp);
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

        const statusObject = statusObjectsMap.get(phoneNumber);

        if (!statusObject[yesterdayDate]) {
          statusObject[yesterdayDate] = getDefaultStatusObject();

          statusObjectsMap.set(phoneNumber, statusObject);
        }

        statusObject[yesterdayDate]
          .blank = false;
        statusObject[yesterdayDate]
          .firstCheckIn = firstCheckInTimestampFormatted;
        statusObject[yesterdayDate]
          .lastCheckIn = lastCheckInTimestampFormatted;

        // `dailyStartHours` is in the format `HH:MM` in the `employeesData` object.
        const dailyStartHours = employeesData[phoneNumber]['Daily Start Time'];
        const dailyEndHours = employeesData[phoneNumber]['Daily End Time'];

        if (!dailyStartHours || !dailyEndHours) {
          if (checkInDiff >= EIGHT_HOURS) {
            countsObject[phoneNumber].fullDay++;
            statusObject[yesterdayDate].blank = false;
            statusObject[yesterdayDate].fullDay = true;

            statusObjectsMap.set(phoneNumber, statusObject);

            return;
          }

          if (checkInDiff >= FOUR_HOURS) {
            statusObject[yesterdayDate].blank = false;
            statusObject[yesterdayDate].halfDay = true;
            countsObject[phoneNumber].halfDay++;

            statusObjectsMap.set(phoneNumber, statusObject);

            return;
          }

          /** This is imporant in order to avoid double counting of fullDay or halfDay */
          return;
        }

        // No need to convert the strings to Number becaue moment handles it automatically.
        const [startHours, startMinutes] = dailyStartHours.split(':');
        const [endHours, endMinutes] = dailyEndHours.split(':');

        // Data is created for the previous day
        const employeeStartTime = momentTz(todayFromTimestamp)
          .startOf('day')
          .subtract(1, 'days')
          .tz(timezone)
          .hours(startHours || '')
          .minutes(startMinutes || '')
          .add(0.5, 'hours')
          .valueOf();
        const employeeEndTime = momentTz(todayFromTimestamp)
          .startOf('day')
          .subtract(1, 'days')
          .tz(timezone)
          .hours(endHours || '')
          .minutes(endMinutes || '')
          .valueOf();

        /** Person created only 1 `check-in`. */
        if (firstCheckInTimestamp === lastCheckInTimestamp
          || checkInDiff <= FOUR_HOURS) {
          countsObject[phoneNumber].blank++;
          peopleWithBlank.add(phoneNumber);
          statusObject[yesterdayDate].blank = true;

          statusObjectsMap.set(phoneNumber, statusObject);

          return;
        }

        if (checkInDiff >= EIGHT_HOURS
          || lastCheckInTimestamp > employeeEndTime) {
          if (firstCheckInTimestamp >= employeeStartTime) {
            countsObject[phoneNumber].late++;
            statusObject[yesterdayDate].blank = false;
            statusObject[yesterdayDate].late = true;

            statusObjectsMap.set(phoneNumber, statusObject);

            return;
          }

          if (firstCheckInTimestamp < employeeStartTime) {
            countsObject[phoneNumber].fullDay++;
            statusObject[yesterdayDate].blank = false;
            statusObject[yesterdayDate].fullDay = true;

            statusObjectsMap.set(phoneNumber, statusObject);

            return;
          }
        }

        if (checkInDiff >= FOUR_HOURS) {
          countsObject[phoneNumber].halfDay++;
          statusObject[yesterdayDate].blank = false;
          statusObject[yesterdayDate].halfDay = true;

          statusObjectsMap.set(phoneNumber, statusObject);

          return;
        }

        /** Updating the map after updating the status object */
        statusObjectsMap.set(phoneNumber, statusObject);
      });

      return commitMultiBatch(statusObjectsMap, docRefsMap, yesterday);
    })
    .then(() => {
      if (locals.createOnlyData) {
        locals.sendMail = false;
      }

      if (!locals.sendMail) {
        return Promise.resolve({});
      }

      topRow(yesterday)
        .forEach((value, index) => {
          sheet
            .cell(`${alphabetsArray[index]}1`)
            .value(value);
        });

      let counter = 2;

      employeesPhoneNumberList
        .forEach((phoneNumber, index) => {
          const columnIndex = index + 2;
          const statusObject = statusObjectsMap.get(phoneNumber);
          const liveSince = dateStringWithOffset({
            timezone,
            timestampToConvert: employeesData[phoneNumber].createTime,
            format: dateFormats.DATE,
          });

          sheet
            .cell(`A${columnIndex}`)
            .value(employeesData[phoneNumber].Name);
          sheet
            .cell(`B${columnIndex}`)
            .value(employeesData[phoneNumber]['Employee Contact']);
          sheet
            .cell(`C${columnIndex}`)
            .value(employeesData[phoneNumber].Department);
          sheet
            .cell(`D${columnIndex}`)
            .value(employeesData[phoneNumber]['Base Location']);
          sheet
            .cell(`E${columnIndex}`)
            .value(liveSince);

          let ALPHABET_INDEX_START = 5;

          /**
           * Not adding `weeklyOff` and `holiday` to total
           * because they are not workdays.
           */
          for (let date = yesterday.date(); date >= 1; date--) {
            const statusColumnValue = (() => {
              if (statusObject[date].onLeave) {
                return 'LEAVE';
              }

              if (statusObject[date].onDuty) {
                return 'ON DUTY';
              }

              if (statusObject[date].holiday) {
                return 'HOLIDAY';
              }

              if (statusObject[date].weeklyOff) {
                return 'WEEKLY OFF';
              }

              if (statusObject[date].fullDay) {
                return 'FULL DAY';
              }

              if (statusObject[date].halfDay) {
                return 'HALF DAY';
              }

              if (statusObject[date].late) {
                return 'LATE';
              }

              return 'BLANK';
            })();

            const dateColumnValue = (() => {
              const valuesToIgnore = new Set(['LEAVE', 'ON DUTY', 'HOLIDAY', 'WEEKLY OFF']);

              if (valuesToIgnore.has(statusColumnValue)) {
                return '-';
              }

              const firstCheckIn = statusObject[date].firstCheckIn || '';
              const lastCheckIn = statusObject[date].lastCheckIn || '';

              if (!firstCheckIn && !lastCheckIn) {
                return '-';
              }

              if (firstCheckIn && !lastCheckIn) {
                return `${firstCheckIn} | -`;
              }

              return `${firstCheckIn} | ${lastCheckIn}`;
            })();

            const cell1 = `${alphabetsArray[ALPHABET_INDEX_START]}${counter}`;

            ALPHABET_INDEX_START++;

            const cell2 = `${alphabetsArray[ALPHABET_INDEX_START]}${counter}`;

            sheet
              .cell(cell1)
              .value(dateColumnValue);
            sheet
              .cell(cell2)
              .value(statusColumnValue);

            ALPHABET_INDEX_START++;
          }

          let totalWorkDays = 0;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(countsObject[phoneNumber].fullDay);

          totalWorkDays += countsObject[phoneNumber].fullDay;

          ALPHABET_INDEX_START++;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(countsObject[phoneNumber].halfDay);

          totalWorkDays += countsObject[phoneNumber].halfDay;

          ALPHABET_INDEX_START++;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(countsObject[phoneNumber].onLeave);

          totalWorkDays += countsObject[phoneNumber].onLeave;

          ALPHABET_INDEX_START++;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(countsObject[phoneNumber].holiday);

          ALPHABET_INDEX_START++;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(countsObject[phoneNumber].blank);

          totalWorkDays += countsObject[phoneNumber].blank;

          ALPHABET_INDEX_START++;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(countsObject[phoneNumber].late);

          totalWorkDays += countsObject[phoneNumber].late;

          ALPHABET_INDEX_START++;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(countsObject[phoneNumber].onDuty);

          totalWorkDays += countsObject[phoneNumber].onDuty;

          ALPHABET_INDEX_START++;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(countsObject[phoneNumber].weeklyOff);

          ALPHABET_INDEX_START++;

          sheet
            .cell(`${alphabetsArray[ALPHABET_INDEX_START]}${columnIndex}`)
            .value(totalWorkDays);

          counter++;
        });

      return workbook.outputAsync('base64');
    })
    .then((content) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

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
    .catch(console.error);
};
