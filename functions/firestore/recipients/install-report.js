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
  sendGridTemplateIds,
} = require('../../admin/constants');
const {
  rootCollections,
} = require('../../admin/admin');

const {
  timeStringWithOffset,
  getYesterdaysDateString,
} = require('./report-utils');

/**
 * Returns yesterday's Day start timestamp.
 * @returns {Object} JS date object of the previous day starting timestamp.
 */
const getYesterdaysStartTime = () => {
  const today = new Date();
  today.setHours(0, 0, 0);

  return new Date(today.setDate(today.getDate() - 1));
};


const getName = (employeesData, phoneNumber) => {
  if (!employeesData[phoneNumber]) return '';

  return employeesData[phoneNumber].Name;
};


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();
  const today = new Date();

  const yesterdaysDateString = getYesterdaysDateString();

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
    + ` Contact Number,\n`;

  locals.messageObject['dynamic_template_data'] = {
    office,
    date: today.toDateString(),
    subject: `Install Report_${office}_${today.toDateString()}`,
  };

  locals.multipleInstallsMap = new Map();

  Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', 'install')
        .where('dateString', '==', yesterdaysDateString)
        .get(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocsQuery,
      ] = result;

      if (initDocsQuery.empty) {
        console.log('Install docs empty');

        /** No report to be sent since no one installed yesterday. */
        return Promise.resolve();
      }

      // Collecting the list of people who have multiple installs for yesterday.
      const yesterdaysStartTime = getYesterdaysStartTime();

      let header = 'Install Date and Time\n\n';
      const timezone = officeDoc.get('attachment.Timezone.value');

      initDocsQuery.forEach((doc) => {
        const {
          phoneNumber,
          installs,
        } = doc.data();

        const employeeData =
          officeDoc
            .get('employeesData')[phoneNumber];


        installs.forEach((timestampNumber) => {
          const installTimeString = timeStringWithOffset({
            timezone,
            timestampNumber,
          });

          header += `${installTimeString}\n`;
        });

        installs.forEach((timestampString) => {
          const installTime =
            new Date(timestampString).getTime();

          if (installTime > yesterdaysStartTime) return;

          locals.multipleInstallsMap.set(phoneNumber, header);
        });

        /** Latest install timestamp */
        const installedOn = installs[installs.length - 1];
        const numberOfInstalls = installs.length;
        const firstSupervisorPhoneNumber =
          employeeData['First Supervisor'];
        const secondSupervisorPhoneNumber =
          employeeData['Second Supervisor'];
        const firstSupervisorsName =
          getName(officeDoc.get('employeesData'), firstSupervisorPhoneNumber);
        const secondSupervisorsName =
          getName(officeDoc.get('employeesData'), secondSupervisorPhoneNumber);

        locals.csvString +=
          `${employeeData.Name},`
          + `${phoneNumber},`
          + `${installedOn},`
          + `${numberOfInstalls},`
          + ` ${employeeData['Employee Code']},`
          + `${employeeData.Department},`
          + ` ${firstSupervisorsName},`
          + ` ${firstSupervisorPhoneNumber},`
          + ` ${secondSupervisorsName},`
          + ` ${secondSupervisorPhoneNumber}`
          + `\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Install Report_${yesterdaysDateString}.csv`,
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

      console.log('locals:', locals);

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
