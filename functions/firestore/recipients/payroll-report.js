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
const momentTz = require('moment-timezone');
const {
  deleteField,
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
  reportNames,
} = require('../../admin/constants');

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
  const monthName = monthsArray[yesterday.month()];

  for (let dayNumber = yesterday.date(); dayNumber >= 1; dayNumber--) {
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
    + ` TOTAL`;

  str += `\n`;

  return str;
};


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const momentDateObject = momentOffsetObject(locals.timezone);
  const peopleWithBlank = new Set();
  const countsObject = {};
  const leavesSet = new Set();
  const branchHolidaySet = new Set();
  const weeklyOffSet = new Set();
  /** People with the status ON DUTY */
  const onDutySet = new Set();
  /** Stores the type of leave a person has taken for the day */
  const leaveTypesMap = new Map();

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

      const yesterday = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .subtract(1, 'days');
      const yesterdayDate = yesterday.date();
      const yesterdayStartTimestamp = yesterday.startOf('day').unix() * 1000;
      const yesterdayEndTimestamp = yesterday.endOf('day').unix() * 1000;
      const branchesWithHoliday = new Set();

      console.log({ yesterdayDate });

      branchDocsQuery.forEach((branchDoc) => {
        branchDoc
          .get('schedule')
          .forEach((schedule) => {
            if (schedule.startTime >= yesterdayStartTimestamp
              && schedule.endTime < yesterdayEndTimestamp) {
              branchesWithHoliday
                .add(branchDoc.get('attachment.Name.value'));
            }
          });
      });

      const payrollObject = (() => {
        if (initDocsQuery.empty) {
          return {};
        }

        return initDocsQuery.docs[0].get('payrollObject') || {};
      })();

      console.log({
        initDocsQuery: !initDocsQuery.empty ? initDocsQuery.docs[0].id : null,
      });

      const employeesData = locals.officeDoc.get('employeesData');
      const employeesPhoneNumberList = Object.keys(employeesData);
      const payrollPhoneNumbers = Object.keys(payrollObject);
      const weekdayName = weekdaysArray[yesterday.day()];

      payrollPhoneNumbers.forEach((phoneNumber) => {
        if (!employeesData[phoneNumber]) {
          return;
        }

        const weeklyOffWeekdayName = employeesData[phoneNumber]['Weekly Off'];
        const baseLocation = employeesData[phoneNumber]['Base Location'];

        Object
          .keys(payrollObject[phoneNumber])
          .forEach((date) => {
            if (!countsObject[phoneNumber]) {
              countsObject[phoneNumber] = getZeroCountsObject();
            }

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
              payrollObject[phoneNumber[yesterdayDate]] = deleteField();
            }

            /**
             * STATUS PRIORITY
             * HIGH ==> LOW
             * LEAVE, ON-DUTY,
             * HOLIDAY, WEEKLY OFF, 
             * HALF DAY, LATE, FULL DAY, 
             * BLANK
             */
            const status = payrollObject[phoneNumber][date] || '';
            /** 
             * `ON DUTY` and `LEAVE` fields are handled 
             *  by `addendumOnCreate` when someone creates
             *  a tour plan.
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

              peopleWithBlank.add(phoneNumber);
            }
          });

        if (payrollObject[phoneNumber][yesterdayDate]
          && payrollObject[phoneNumber][yesterdayDate].startsWith('LEAVE')) {
          leavesSet.add(phoneNumber);
          leaveTypesMap
            .set(phoneNumber, payrollObject[phoneNumber][yesterdayDate]);

          return;
        }

        if (payrollObject[phoneNumber][yesterdayDate] === 'ON DUTY') {
          onDutySet.add(phoneNumber);

          return;
        }

        if (branchesWithHoliday.has(baseLocation)) {
          payrollObject[phoneNumber][yesterdayDate] = 'HOLIDAY';

          branchHolidaySet.add(phoneNumber);

          return;
        }

        if (weeklyOffWeekdayName === weekdayName) {
          payrollObject[phoneNumber][yesterdayDate] = 'WEEKLY OFF';

          weeklyOffSet.add(phoneNumber);
        }
      });

      const checkInPromises = [];

      employeesPhoneNumberList.forEach((phoneNumber) => {
        if (!countsObject[phoneNumber]) {
          countsObject[phoneNumber] = getZeroCountsObject();
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

        checkInPromises.push(query);
      });

      locals.employeesData = employeesData;
      locals.payrollObject = payrollObject;
      locals.initDocsQuery = initDocsQuery;
      locals.employeesPhoneNumberList = employeesPhoneNumberList;

      return Promise
        .all(checkInPromises);
    })
    .then((checkInActivitiesAddendumQuery) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      const yesterdayDate = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .subtract(1, 'days')
        .date();
      const NUM_MILLI_SECS_IN_HOUR = 3600 * 1000;
      const EIGHT_HOURS = NUM_MILLI_SECS_IN_HOUR * 8;
      const FOUR_HOURS = NUM_MILLI_SECS_IN_HOUR * 4;

      checkInActivitiesAddendumQuery.forEach((snapShot) => {
        if (snapShot.empty) {
          // This person did nothing on the day. Report will
          // show `BLANK` for the date
          return;
        }

        const addendumDoc =
          snapShot
            .docs[0];
        const phoneNumber =
          addendumDoc
            .get('user');
        // `dailyStartHours` is in the format `HH:MM` in the `employeesData` object.
        const dailyStartHours
          = locals
            .employeesData[phoneNumber]['Daily Start Time'];
        const dailyEndHours
          = locals
            .employeesData[phoneNumber]['Daily End Time'];

        // People with no `startTime` or `endTime` set have variable working hours...
        if (!dailyStartHours || !dailyEndHours) {
          locals
            .payrollObject[phoneNumber][yesterdayDate] = `FULL DAY`;

          return;
        }

        // No need to convert the strings to Number becaue moment handles it automatically.
        const [startHours, startMinutes] = dailyStartHours.split(':');
        const [endHours, endMinutes] = dailyEndHours.split(':');

        // Data is created for the previous day
        const employeeStartTime = momentTz()
          .utc()
          .subtract(1, 'days')
          .clone()
          .tz(locals.timezone)
          .hours(startHours)
          .minutes(startMinutes)
          .add(0.5, 'hours')
          .unix() * 1000;
        const employeeEndTime = momentTz()
          .utc()
          .subtract(1, 'days')
          .tz(locals.timezone)
          .hours(endHours)
          .minutes(endMinutes)
          .unix() * 1000;

        const firstCheckInTimestamp = snapShot.docs[0].get('timestamp');
        const lastCheckInTimestamp = snapShot.docs[snapShot.size - 1].get('timestamp');

        /** Person created only 1 `check-in`. */
        if (firstCheckInTimestamp === lastCheckInTimestamp) {
          locals.payrollObject[phoneNumber][yesterdayDate] = 'BLANK';
        }

        const checkInDiff =
          Math
            .abs(lastCheckInTimestamp - firstCheckInTimestamp);

        if (checkInDiff >= EIGHT_HOURS || lastCheckInTimestamp > employeeEndTime) {
          if (firstCheckInTimestamp >= employeeStartTime) {
            locals
              .payrollObject[phoneNumber][yesterdayDate] = 'LATE';

            return;
          }

          if (firstCheckInTimestamp < employeeStartTime) {
            locals
              .payrollObject[phoneNumber][yesterdayDate] = 'FULL DAY';

            return;
          }
        }

        if (checkInDiff >= FOUR_HOURS) {
          locals
            .payrollObject[phoneNumber][yesterdayDate] = 'HALF DAY';
        }
      });

      Object
        .keys(locals.payrollObject)
        .forEach((phoneNumber) => {
          if (leavesSet.has(phoneNumber)) {
            locals
              .payrollObject[phoneNumber][yesterdayDate] =
              leaveTypesMap.get(phoneNumber);

            return;
          }

          if (onDutySet.has(phoneNumber)) {
            locals
              .payrollObject[phoneNumber][yesterdayDate] = 'ON DUTY';

            return;
          }

          if (branchHolidaySet.has(phoneNumber)) {
            locals
              .payrollObject[phoneNumber][yesterdayDate] = 'HOLIDAY';

            return;
          }

          if (weeklyOffSet.has(phoneNumber)) {
            locals
              .payrollObject[phoneNumber][yesterdayDate] = 'WEEKLY OFF';

            return;
          }

          /** 
           * If any value has been put in the `yesterdayDate` column 
           * for the employee, we will not put `BLANK`
           */
          if (locals.payrollObject[phoneNumber][yesterdayDate]) {
            return;
          }

          // Person hasn't done anything. AND yesterday was also not
          // a holiday, on duty, or a leave will get blank
          locals
            .payrollObject[phoneNumber][yesterdayDate] = 'BLANK';

          peopleWithBlank.add(phoneNumber);
        });

      const ref = (() => {
        if (locals.initDocsQuery.empty) {
          return rootCollections.inits.doc();
        }

        return locals.initDocsQuery.docs[0].ref;
      })();

      return ref
        .set({
          month: locals.change.after.get('month'),
          year: locals.change.after.get('year'),
          office: locals.officeDoc.get('attachment.Name.value'),
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
        .csvString = topRow(locals.timezone);

      const lastDayDate = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .subtract(1, 'days')
        .date();

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

        const baseLocation =
          locals
            .employeesData[phoneNumber]['Base Location']
            .replace(/,/g, ' ')
            .replace(/-/g, ' ')
            .replace(/\s\s+/g, ' ');

        locals
          .csvString +=
          `${locals.employeesData[phoneNumber].Name},`
          // The tab character after the phone number disabled Excel's 
          // auto converting of the phone numbers into big numbers
          + ` ${phoneNumber}\t,`
          + ` ${locals.employeesData[phoneNumber].Department},`
          + ` ${baseLocation},`
          + ` ${liveSince},`;

        for (let date = lastDayDate; date >= 1; date--) {
          // const status = locals.payrollObject[phoneNumber][date];

          // The OR case with empty strings is required. Omitting that will
          // cause the excel sheet to show the value `undefined` in all non available
          // dates for the employee
          locals
            .csvString += `${locals.payrollObject[phoneNumber][date] || ''},`;
        }

        locals.
          csvString +=
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
          date: locals.standardDateString,
          subject: `Payroll Report_${office}_${locals.standardDateString}`,
        };

      locals
        .messageObject
        .attachments
        .push({
          content: Buffer.from(locals.csvString).toString('base64'),
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
    .then(() => {
      const promises = [];

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
      const msg = (dateString) => {
        // `There was a blank in your payroll for yesterday.`
        //   + ` Would you like to create a LEAVE or TOUR PLAN`;

        return `We detected a 'BLANK' in your Payroll`
          + ` on ${dateString}. Do you wish to apply`
          + ` for a Leave or a Tour Plan?`;
      };

      const promises = [];
      const dateString = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .subtract(1, 'days')
        .format(dateFormats.DATE);

      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          return;
        }

        const registrationToken = snapShot.docs[0].get('registrationToken');

        if (!registrationToken) {
          return;
        }

        const promise = admin
          .messaging()
          .sendToDevice(registrationToken, {
            data: {
              key1: 'value1',
              key2: 'value2',
            },
            notification: {
              body: msg(dateString),
              tile: `Growthfile`,
            },
          });

        promises.push(promise);
      });

      return Promise.all(promises);
    })
    .catch(console.error);
};
