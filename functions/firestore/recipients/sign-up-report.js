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
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  dateStringWithOffset,
  employeeInfo,
  alphabetsArray,
} = require('./report-utils');
const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');
const momentTz = require('moment-timezone');


module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const timestampFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentWithOffsetToday = momentTz(timestampFromTimer).tz(timezone);
  const momentWithOffsetYesterday = momentTz(timestampFromTimer).subtract(1, 'day').tz(timezone);
  const standardDateString = momentWithOffsetToday.format(dateFormats.DATE);
  const employeesData = locals.officeDoc.get('employeesData');
  const fileName = `Sign-Up Report_${office}_${standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('date', '==', momentWithOffsetYesterday.date())
        .where('month', '==', momentWithOffsetYesterday.month())
        .where('year', '==', momentWithOffsetYesterday.year())
        .where('report', '==', reportNames.SIGNUP)
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        initDocsQuery,
        workbook,
      ] = result;

      if (initDocsQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      const sheet1 = workbook.addSheet('SignUps');
      sheet1.row(1).style('bold', true);
      workbook.deleteSheet('Sheet1');

      [
        `Employee Name`,
        `Employee Contact`,
        `Employee Added Date`,
        `Sign-Up Date`,
        `Employee Code`,
        `Department`,
        `First Supervisor's Name`,
        `Contact Number`,
        `Second Supervisor's Name`,
        `Contact Number`,
      ].forEach((header, index) => {
        sheet1
          .cell(`${alphabetsArray[index]}1`)
          .value(header);
      });

      let totalSignUpsCount = 0;

      const employeesObject = initDocsQuery.docs[0].get('employeesObject');
      const employeesList = Object.keys(employeesObject);

      employeesList.forEach((phoneNumber, index) => {
        const columnNumber = index + 2;
        const employeeDataObject = employeeInfo(employeesData, phoneNumber);
        const employeeName = employeeDataObject.name;
        const employeeCode = employeeDataObject.employeeCode;
        const department = employeeDataObject.department;
        const firstSupervisorPhoneNumber = employeeDataObject.firstSupervisor;
        const secondSupervisorPhoneNumber = employeeDataObject.secondSupervisor;
        const firstSupervisor = employeeInfo(
          employeesData,
          firstSupervisorPhoneNumber
        );
        const secondSupervisor = employeeInfo(
          employeesData,
          secondSupervisorPhoneNumber
        );
        const signedUpOn = dateStringWithOffset({
          timezone: locals.timezone,
          timestampToConvert: employeesObject[phoneNumber].signedUpOn,
        });
        const addedOn = dateStringWithOffset({
          timezone: locals.timezone,
          timestampToConvert: employeesObject[phoneNumber].addedOn,
        });
        // This value could be an empty string
        if (signedUpOn) totalSignUpsCount++;

        sheet1.cell(`A${columnNumber}`).value(employeeName);
        sheet1.cell(`B${columnNumber}`).value(phoneNumber);
        sheet1.cell(`C${columnNumber}`).value(addedOn);
        sheet1.cell(`D${columnNumber}`).value(signedUpOn);
        sheet1.cell(`E${columnNumber}`).value(employeeCode);
        sheet1.cell(`F${columnNumber}`).value(department);
        sheet1.cell(`G${columnNumber}`).value(firstSupervisor.name);
        sheet1.cell(`H${columnNumber}`).value(firstSupervisorPhoneNumber);
        sheet1.cell(`I${columnNumber}`).value(secondSupervisor.name);
        sheet1.cell(`J${columnNumber}`).value(secondSupervisorPhoneNumber);
      });

      locals.messageObject['dynamic_template_data'] = {
        office,
        date: standardDateString,
        subject: `Sign-Up Report_${office}_${standardDateString}`,
        totalEmployees: employeesList.length,
        totalSignUps: totalSignUpsCount,
        difference: employeesList.length - totalSignUpsCount,
      };

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals.messageObject.attachments.push({
        fileName,
        content: fs.readFileSync(filePath).toString('base64'),
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
