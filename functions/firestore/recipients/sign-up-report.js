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
  reportNames,
  dateFormats,
} = require('../../admin/constants');

const {
  dateStringWithOffset,
  momentOffsetObject,
  employeeInfo,
} = require('./report-utils');

const moment = require('moment');


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  locals.csvString =
    `Employee Name,`
    + ` Employee Contact,`
    + ` Employee Added Date,`
    + ` Sign-Up Date,`
    + ` Employee Code,`
    + ` Department,`
    + ` First Supervisor's Name,`
    + ` Contact Number,`
    + ` Second Supervisor's Name,`
    + ` Contact Number`
    + `\n`;

  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('date', '==', momentDateObject.yesterday.DATE_NUMBER)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .where('report', '==', reportNames.SIGNUP)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocsQuery,
      ] = result;

      if (initDocsQuery.empty) {

        return Promise.resolve();
      }

      const allEmployeesData = officeDoc.get('employeesData');
      const timezone = officeDoc.get('attachment.Timezone.value');

      let totalSignUpsCount = 0;

      const {
        employeesObject,
      } = initDocsQuery.docs[0].data();

      const employeesList = Object.keys(employeesObject);

      employeesList.forEach((phoneNumber) => {
        const employeeDataObject = employeeInfo(allEmployeesData, phoneNumber);
        const employeeName = employeeDataObject.name;
        const employeeCode = employeeDataObject.employeeCode;
        const department = employeeDataObject.employeeCode;
        const firstSupervisorPhoneNumber = employeeDataObject.firstSupervisor;
        const secondSupervisorPhoneNumber = employeeDataObject.secondSupervisor;
        const firstSupervisorName =
          employeeInfo(allEmployeesData, firstSupervisorPhoneNumber).name;
        const secondSupervisorName =
          employeeInfo(allEmployeesData, secondSupervisorPhoneNumber).name;

        const signedUpOn = dateStringWithOffset({
          timezone,
          timestampToConvert: employeesObject[phoneNumber].signedUpOn,
        });
        const addedOn = dateStringWithOffset({
          timezone,
          timestampToConvert: employeesObject[phoneNumber].addedOn,
        });

        locals.csvString +=
          ` ${employeeName},`
          /**
           * Removing this space in front of phone number makes the
           * `MS Excel` believe that the phone number is a number (not string).
           */
          + ` ${phoneNumber},`
          + `${addedOn},`
          + `${signedUpOn},`
          + `${employeeCode},`
          + `${department},`
          + `${firstSupervisorName},`
          + `${firstSupervisorPhoneNumber},`
          + `${secondSupervisorName},`
          + `${secondSupervisorPhoneNumber}`
          + `\n`;

        if (signedUpOn) totalSignUpsCount++;
      });

      const standardDateString = moment().format(dateFormats.DATE);

      locals.messageObject.templateId = sendGridTemplateIds.signUps;
      locals.messageObject['dynamic_template_data'] = {
        office,
        date: standardDateString,
        subject: `Sign-Up ${office}_Report_${standardDateString}`,
        totalEmployees: employeesList.length,
        totalSignUps: totalSignUpsCount,
        difference: employeesList.length - totalSignUpsCount,
      };

      locals
        .messageObject.attachments.push({
          content: new Buffer(locals.csvString).toString('base64'),
          fileName: `${office} Sign-Up Report_${standardDateString}.csv`,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log({
        report: locals.change.after.get('report'),
        to: locals.messageObject.to,
      });

      return locals.sgMail.send(locals.messageObject);
    })
    .catch(console.error);
};
