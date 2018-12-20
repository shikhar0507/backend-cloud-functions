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

const momentTz = require('moment-timezone');

const {
  rootCollections,
} = require('../../admin/admin');

const {
  momentOffsetObject,
  dateStringWithOffset,
  monthsArray,
  weekdaysArray,
} = require('./report-utils');

const {
  dateFormats,
  sendGridTemplateIds,
  reportNames,
} = require('../../admin/constants');


const topRow = (timezone) => {
  let str = ` Employee Name,`
    + ` Employee Contact,`
    + ` Department,`
    + ` Base Location,`
    + ` Live Since,`;

  const yesterday = momentTz()
    .utc()
    .clone()
    .tz(timezone)
    .subtract(1, 'day');
  const monthNumber = yesterday.month();
  const monthName = monthsArray[monthNumber];
  const NUM_DAYS_IN_PREV_DAY_MONTH = momentTz()
    .utc()
    .clone()
    .tz(timezone)
    .subtract(1, 'day')
    .daysInMonth();

  /** Human readable dates start with 1. */
  for (let dayNumber = 1;
    dayNumber <= NUM_DAYS_IN_PREV_DAY_MONTH;
    dayNumber++) {
    str += `${monthName}-${dayNumber}, `;
  }

  str += `FULL DAY,`
    + ` HALF DAY,`
    + ` LEAVE,`
    + ` HOLIDAY,`
    + ` BLANK,`
    + ` LATE,`
    + ` ON DUTY,`
    + ` WEEKLY OFF,`
    + ` TOTAL\n`;

  return str;
};


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);
  const standardDateString = momentTz()
    .utc()
    .clone()
    .tz(timezone)
    .format(dateFormats.DATE);

  /**
   * STATUS PRIORITY
   * HIGH ==> LOW
   * LEAVE, ON-DUTY,
   * HOLIDAY, WEEKLY OFF, 
   * HALF DAY, LATE, FULL DAY, 
   * BLANK
   */

  const countsObject = {};
  locals.sendMail = true;

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.PAYROLL)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .limit(1)
        .get(),
      rootCollections
        .offices
        .doc(officeId)
        .collection('Activities')
        .where('template', '==', 'branch')
        .get(),
    ])
    .then((result) => {
      const [
        initDocsQuery,
        branchDocsQuery,
      ] = result;

      if (initDocsQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      locals.messageObject['dynamic_template_data'] = {
        office,
        date: standardDateString,
        subject: `Payroll Report_${office}_${standardDateString}`,
      };

      locals.messageObject.templateId = sendGridTemplateIds.payroll;
      const yesterday = momentTz()
        .utc()
        .clone()
        .tz(timezone)
        .subtract(1, 'days');
      const yesterdayDate = yesterday.date();
      const weekdayName = weekdaysArray[yesterday.day()];
      const yesterdayStartTimestamp = yesterday.startOf('day').unix() * 1000;
      const yesterdayEndTimestamp = yesterday.endOf('day').unix() * 1000;
      const branchesWithHoliday = new Set();

      branchDocsQuery.forEach((branchDoc) => {
        const branchName = branchDoc.get('attachment.Name.value');
        const scheduleArray = branchDoc.get('schedule');

        scheduleArray.forEach((schedule) => {
          if (!schedule.startTime || !schedule.endTime) return;

          if (schedule.startTime >= yesterdayStartTimestamp
            && schedule.endTime < yesterdayEndTimestamp) {
            branchesWithHoliday.add(branchName);
          }
        });
      });

      const initDoc = initDocsQuery.docs[0];
      const employeesData = locals.officeDoc.get('employeesData');
      const employeesPhoneNumberList = Object.keys(employeesData);
      const payrollObject = initDoc.get('payrollObject');
      const payrollPhoneNumbers = Object.keys(payrollObject);

      /** 
       * If the day is a `WEEKLY_OFF` or a `HOLIDAY`, not fetching check-ins
       *  because weekly off and holiday have higher priorities.
       */
      const employeesWithInit = new Set();

      payrollPhoneNumbers.forEach((phoneNumber) => {
        countsObject[phoneNumber] = {
          fullDay: 0,
          halfDay: 0,
          leave: 0,
          holiday: 0,
          blank: 0,
          late: 0,
          onDuty: 0,
          weeklyOff: 0,
        };

        const employeeData = employeesData[phoneNumber];
        const weeklyOffWeekdayName = employeeData['Weekly Off'];
        const baseLocation = employeeData['Base Location'];
        const MAX = momentTz()
          .utc()
          .clone()
          .tz(timezone)
          .date();

        Object
          .keys(payrollObject[phoneNumber])
          .forEach((date) => {
            // Not counting anything after the current date
            //  This is because we are only generating data for up to 
            //  yesterday.
            // Any other data will show up on its respective date
            // Not doing this will mess up the counts because this loop
            // will count all the statuses even from the future (if set) 
            // but they won't show up in the report

            if (date > MAX) return;

            const status = payrollObject[phoneNumber][date];
            /** 
             * `ON DUTY` and `LEAVE` fields are handled 
             *  by `addendumOnCreate` when someone creates
             * a tour plan.
             */
            if (status === 'ON DUTY') {
              countsObject[phoneNumber].onDuty
                = countsObject[phoneNumber].onDuty + 1;
            }

            if (status.startsWith('LEAVE')) {
              countsObject[phoneNumber].leave
                = countsObject[phoneNumber].leave + 1;
            }

            if (status === 'BLANK') {
              countsObject[phoneNumber].blank =
                countsObject[phoneNumber].blank + 1;
            }

            if (status === 'HALF DAY') {
              countsObject[phoneNumber].halfDay =
                countsObject[phoneNumber].halfDay + 1;
            }

            if (status === 'HOLIDAY') {
              countsObject[phoneNumber].holiday =
                countsObject[phoneNumber].holiday + 1;
            }

            if (status === 'WEEKLY OFF') {
              countsObject[phoneNumber].weeklyOff =
                countsObject[phoneNumber].weeklyOff + 1;
            }

            if (status === 'LATE') {
              countsObject[phoneNumber].late =
                countsObject[phoneNumber].late + 1;
            }
          });

        if (weeklyOffWeekdayName === weekdayName) {
          payrollObject[phoneNumber][yesterdayDate] = 'WEEKLY OFF';

          countsObject[phoneNumber].weeklyOff
            = countsObject[phoneNumber].weeklyOff + 1;

          return;
        }

        if (branchesWithHoliday.has(baseLocation)) {
          payrollObject[phoneNumber][yesterdayDate] = 'HOLIDAY';

          countsObject[phoneNumber].holiday
            = countsObject[phoneNumber].holiday + 1;

          return;
        }

        employeesWithInit.add(phoneNumber);
      });

      const promises = [];

      employeesPhoneNumberList.forEach((phoneNumber) => {
        // if (employeesWithInit.has(phoneNumber)) {
        //   return;
        // }

        if (!countsObject[phoneNumber]) {
          countsObject[phoneNumber] = {
            fullDay: 0,
            halfDay: 0,
            leave: 0,
            holiday: 0,
            blank: 0,
            late: 0,
            onDuty: 0,
            weeklyOff: 0,
          };
        }

        if (!payrollObject[phoneNumber]) {
          payrollObject[phoneNumber] = {};
        }

        const query = rootCollections
          .offices
          .doc(officeId)
          .collection('Addendum')
          .where('template', '==', 'check-in')
          .where('date', '==', momentDateObject.yesterday.DATE_NUMBER)
          .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
          .where('year', '==', momentDateObject.yesterday.YEAR)
          .where('user', '==', phoneNumber)
          .where('distanceAccurate', '==', true)
          .orderBy('timestamp', 'asc')
          .get();

        promises.push(query);
      });

      locals.employeesData = employeesData;
      locals.payrollObject = payrollObject;
      locals.initDoc = initDocsQuery.docs[0];
      locals.employeesPhoneNumberList = employeesPhoneNumberList;
      locals.standardDateString = standardDateString;
      locals.timezone = timezone;

      return Promise.all(promises);
    })
    .then((checkInActivitiesAddendumQuery) => {
      if (!locals.sendMail) return Promise.resolve();

      const yesterdayDate = momentTz()
        .utc()
        .clone()
        .tz(timezone)
        .subtract(1, 'days')
        .date();
      const NUM_MILLI_SECS_IN_HOUR = 3600 * 1000;
      const EIGHT_HOURS = NUM_MILLI_SECS_IN_HOUR * 8;
      const FOUR_HOURS = NUM_MILLI_SECS_IN_HOUR * 4;

      checkInActivitiesAddendumQuery.forEach((snapShot) => {
        if (snapShot.empty) {
          return;
        }

        const addendumDoc = snapShot.docs[0];
        const phoneNumber = addendumDoc.get('user');
        // `dailyStartHours` is in the format `HH:MM` in the `employeesData` object.
        const dailyStartHours
          = locals.employeesData[phoneNumber]['Daily Start Time'];
        // const HALF_HOUR = 30;
        const split = dailyStartHours.split(':');
        const hours = Number(split[0]);
        const minutes = Number(split[1]);
        // Data is created for the previous day
        const employeeStartTime = momentTz()
          .utc()
          .subtract(1, 'days')
          .clone()
          .tz(locals.timezone)
          .hours(hours)
          .minutes(minutes)
          .add(0.5, 'hours')
          .unix() * 1000;

        const firstCheckInTimestamp = addendumDoc.get('timestamp');
        const lastCheckInTimestamp =
          snapShot.docs[snapShot.size - 1].get('timestamp');

        /** Person created only 1 check-in. */
        if (firstCheckInTimestamp === lastCheckInTimestamp) {
          locals.payrollObject[phoneNumber][yesterdayDate] = 'BLANK';

          countsObject[phoneNumber].blank = countsObject[phoneNumber].blank + 1;
        }

        const checkInDiff = lastCheckInTimestamp - firstCheckInTimestamp;

        if (checkInDiff >= EIGHT_HOURS) {
          if (firstCheckInTimestamp > employeeStartTime) {
            locals.payrollObject[phoneNumber][yesterdayDate] = 'LATE';

            countsObject[phoneNumber].late
              = countsObject[phoneNumber].late + 1;
          } else {
            locals.payrollObject[phoneNumber][yesterdayDate] = 'FULL DAY';

            countsObject[phoneNumber].fullDay
              = countsObject[phoneNumber].fullDay + 1;
          }

          if (checkInDiff >= FOUR_HOURS && checkInDiff <= EIGHT_HOURS) {
            locals.payrollObject[phoneNumber][yesterdayDate] = 'HALF DAY';

            countsObject[phoneNumber].halfDay =
              countsObject[phoneNumber].halfDay + 1;
          }
        }

        if (lastCheckInTimestamp - firstCheckInTimestamp >= FOUR_HOURS
          && lastCheckInTimestamp - firstCheckInTimestamp < EIGHT_HOURS) {
          locals.payrollObject[phoneNumber][yesterdayDate] = 'HALF DAY';

          countsObject[phoneNumber].halfDay
            = countsObject[phoneNumber].halfDay + 1;
        }
      });

      // Person hasn't done anything. AND yesterday was also not
      // a holiday or a weekly off
      Object.keys(locals.payrollObject).forEach((phoneNumber) => {
        // The field in the yesterdayDate will be is caculated based 
        // on check-ins, weekly off, duty roster etc. Not touching that.
        if (locals.payrollObject[phoneNumber][yesterdayDate]) return;

        locals.payrollObject[phoneNumber][yesterdayDate] = 'BLANK';
      });

      return locals
        .initDoc
        .ref
        .set({
          payrollObject: locals.payrollObject,
        }, {
            merge: true,
          });
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      Object.keys(countsObject).forEach((phoneNumber) => {
        countsObject[phoneNumber].total =
          countsObject[phoneNumber].fullDay
          + countsObject[phoneNumber].halfDay
          + countsObject[phoneNumber].leave
          + countsObject[phoneNumber].holiday
          + countsObject[phoneNumber].blank
          + countsObject[phoneNumber].late
          + countsObject[phoneNumber].onDuty
          + countsObject[phoneNumber].weeklyOff;
      });

      locals.csvString = topRow(locals.timezone);
      const lastDayDate = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .subtract(1, 'day')
        .date();
      const commaStart = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .date();
      const commaEnd = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .daysInMonth();

      locals.employeesPhoneNumberList.forEach((phoneNumber) => {
        if (!locals.employeesData[phoneNumber]) return;

        /**
         * Activity `createTime` is the time at which the user has been
         * on the platform.
         */
        const liveSince = dateStringWithOffset({
          timestampToConvert: locals.employeesData[phoneNumber].createTime,
          timezone: locals.timezone,
        });

        const baseLocation = (() => {
          if (!locals.employeesData[phoneNumber]) return '';

          return locals
            .employeesData[phoneNumber]['Base Location']
            .replace(/,/g, ' ')
            .replace(/-/g, ' ')
            .replace(/\s\s+/g, ' ');
        })();

        locals.csvString +=
          `${locals.employeesData[phoneNumber].Name},`
          // The tab character after the phone number disabled Excel's 
          // auto converting of the phone numbers into big numbers
          + ` ${phoneNumber}\t,`
          + ` ${locals.employeesData[phoneNumber].Department},`
          + ` ${baseLocation},`
          + ` ${liveSince},`;

        for (let date = 1; date <= lastDayDate; date++) {
          const status = locals.payrollObject[phoneNumber][date] || '';

          locals.csvString += `${status},`;
        }

        // Adds empty cells from current day to the month end
        for (let currDate = commaStart; currDate <= commaEnd; currDate++) {
          locals.csvString += `,`;
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

        locals.csvString += `\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `Payroll Report_${office}_${locals.standardDateString}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      console.log({
        report: locals.change.after.get('report'),
        to: locals.messageObject.to,
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
