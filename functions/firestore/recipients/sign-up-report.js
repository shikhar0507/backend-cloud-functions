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
  getYesterdaysDateString,
} = require('./report-utils');


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const today = new Date();

  console.log('Inside signup');

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
    + ` Contact Number,`
    + `\n`;

  const yesterdaysDateString = getYesterdaysDateString();

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        // .where('dateString', '==', yesterdaysDateString)
        .where('dateString', '==', new Date().toDateString())
        .where('report', '==', 'signup')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocs,
      ] = result;

      if (initDocs.empty) {
        console.log('Init docs empty.', 'signUps');

        return Promise.resolve();
      }

      const allEmployeesData = officeDoc.get('employeesData');
      let totalSignUpsCount = 0;

      const {
        employeesObject,
      } = initDocs.docs[0].data();

      const employeesList = Object.keys(employeesObject);

      const getName = (phoneNumber) => {
        if (!allEmployeesData[phoneNumber]) return '';

        return allEmployeesData[phoneNumber].Name;
      };

      employeesList.forEach((phoneNumber) => {
        const employeeData = allEmployeesData[phoneNumber];

        const employeeName = employeeData.Name;
        const employeeCode = employeeData['Employee Code'];
        const department = employeeData.Department;
        const addedOn = employeeData.createTime.toDate().toDateString();
        const signedUpOn = employeesObject[phoneNumber].signedUpOn;
        const firstSupervisorPhoneNumber =
          employeeData['First Supervisor'];
        const secondSupervisorPhoneNumber =
          employeeData['Second Supervisor'];
        const firstSupervisorName = getName(firstSupervisorPhoneNumber);
        const secondSupervisorName = getName(secondSupervisorPhoneNumber);

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
          + `${secondSupervisorPhoneNumber},`
          + `\n`;

        if (signedUpOn) totalSignUpsCount++;
      });

      locals.messageObject.templateId = sendGridTemplateIds.signUps;
      locals.messageObject['dynamic_template_data'] = {
        office,
        date: today.toDateString(),
        subject: `${office} Sign-Up Report_${today.toDateString()}`,
        totalEmployees: employeesList.length,
        totalSignUps: totalSignUpsCount,
        difference: employeesList.length - totalSignUpsCount,
      };
      locals
        .messageObject.attachments.push({
          content: new Buffer(locals.csvString).toString('base64'),
          fileName: `${office} Sign-Up Report_${today.toDateString()}.csv`,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log('locals.messageObject', locals.messageObject);

      return locals.sgMail.send(locals.messageObject);
    })
    .catch((error) => {
      if (error.response) {
        console.log(error.response.body.errors);
      } else {
        console.error(error);
      }
    });
};
