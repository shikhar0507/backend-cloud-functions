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
} = require('../../admin/constants');

const {
  monthsArray,
  getYesterdaysDateString,
  getPreviousDayMonth,
  getNumberOfDaysInMonth,
} = require('./report-utils');


const getHeader = () => {
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
  ];
  let str = ` Employee Name,`
    + ` Employee Contact,`
    + ` Department,`
    + ` Base Location,`
    + ` Live Since, `;

  const today = new Date();
  const monthName = monthNames[today.getMonth()];
  const numberOfDays = getNumberOfDaysInMonth({
    month: today.getMonth(),
    year: today.getFullYear(),
  });

  /** Human readable dates start with 1. */
  for (let dayNumber = 1; dayNumber <= numberOfDays; dayNumber++) {
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
  const yesterdaysDateString = getYesterdaysDateString();
  const countsObject = {};
  const today = new Date();
  const yesterday = new Date(today.setDate(today.getDate() - 1));
  locals.csvString = getHeader();
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: yesterdaysDateString,
    subject: `Payroll Report_${office}_${yesterdaysDateString}`,
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
        .where('month', '==', getPreviousDayMonth())
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

        return Promise.resolve(false);
      }

      const weekdays = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ];

      const weekdayName = weekdays[yesterday.getDay()];
      const prevDayStart
        = new Date(yesterday.setHours(0, 0, 0)).getTime();
      const prevDayEnd
        = new Date(yesterday.setHours(23, 59, 59)).getTime();
      const branchesWithHoliday = new Set();

      branchDocsQuery.forEach((branchDoc) => {
        const branchName = branchDoc.get('attachment.Name.value');
        const scheduleArray = branchDoc.get('schedule');

        scheduleArray.forEach((schedule) => {
          let startTime = schedule.startTime;
          let endTime = schedule.endTime;

          if (startTime === '' || endTime === '') return;

          startTime = startTime.toDate().getTime();
          endTime = endTime.toDate().getTime();

          if (startTime >= prevDayStart && endTime < prevDayEnd) {
            branchesWithHoliday.add(branchName);
          }
        });
      });

      const initDoc
        = initDocsQuery.docs[0];
      const employeesData
        = officeDoc.get('employeesData');
      const employeesPhoneNumberList
        = Object.keys(employeesData);
      const payrollObject
        = initDoc.get('payrollObject');
      const payrollPhoneNumbers = Object.keys(payrollObject);
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
        const weeklyOff = employeeData['Weekly Off'];
        const baseLocation = employeeData['Base Location'];

        Object
          .keys(payrollObject[phoneNumber])
          .forEach((date) => {
            if (payrollObject[phoneNumber][date] !== 'ON DUTY') return;

            countsObject[phoneNumber].onDuty
              = countsObject[phoneNumber].onDuty + 1;
          });

        if (weeklyOff === weekdayName) {
          payrollObject[phoneNumber][yesterday.getDate()] = 'WEEKLY OFF';
          countsObject[phoneNumber].weeklyOff
            = countsObject[phoneNumber].weeklyOff + 1;
        }

        if (branchesWithHoliday.has(baseLocation)) {
          payrollObject[phoneNumber][yesterday.getDate()] = 'HOLIDAY';
          countsObject[phoneNumber].holiday
            = countsObject[phoneNumber].holiday + 1;
        }

        employeesWithInit.add(phoneNumber);
      });

      const promises = [];
      const addendumRef = rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum');

      employeesPhoneNumberList.forEach((phoneNumber) => {
        if (employeesWithInit.has(phoneNumber)) return;

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

        payrollObject[phoneNumber] = {};

        const query = addendumRef
          .where('template', '==', 'check-in')
          .where('dateString', '==', yesterdaysDateString)
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

      return Promise.all(promises);
    })
    .then((snapShots) => {
      if (!snapShots) return Promise.resolve();

      const NUM_SECS_IN_HOUR = 3600;
      const eightHours = NUM_SECS_IN_HOUR * 8;
      const fourHours = NUM_SECS_IN_HOUR * 4;

      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const employeeStartTime = new Date();
        const phoneNumber = snapShot.docs[0].get('user');
        const dailyStartTime = locals.employeesData[phoneNumber]['Daily Start Time'];
        employeeStartTime.setHours(Number(dailyStartTime.split(':')[0]));
        employeeStartTime.setMinutes(Number(dailyStartTime.split(':')[1]) + 30);

        const firstCheckInTimestamp =
          snapShot
            .docs[0]
            .get('timestamp')
            .toDate()
            .getTime();
        const lastCheckInTimestamp =
          snapShot
            .docs[snapShot.size - 1]
            .get('timestamp')
            .toDate()
            .getTime();

        /** Person created only 1 check-in. */
        if (firstCheckInTimestamp === lastCheckInTimestamp) {
          locals.payrollObject[phoneNumber][yesterday.getDate()] = 'BLANK';
          countsObject[phoneNumber].blank = countsObject[phoneNumber].blank + 1;

          return;
        }

        if (lastCheckInTimestamp - firstCheckInTimestamp >= eightHours) {
          if (firstCheckInTimestamp > employeeStartTime.getTime()) {
            locals.payrollObject[phoneNumber][yesterday.getDate()] = 'LATE';
            countsObject[phoneNumber].late = countsObject[phoneNumber].late + 1;

            return;
          }

          locals.payrollObject[phoneNumber][yesterday.getDate()] = 'FULL DAY';

          countsObject[phoneNumber].fullDay
            = countsObject[phoneNumber].fullDay + 1;
        }

        if (lastCheckInTimestamp - firstCheckInTimestamp >= fourHours
          && lastCheckInTimestamp - firstCheckInTimestamp < eightHours) {
          locals.payrollObject[phoneNumber][yesterday.getDate()] = 'HALF DAY';

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

      const today = new Date();

      const NUM_DAYS_IN_MONTH = getNumberOfDaysInMonth({
        year: today.getFullYear(),
        month: today.getMonth(),
      });

      locals.employeesPhoneNumberList.forEach((phoneNumber) => {
        /**
         * Activity `createTime` is the time at which the user has been
         * on the platform.
         */
        let liveSince = '';

        /**
         * TODO: Remove this if condition.
         *  Once all the currently created employee activities are updated.
         */
        if (locals.employeesData[phoneNumber].createTime) {
          const timestamp
            = locals.employeesData[phoneNumber].createTime.toDate();
          const date = timestamp.getDate();
          const year = timestamp.getFullYear();
          const month = monthsArray[timestamp.getMonth()];

          liveSince = `${date} ${month} ${year}`;
        }

        locals.csvString +=
          `${locals.employeesData[phoneNumber].Name},`
          + ` ${phoneNumber},`
          + ` ${locals.employeesData[phoneNumber].Department},`
          + ` ${locals.employeesData[phoneNumber]['Base Location']},`
          + ` ${liveSince},`;

        for (let i = 0; i < NUM_DAYS_IN_MONTH; i++) {
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
          + `${countsObject[phoneNumber].weeklyOff}`;

        locals.csvString += `\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Payroll Report_${yesterdaysDateString}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      console.log('csvString', locals.csvString);
      console.log('messageObject', locals.messageObject);

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch((error) => {
      if (error.response) {
        console.log(error.response.body.errors);
      } else {
        console.error(error);
      }
    });
};
