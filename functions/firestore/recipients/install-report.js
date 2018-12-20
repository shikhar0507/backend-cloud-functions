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
  reportNames,
  sendGridTemplateIds,
  dateFormats,
} = require('../../admin/constants');
const {
  rootCollections,
} = require('../../admin/admin');
const {
  employeeInfo,
  momentOffsetObject,
  dateStringWithOffset,
} = require('./report-utils');

const momentTz = require('moment-timezone');


module.exports = (locals) => {
  const office = locals.change.after.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);
  const standardDateString = momentTz().format(dateFormats.DATE);

  locals.messageObject.templateId = sendGridTemplateIds.installs;
  locals.csvString =
    `Employee Name,`
    + ` Employee Contact,`
    + ` Installed On,`
    + ` Number Of Installs,`
    + ` Employee Code,`
    + ` Department,`
    + ` First Supervisor's Name,`
    + ` Contact Number,`
    + ` Second Supervisor's Name,`
    + ` Contact Number\n`;

  locals.messageObject['dynamic_template_data'] = {
    office,
    date: standardDateString,
    subject: `Install Report_${office}_${standardDateString}`,
  };

  locals.multipleInstallsMap = new Map();

  Promise
    .all([
      // rootCollections
      //   .offices
      //   .doc(officeId)
      //   .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.INSTALL)
        .where('date', '==', momentDateObject.yesterday.DATE_NUMBER)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .get(),
    ])
    .then((result) => {
      const [
        // officeDoc,
        initDocsQuery,
      ] = result;

      if (initDocsQuery.empty) {
        /** No report to be sent since no one installed yesterday. */
        return Promise.resolve();
      }

      let header = 'Install Date and Time\n\n';
      const timezone = locals.officeDoc.get('attachment.Timezone.value');
      const employeesData = locals.officeDoc.get('employeesData');

      const yesterdaysStartTime =
        momentTz()
          .utc()
          .subtract(1, 'days')
          .startOf('day')
          .unix() * 1000;

      initDocsQuery.forEach((doc) => {
        const {
          phoneNumber,
          installs,
        } = doc.data();

        installs.forEach((timestampNumber) => {
          const installTimeString = dateStringWithOffset({
            timezone,
            timestampToConvert: timestampNumber,
            format: 'lll',
          });

          header += `${installTimeString}\n`;
        });

        installs.forEach((timestampNumber) => {
          if (timestampNumber > yesterdaysStartTime) return;

          locals.multipleInstallsMap.set(phoneNumber, header);
        });

        /** Latest install timestamp */
        const installedOn = dateStringWithOffset({
          timestampToConvert: installs[installs.length - 1],
          timezone,
        });
        const numberOfInstalls = installs.length;
        const employeeObject = employeeInfo(employeesData, phoneNumber);
        const name = employeeObject.name;
        const firstSupervisorPhoneNumber = employeeObject.firstSupervisor;
        const secondSupervisorPhoneNumber = employeeObject.secondSupervisor;
        const department = employeeObject.department;
        const employeeCode = employeeObject.employeeCode;
        const firstSupervisorsName =
          employeeInfo(employeesData, firstSupervisorPhoneNumber).name;
        const secondSupervisorsName =
          employeeInfo(employeesData, secondSupervisorPhoneNumber).name;

        locals.csvString +=
          `${name},`
          + `${phoneNumber},`
          + `${installedOn},`
          + `${numberOfInstalls},`
          + ` ${employeeCode},`
          + `${department},`
          + ` ${firstSupervisorsName},`
          + ` ${firstSupervisorPhoneNumber},`
          + ` ${secondSupervisorsName},`
          + ` ${secondSupervisorPhoneNumber}`;

        locals.csvString += `\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Install Report_${standardDateString}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      locals
        .multipleInstallsMap
        .forEach((timestampsString, phoneNumber) => {
          locals.messageObject.attachments.push({
            content: new Buffer(timestampsString).toString('base64'),
            fileName: `${phoneNumber}.txt`,
            type: 'text/plain',
            disposition: 'attachment',
          });
        });

      console.log({
        report: locals.change.after.get('report'),
        to: locals.messageObject.to,
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
