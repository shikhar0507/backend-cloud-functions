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


const admin = require('firebase-admin');
const {
  deleteField,
  rootCollections,
} = require('../../admin/admin');
const {
  dateStringWithOffset,
  monthsArray,
  weekdaysArray,
} = require('./report-utils');
const {
  dateFormats,
  reportNames,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');


const getZeroCountsObject = () => {
  return {
    fullDay: 0,
    halfDay: 0,
    leave: 0,
    holiday: 0,
    blank: 0,
    late: 0,
    onDuty: 0,
    weeklyOff: 0,
  };
};

const topRow = (yesterday) => {
  let str = ` Employee Name,`
    + ` Employee Contact,`
    + ` Department,`
    + ` Base Location,`
    + ` Live Since,`;

  const monthName = monthsArray[yesterday.month()];

  for (let dayNumber = yesterday.date(); dayNumber >= 1; dayNumber--) {
    str += `${monthName}-${dayNumber}, STATUS, `;
  }

  str += `FULL DAY,`
    + ` HALF DAY,`
    + ` LEAVE,`
    + ` HOLIDAY,`
    + ` BLANK,`
    + ` LATE,`
    + ` ON DUTY,`
    + ` WEEKLY OFF,`
    + ` TOTAL`;

  str += `\n`;

  return str;
};


module.exports = (locals) => {
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const todayFromTimestamp = locals.change.after.get('timestamp');
  const office = locals.officeDoc.get('office');
  const dateStatusMap = new Map();
  const peopleWithBlank = new Set();
  const countsObject = {};
  const leavesSet = new Set();
  const branchHolidaySet = new Set();
  const weeklyOffSet = new Set();
  /** People with the status ON DUTY */
  const onDutySet = new Set();
  /** Stores the type of leave a person has taken for the day */
  const leaveTypesMap = new Map();
  const branchesWithHoliday = new Set();
  const yesterday = momentTz(todayFromTimestamp).tz(timezone).subtract(1, 'days');
  const yesterdayDate = yesterday.date();
  const yesterdayStartTimestamp = yesterday.startOf('day').unix() * 1000;
  const yesterdayEndTimestamp = yesterday.endOf('day').unix() * 1000;
  const employeesData = locals.officeDoc.get('employeesData') || {};
  const employeesPhoneNumberList = Object.keys(employeesData);
  const standardDateString = momentTz(todayFromTimestamp).tz(timezone).format(dateFormats.DATE);

  console.log('office', locals.officeDoc.get('office'));
  console.log('locals.createOnlyData', locals.createOnlyData);

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.PAYROLL)
        .where('month', '==', yesterday.month())
        .where('year', '==', yesterday.year())
        .limit(1)
        .get(),
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'branch')
        .get(),
    ])
    .then((result) => {
      const [
        initDocsQuery,
        branchDocsQuery,
      ] = result;

      branchDocsQuery.forEach((branchDoc) => {
        branchDoc.get('schedule').forEach((schedule) => {
          if (schedule.startTime >= yesterdayStartTimestamp
            && schedule.endTime < yesterdayEndTimestamp) {
            branchesWithHoliday.add(branchDoc.get('attachment.Name.value'));
          }
        });
      });

      // At the beginning of the month, payroll object can sometimes be `undefined`
      const payrollObject = (() => {
        if (initDocsQuery.empty) {
          return {};
        }

        return initDocsQuery.docs[0].get('payrollObject') || {};
      })();

      console.log({
        initDocsQuery: !initDocsQuery.empty ? initDocsQuery.docs[0].id : null,
      });

      const payrollPhoneNumbers = Object.keys(payrollObject);
      const weekdayName = weekdaysArray[yesterday.day()];

      payrollPhoneNumbers.forEach((phoneNumber) => {
        if (!employeesData[phoneNumber]) {
          return;
        }

        if (!countsObject[phoneNumber]) {
          countsObject[phoneNumber] = getZeroCountsObject();
        }

        const weeklyOffWeekdayName = employeesData[phoneNumber]['Weekly Off'];
        const baseLocation = employeesData[phoneNumber]['Base Location'];

        const datesObject = payrollObject[phoneNumber];

        Object
          .keys(datesObject)
          .forEach((date) => {
            dateStatusMap.set(`${phoneNumber}: ${date}`, datesObject[date]);

            /**
             * Not counting anything after the current date because
             * we are generating data only up to the date of yesterday.
             * 
             * Data from the future will be filled to the csv file when the 
             * date arrives, but not returning here will mess up the count
             * because the payrollObject might contain a future LEAVE, or ON DUTY
             * status for someone.
             */
            if (date > yesterdayDate) return;

            // If a person's phone number doesn't exist in the employees map
            // but exists in the payroll object, deleting their
            // data only for the prev day to avoid putting their
            // data in the report
            if (!employeesData[phoneNumber]) {
              payrollObject[phoneNumber][yesterdayDate] = deleteField();
            }

            if (!payrollObject[phoneNumber][yesterdayDate]) {
              payrollObject[phoneNumber][yesterdayDate] = {};
            }

            const status = payrollObject[phoneNumber][date].status || '';

            /** 
             * `ON DUTY` and `LEAVE` fields are handled 
             *  by `addendumOnCreate` when someone creates
             *  a `on duty` (previously tour plan) activity.
             */
            if (status === 'ON DUTY') {
              countsObject[phoneNumber].onDuty++;
            }

            if (status === 'HALF DAY') {
              countsObject[phoneNumber].halfDay++;
            }

            if (status === 'HOLIDAY') {
              countsObject[phoneNumber].holiday++;
            }

            if (status === 'WEEKLY OFF') {
              countsObject[phoneNumber].weeklyOff++;
            }

            if (status === 'LATE') {
              countsObject[phoneNumber].late++;
            }

            if (status === 'FULL DAY') {
              countsObject[phoneNumber].fullDay++;
            }

            if (status.startsWith('LEAVE')) {
              countsObject[phoneNumber].leave++;
            }

            if (status === 'BLANK') {
              countsObject[phoneNumber].blank++;
            }

            if (payrollObject[phoneNumber][yesterdayDate]
              && payrollObject[phoneNumber][yesterdayDate].status
              && payrollObject[phoneNumber][yesterdayDate].status.startsWith('LEAVE')) {
              leavesSet.add(phoneNumber);

              leaveTypesMap.set(
                phoneNumber,
                payrollObject[phoneNumber][yesterdayDate].status
              );

              return;
            }

            if (payrollObject[phoneNumber][yesterdayDate].status === 'ON DUTY') {
              onDutySet.add(phoneNumber);

              return;
            }

            if (branchesWithHoliday.has(baseLocation)) {
              payrollObject[phoneNumber][yesterdayDate].status = 'HOLIDAY';

              branchHolidaySet.add(phoneNumber);

              return;
            }

            if (weeklyOffWeekdayName === weekdayName) {
              payrollObject[phoneNumber][yesterdayDate].status = 'WEEKLY OFF';

              // `Note`: Return statement should be added after this while adding
              // something below this block.
              // The arrangement is by order of priority
              weeklyOffSet.add(phoneNumber);
            }
          });
      });

      const checkInPromises = [];

      employeesPhoneNumberList.forEach((phoneNumber) => {
        if (!countsObject[phoneNumber]) {
          countsObject[phoneNumber] = getZeroCountsObject();
        }

        const statusString = `${phoneNumber}: ${yesterdayDate}`;

        if (!dateStatusMap.has(phoneNumber)) {
          dateStatusMap.set(statusString, {});
        }

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

        if (!payrollObject[phoneNumber]) {
          payrollObject[phoneNumber] = {};
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

        checkInPromises.push(query);
      });

      locals.payrollObject = payrollObject;
      locals.initDocsQuery = initDocsQuery;
      locals.employeesPhoneNumberList = employeesPhoneNumberList;

      return Promise.all(checkInPromises);
    })
    .then((checkInActivitiesAddendumQuery) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      const NUM_MILLI_SECS_IN_HOUR = 3600 * 1000;
      const EIGHT_HOURS = NUM_MILLI_SECS_IN_HOUR * 8;
      const FOUR_HOURS = NUM_MILLI_SECS_IN_HOUR * 4;

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
        const checkInDiff = Math.abs(
          lastCheckInTimestamp - firstCheckInTimestamp
        );

        if (!locals.payrollObject[phoneNumber][yesterdayDate]) {
          locals.payrollObject[phoneNumber][yesterdayDate] = {};
        }

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

        // Using yesterday's date here because the check-ins are from
        // yesterday
        const statusString = `${phoneNumber}: ${yesterdayDate}`;

        dateStatusMap.set(statusString, {
          firstCheckInTimestampFormatted,
          lastCheckInTimestampFormatted,
        });

        locals
          .payrollObject[phoneNumber][yesterdayDate]
          .firstCheckInTimestamp = firstCheckInTimestampFormatted;
        locals
          .payrollObject[phoneNumber][yesterdayDate]
          .lastCheckInTimestamp = lastCheckInTimestampFormatted;

        // `dailyStartHours` is in the format `HH:MM` in the `employeesData` object.
        const dailyStartHours = employeesData[phoneNumber]['Daily Start Time'];
        const dailyEndHours = employeesData[phoneNumber]['Daily End Time'];

        if (!dailyStartHours || !dailyEndHours) {
          if (checkInDiff >= EIGHT_HOURS) {
            locals.payrollObject[phoneNumber][yesterdayDate].status = 'FULL DAY';

            countsObject[phoneNumber].fullDay++;

            dateStatusMap.get(statusString).status = 'FULL DAY';

            return;
          }

          if (checkInDiff >= FOUR_HOURS) {
            locals.payrollObject[phoneNumber][yesterdayDate].status = 'HALF DAY';

            countsObject[phoneNumber].halfDay++;

            dateStatusMap.get(statusString).status = 'HALF DAY';

            return;
          }

          return;
        }

        // No need to convert the strings to Number becaue moment handles it automatically.
        const [startHours, startMinutes] = dailyStartHours.split(':');
        const [endHours, endMinutes] = dailyEndHours.split(':');

        // Data is created for the previous day
        const employeeStartTime = momentTz(todayFromTimestamp)
          .subtract(1, 'days')
          .tz(timezone)
          .hours(startHours)
          .minutes(startMinutes)
          .add(0.5, 'hours')
          .unix() * 1000;
        const employeeEndTime = momentTz(todayFromTimestamp)
          .subtract(1, 'days')
          .tz(timezone)
          .hours(endHours)
          .minutes(endMinutes)
          .unix() * 1000;

        /** Person created only 1 `check-in`. */
        if (firstCheckInTimestamp === lastCheckInTimestamp) {
          locals.payrollObject[phoneNumber][yesterdayDate].status = 'BLANK';

          dateStatusMap.get(statusString).status = 'BLANK';

          countsObject[phoneNumber].blank++;

          peopleWithBlank.add(phoneNumber);

          return;
        }

        if (checkInDiff >= EIGHT_HOURS
          || lastCheckInTimestamp > employeeEndTime) {
          if (firstCheckInTimestamp >= employeeStartTime) {
            locals.payrollObject[phoneNumber][yesterdayDate].status = 'LATE';

            dateStatusMap.get(statusString).status = 'LATE';

            countsObject[phoneNumber].late++;

            return;
          }

          if (firstCheckInTimestamp < employeeStartTime) {
            locals
              .payrollObject[phoneNumber][yesterdayDate].status = 'FULL DAY';

            dateStatusMap.get(statusString).status = 'FULL DAY';

            countsObject[phoneNumber].fullDay++;

            return;
          }
        }

        if (checkInDiff >= FOUR_HOURS) {
          locals
            .payrollObject[phoneNumber][yesterdayDate].status = 'HALF DAY';

          dateStatusMap.get(statusString).status = 'HALF DAY';

          countsObject[phoneNumber].halfDay++;

          return;
        }
      });

      Object.keys(locals.payrollObject).forEach((phoneNumber) => {
        const statusString = `${phoneNumber}: ${yesterdayDate}`;

        if (leavesSet.has(phoneNumber)) {
          locals
            .payrollObject[phoneNumber][yesterdayDate]
            .status = leaveTypesMap.get(phoneNumber);

          return;
        }

        if (onDutySet.has(phoneNumber)) {
          locals
            .payrollObject[phoneNumber][yesterdayDate].status = 'ON DUTY';

          dateStatusMap.get(statusString).status = 'ON DUTY';

          countsObject[phoneNumber].onDuty++;

          return;
        }

        if (branchHolidaySet.has(phoneNumber)) {
          locals
            .payrollObject[phoneNumber][yesterdayDate].status = 'HOLIDAY';

          dateStatusMap.get(statusString).status = 'HOLIDAY';

          countsObject[phoneNumber].holiday++;

          return;
        }

        if (weeklyOffSet.has(phoneNumber)) {
          locals
            .payrollObject[phoneNumber][yesterdayDate].status = 'WEEKLY OFF';

          dateStatusMap.get(statusString).status = 'WEEKLY OFF';

          countsObject[phoneNumber].weeklyOff++;

          return;
        }

        /** 
         * If any value has been put in the `yesterdayDate` column 
         * for the employee, we will not put `BLANK`
         */
        if (locals.payrollObject[phoneNumber][yesterdayDate]
          && locals.payrollObject[phoneNumber][yesterdayDate].status) {
          return;
        }

        // Person hasn't done anything. AND yesterday was also not
        // a holiday, on duty, or a leave will get blank
        locals.payrollObject[phoneNumber][yesterdayDate] = { status: 'BLANK' };

        dateStatusMap.get(statusString).status = 'BLANK';

        countsObject[phoneNumber].blank++;

        peopleWithBlank.add(phoneNumber);
      });

      const ref = (() => {
        if (locals.initDocsQuery.empty) {
          return rootCollections.inits.doc();
        }

        return locals.initDocsQuery.docs[0].ref;
      })();

      console.log('yesterday', yesterday.date());

      return ref
        .set({
          office,
          month: yesterday.month(),
          year: yesterday.year(),
          officeId: locals.officeDoc.id,
          report: reportNames.PAYROLL,
          payrollObject: locals.payrollObject,
        }, {
            merge: true,
          });
    })
    .then(() => {
      if (locals.createOnlyData) {
        locals.sendMail = false;
      }

      if (!locals.sendMail) {
        return Promise.resolve();
      }

      /**
       * Not adding `weeklyOff` and `holiday` to total
       * because they are not workdays.
       */
      Object
        .keys(countsObject)
        .forEach((phoneNumber) => {
          countsObject[phoneNumber].total =
            countsObject[phoneNumber].fullDay
            + countsObject[phoneNumber].halfDay
            + countsObject[phoneNumber].blank
            + countsObject[phoneNumber].late
            + countsObject[phoneNumber].holiday
            + countsObject[phoneNumber].weeklyOff
            + countsObject[phoneNumber].onDuty;
        });

      locals
        .csvString = topRow(yesterday);

      employeesPhoneNumberList.forEach((phoneNumber) => {
        if (!employeesData[phoneNumber]) return;

        /**
         * Activity `createTime` is the time at which the user has been
         * on the platform.
         */
        const liveSince = dateStringWithOffset({
          timezone,
          timestampToConvert: employeesData[phoneNumber].createTime,
        });

        const baseLocation =
          employeesData[phoneNumber]['Base Location']
            .replace(/,/g, ' ')
            .replace(/-/g, ' ')
            .replace(/\s\s+/g, ' ');

        locals.csvString +=
          `${employeesData[phoneNumber].Name},`
          // The tab character after the phone number disabled Excel's 
          // auto converting of the phone numbers into big numbers
          + ` ${phoneNumber}\t,`
          + ` ${employeesData[phoneNumber].Department},`
          + ` ${baseLocation},`
          + ` ${liveSince},`;

        for (let date = yesterdayDate; date >= 1; date--) {
          // The OR case with empty strings is required. Omitting that will
          // cause the excel sheet to show the value `undefined` in all non available
          // dates for the employee

          const status = locals
            .payrollObject[phoneNumber][date]
            .status;
          let firstCheckInTime = locals
            .payrollObject[phoneNumber][date]
            .firstCheckInTimestamp || ' ';
          const lastCheckInTime = locals
            .payrollObject[phoneNumber][date]
            .lastCheckInTimestamp;

          if (firstCheckInTime && lastCheckInTime) {
            firstCheckInTime = `${firstCheckInTime} | `;
          }

          const value = `${firstCheckInTime || '-'}${lastCheckInTime || '-'}`;

          locals.csvString += `${value}, ${status},`;
        }

        locals.csvString +=
          `${countsObject[phoneNumber].fullDay},`
          + `${countsObject[phoneNumber].halfDay},`
          + `${countsObject[phoneNumber].leave},`
          + `${countsObject[phoneNumber].holiday},`
          + `${countsObject[phoneNumber].blank},`
          + `${countsObject[phoneNumber].late},`
          + `${countsObject[phoneNumber].onDuty},`
          + `${countsObject[phoneNumber].weeklyOff},`
          + `${countsObject[phoneNumber].total}`;

        locals
          .csvString += `\n`;
      });

      locals
        .messageObject['dynamic_template_data'] = {
          office,
          date: standardDateString,
          subject: `Payroll Report_${office}_${standardDateString}`,
        };

      locals
        .messageObject
        .attachments
        .push({
          content: Buffer.from(locals.csvString).toString('base64'),
          fileName: `Payroll Report_${office}_${standardDateString}.csv`,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log({
        report: reportNames.PAYROLL,
        to: locals.messageObject.to,
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .then(() => {
      const momentToday = momentTz().tz(timezone);
      const momentFromTimer = momentTz(todayFromTimestamp).tz(timezone);

      console.log({
        momentToday: momentToday.unix(),
        momentFromTimer: momentFromTimer.unix(),
      });

      // Notifications are only sent when the Timer cloud function updates the timestamp
      // in the recipients document.
      // For any manual triggers, the notifications should be skipped.
      if (momentToday.startOf('day').unix() !== momentFromTimer.startOf('day').unix()) {
        console.log('No notifications sent. Not the same day.');

        // Array is required otherwise `snapShots`.forEach will throw an error for being `undefined`
        return Promise.resolve([]);
      }

      const promises = [];

      console.log('sending notifications');

      peopleWithBlank.forEach((phoneNumber) => {
        const promise = rootCollections
          .updates
          .where('phoneNumber', '==', phoneNumber)
          .limit(1)
          .get();

        promises.push(promise);
      });

      console.log('number of blanks:', peopleWithBlank.size);

      return Promise.all(promises);
    })
    .then((snapShots) => {
      const notificationMessage = () => {
        const dateString = yesterday.format(dateFormats.DATE);
        // `There was a blank in your payroll for yesterday.`
        //   + ` Would you like to create a LEAVE or TOUR PLAN`;

        return `We detected a 'BLANK' in your Payroll`
          + ` on ${dateString}. Do you wish to apply`
          + ` for a Leave or a ON DUTY?`;
      };

      const promises = [];

      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          return;
        }

        const registrationToken = snapShot.docs[0].get('registrationToken');

        if (!registrationToken) return;

        const promise = admin
          .messaging()
          .sendToDevice(registrationToken, {
            data: {
              key1: 'value1',
              key2: 'value2',
            },
            notification: {
              body: notificationMessage(),
              tile: `Growthfile`,
            },
          });

        promises.push(promise);
      });

      return Promise.all(promises);
    })
    .catch(console.error);
};
