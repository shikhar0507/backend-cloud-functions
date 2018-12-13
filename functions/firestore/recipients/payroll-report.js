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


const {
  rootCollections,
} = require('../../admin/admin');

const {
  sendGridTemplateIds,
  dateFormats,
} = require('../../admin/constants');

const moment = require('moment');

const {
  monthsArray,
  weekdaysArray,
  momentDateObject,
  dateStringWithOffset,
} = require('./report-utils');

const NUM_DAYS_IN_PREV_MONTH = moment().subtract(1, 'day').daysInMonth();


const topRow = (() => {
  let str = ` Employee Name,`
    + ` Employee Contact,`
    + ` Department,`
    + ` Base Location,`
    + ` Live Since,`;

  const yesterday = moment().subtract(1, 'days');
  const monthNumber = yesterday.month();
  const monthName = monthsArray[monthNumber];

  /** Human readable dates start with 1. */
  for (let dayNumber = 1; dayNumber <= NUM_DAYS_IN_PREV_MONTH; dayNumber++) {
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
})();


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const countsObject = {};
  const standardDateString = moment().format(dateFormats.DATE);

  locals.csvString = topRow;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: standardDateString,
    subject: `Payroll Report_${office}_${standardDateString}`,
  };

  locals.messageObject.templateId = sendGridTemplateIds.payroll;
  locals.toSendEmail = true;

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', 'payroll')
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
        officeDoc,
        initDocsQuery,
        branchDocsQuery,
      ] = result;

      if (initDocsQuery.empty) {
        locals.toSendEmail = false;

        console.log('Init docs not found.');

        return Promise.resolve();
      }

      const yesterday = moment().subtract(1, 'days');
      const yesterdayDate = yesterday.date();
      const weekdayName = weekdaysArray[yesterday.day()];
      const prevDayStart = yesterday.startOf('day').unix() * 1000;
      const prevDayEnd = yesterday.endOf('day').unix() * 1000;
      const branchesWithHoliday = new Set();

      branchDocsQuery.forEach((branchDoc) => {
        const branchName = branchDoc.get('attachment.Name.value');
        const scheduleArray = branchDoc.get('schedule');

        scheduleArray.forEach((schedule) => {
          if (!schedule.startTime || !schedule.endTime) return;

          if (schedule.startTime >= prevDayStart
            && schedule.endTime < prevDayEnd) {
            branchesWithHoliday.add(branchName);
          }
        });
      });

      const initDoc = initDocsQuery.docs[0];
      const employeesData = officeDoc.get('employeesData');
      const employeesPhoneNumberList = Object.keys(employeesData);
      const payrollObject = initDoc.get('payrollObject');
      const payrollPhoneNumbers = Object.keys(payrollObject);

      /** 
       * If the day is a WEEKLY_OFF or a HOLIDAY, not fetching check-ins
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
          total: 0,
        };

        const employeeData = employeesData[phoneNumber];
        const weeklyOffWeekdayName = employeeData['Weekly Off'];
        const baseLocation = employeeData['Base Location'];

        Object
          .keys(payrollObject[phoneNumber])
          .forEach((date) => {
            /** 
             * ON DUTY field is handled by `addendumOnCreate` when someone creates
             * a tour plan.
             */
            if (payrollObject[phoneNumber][date] === 'ON DUTY') {

              countsObject[phoneNumber].onDuty
                = countsObject[phoneNumber].onDuty + 1;

              return;
            }

            if (payrollObject[phoneNumber][date].startsWith('LEAVE')) {
              countsObject[phoneNumber].leave
                = countsObject[phoneNumber].leave + 1;

              return;
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

      console.log({ employeesWithInit });

      const promises = [];
      const addendumRef = rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum');

      employeesPhoneNumberList.forEach((phoneNumber) => {
        if (employeesWithInit.has(phoneNumber)) return;

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
            total: 0,
          };
        }

        if (!payrollObject[phoneNumber]) payrollObject[phoneNumber] = {};

        const query = addendumRef
          .where('template', '==', 'check-in')
          .where('date', '==', momentDateObject.yesterday.DATE_NUMBER)
          .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
          .where('year', '==', momentDateObject.yesterday.YEAR)
          .where('user', '==', 'phoneNumber')
          .where('distanceAccurate', '==', true)
          .orderBy('timestamp', 'asc')
          .get();

        promises.push(query);
      });

      locals.employeesData = employeesData;
      locals.payrollObject = payrollObject;
      locals.initDoc = initDocsQuery.docs[0];
      locals.employeesPhoneNumberList = employeesPhoneNumberList;
      locals.timezone = officeDoc.get('attachment.Timezone.value');

      return Promise.all(promises);
    })
    .then((checkInActivitiesAddendumQuery) => {
      if (!locals.toSendEmail) return Promise.resolve();

      const yesterdayDate = moment().subtract(1, 'days').date();
      const NUM_SECS_IN_HOUR = 3600;
      const eightHours = NUM_SECS_IN_HOUR * 8;
      const fourHours = NUM_SECS_IN_HOUR * 4;

      checkInActivitiesAddendumQuery.forEach((snapShot) => {
        if (snapShot.empty) return;

        const addendumDoc = snapShot.docs[0];
        const phoneNumber = addendumDoc.get('user');
        // `dailyStartHours` is in the format `HH:MM` in the `employeesData` object.
        const dailyStartHours
          = locals.employeesData[phoneNumber]['Daily Start Time'];

        const HALF_HOUR = 30;
        const split = dailyStartHours.split(':');
        const hours = Number(split[0]);
        const minutes = Number(split[1]) + HALF_HOUR;

        const employeeStartTime = moment()
          .subtract(1, 'days')
          .hours(hours)
          .minutes(minutes)
          .unix() * 1000;

        const firstCheckInTimestamp = addendumDoc.get('timestamp');
        const lastCheckInTimestamp = snapShot.docs[snapShot.size - 1].get('timestamp');

        /** Person created only 1 check-in. */
        if (firstCheckInTimestamp === lastCheckInTimestamp) {
          locals.payrollObject[phoneNumber][yesterdayDate] = 'BLANK';

          countsObject[phoneNumber].blank = countsObject[phoneNumber].blank + 1;

          return;
        }

        if (lastCheckInTimestamp - firstCheckInTimestamp >= eightHours) {
          if (firstCheckInTimestamp > employeeStartTime) {
            locals.payrollObject[phoneNumber][yesterdayDate] = 'LATE';

            countsObject[phoneNumber].late
              = countsObject[phoneNumber].late + 1;
          } else {
            locals.payrollObject[phoneNumber][yesterdayDate] = 'FULL DAY';

            countsObject[phoneNumber].fullDay
              = countsObject[phoneNumber].fullDay + 1;
          }
        }

        if (lastCheckInTimestamp - firstCheckInTimestamp >= fourHours
          && lastCheckInTimestamp - firstCheckInTimestamp < eightHours) {
          locals.payrollObject[phoneNumber][yesterdayDate] = 'HALF DAY';

          countsObject[phoneNumber].halfDay
            = countsObject[phoneNumber].halfDay + 1;
        }
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
      if (!locals.toSendEmail) return Promise.resolve();

      // const NUM_DAYS_IN_PREV_MONTH = moment().subtract(1, 'day').daysInMonth();

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

        locals.csvString +=
          `${locals.employeesData[phoneNumber].Name},`
          + ` ${phoneNumber}\t,`
          + ` ${locals.employeesData[phoneNumber].Department},`
          + ` ${locals.employeesData[phoneNumber]['Base Location']},`
          + ` ${liveSince},`;

        for (let i = 1; i <= NUM_DAYS_IN_PREV_MONTH; i++) {
          const status = locals.payrollObject[phoneNumber][i] || '';

          locals.csvString += `${status},`;
        }

        locals.csvString +=
          `${countsObject[phoneNumber].fullDay},`
          + `${countsObject[phoneNumber].halfDay},`
          + `${countsObject[phoneNumber].leave},`
          + `${countsObject[phoneNumber].holiday},`
          + `${countsObject[phoneNumber].blank},`
          + `${countsObject[phoneNumber].late},`
          + `${countsObject[phoneNumber].onDuty},`
          + `${countsObject[phoneNumber].weeklyOff}`
          + `${countsObject[phoneNumber].total}`;

        locals.csvString += `\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Payroll`
          + ` Report_${moment().format(dateFormats.DATE)}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
