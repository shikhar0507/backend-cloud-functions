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
  getYesterdaysDateString,
} = require('./report-utils');
const {
  sendGridTemplateIds,
} = require('../../admin/constants');

const xlsxPopulate = require('xlsx-populate');

module.exports = (locals) => {
  // TODO: REFACTOR THIS...
  const {
    office,
    officeId,
  } = locals.change.after.data();
  const todaysDateString = new Date().toDateString();
  const yesterdaysDateString = getYesterdaysDateString();
  const fileName = `${office} DSR Report_${yesterdaysDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  locals.messageObject.templateId = sendGridTemplateIds.dsr;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: todaysDateString,
    subject: `DSR_Office_${todaysDateString}`,
  };

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', 'dsr')
        .where('dateString', '==', yesterdaysDateString)
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocsQuery,
        workbook,
      ] = result;

      locals.sendMail = true;
      if (initDocsQuery.empty) {
        console.log('DSR Inits doc empty');

        locals.sendMail = false;

        return Promise.resolve();
      }

      // https://github.com/dtjohnson/xlsx-populate#rows-and-columns
      const sheet1 = workbook.addSheet('DSR Visits Report');
      sheet1.row(1).style('bold', true);
      const sheet2 = workbook.addSheet('DSR Follow-Up Report');
      sheet2.row(1).style('bold', true);
      const sheet3 = workbook.addSheet('DSR Closure Report');
      sheet3.row(1).style('bold', true);

      /** Delete the default worksheet. It's empty */
      workbook.deleteSheet('Sheet1');

      // TODO: PUT THIS IN A LOOP
      sheet1.cell('A1').value('Visit Date');
      sheet1.cell(`B1`).value('Employee Name');
      sheet1.cell(`C1`).value('Customer');
      sheet1.cell(`D1`).value('First Contact');
      sheet1.cell(`E1`).value('Second Contact');
      sheet1.cell(`F1`).value('Time');
      sheet1.cell(`G1`).value('Address');
      sheet1.cell(`H1`).value('Product 1');
      sheet1.cell(`I1`).value('Product 2');
      sheet1.cell(`J1`).value('Product 3');
      sheet1.cell(`K1`).value('Follow Up Date');
      sheet1.cell(`L1`).value('Comment');
      sheet1.cell(`M1`).value('Department');
      sheet1.cell(`N1`).value('Base Location');
      sheet1.cell(`O1`).value('First Supervisor');
      sheet1.cell(`P1`).value('Second Supervisor');

      sheet2.cell(`A1`).value('Follow Up Date');
      sheet2.cell(`B1`).value('Employee Name');
      sheet2.cell(`C1`).value('Customer');
      sheet2.cell(`D1`).value('First Contact');
      sheet2.cell(`E1`).value('Second Contact');
      sheet2.cell(`F1`).value('Time');
      sheet2.cell(`G1`).value('Address');
      sheet2.cell(`H1`).value('Product 1');
      sheet2.cell(`I1`).value('Product 2');
      sheet2.cell(`J1`).value('Product 3');
      sheet2.cell(`K1`).value('Visit Date');
      sheet2.cell(`L1`).value('Comment');
      sheet2.cell(`M1`).value('Department');
      sheet2.cell(`N1`).value('Base Location');
      sheet2.cell(`O1`).value('First Supervisor');
      sheet2.cell(`P1`).value('Second Supervisor');

      sheet3.cell(`A1`).value('Closure Date');
      sheet3.cell(`B1`).value('Employee Name');
      sheet3.cell(`C1`).value('Customer');
      sheet3.cell(`D1`).value('First Contact');
      sheet3.cell(`E1`).value('Second Contact');
      sheet3.cell(`F1`).value('Time');
      sheet3.cell(`G1`).value('Address');
      sheet3.cell(`H1`).value('Product 1');
      sheet3.cell(`I1`).value('Product 2');
      sheet3.cell(`J1`).value('Product 3');
      sheet3.cell(`K1`).value('Visit Date');
      sheet3.cell(`L1`).value('Follow Up Date');
      sheet3.cell(`M1`).value('Comment');
      sheet3.cell(`N1`).value('Department');
      sheet3.cell(`O1`).value('Base Location');
      sheet3.cell(`P1`).value('First Supervisor');
      sheet3.cell(`Q1`).value('Second Supervisor');

      const {
        visitsObject,
        followUpsObject,
        closureObject,
      } = initDocsQuery.docs[0].data();

      const {
        employeesData,
      } = officeDoc.data();

      const visitsPhoneNumbers
        = Object.keys(visitsObject);

      visitsPhoneNumbers.forEach((phoneNumber, index) => {
        const columnIndex = index + 2;
        const timeStringArray
          = Object.keys(visitsObject[phoneNumber]);

        timeStringArray.forEach((timeString) => {
          const {
            visitDate,
            customer,
            firstContact,
            secondContact,
            productOne,
            productTwo,
            productThree,
            followUpDate,
            comment,
          } = visitsObject[phoneNumber][timeString];

          const employeeName = employeesData[phoneNumber].Name;
          const address = '';
          const baseLocation = employeesData[phoneNumber]['Base Location'];
          const department = employeesData[phoneNumber].Department;
          const firstSupervisor = employeesData[phoneNumber]['First Supervisor'];
          const secondSupervisor = employeesData[phoneNumber]['Second Supervisor'];

          sheet1
            .cell(`A${columnIndex}`)
            .value(visitDate);
          sheet1
            .cell(`B${columnIndex}`)
            .value(employeeName);
          sheet1
            .cell(`C${columnIndex}`)
            .value(customer);
          sheet1
            .cell(`D${columnIndex}`)
            .value(firstContact);
          sheet1
            .cell(`E${columnIndex}`)
            .value(secondContact);
          sheet1
            .cell(`F${columnIndex}`)
            .value(timeString);
          sheet1
            .cell(`G${columnIndex}`)
            .value(address);
          sheet1
            .cell(`H${columnIndex}`)
            .value(productOne);
          sheet1
            .cell(`I${columnIndex}`)
            .value(productTwo);
          sheet1
            .cell(`J${columnIndex}`)
            .value(productThree);
          sheet1
            .cell(`K${columnIndex}`)
            .value(followUpDate);
          sheet1
            .cell(`L${columnIndex}`)
            .value(comment);
          sheet1
            .cell(`M${columnIndex}`)
            .value(department);
          sheet1
            .cell(`N${columnIndex}`)
            .value(baseLocation);
          sheet1
            .cell(`O${columnIndex}`)
            .value(firstSupervisor);
          sheet1
            .cell(`P${columnIndex}`)
            .value(secondSupervisor);
        });
      });

      const followUpPhoneNumbers = Object.keys(followUpsObject);

      followUpPhoneNumbers.forEach((phoneNumber, index) => {
        const columnIndex = index + 2;
        const timeStringArray = Object.keys(followUpsObject[phoneNumber]);

        timeStringArray.forEach((timeString) => {
          const {
            followUpDate,
            customer,
            firstContact,
            secondContact,
            productOne,
            productTwo,
            productThree,
            visitDate,
            closureDate,
            comment,
          } = followUpsObject[phoneNumber][timeString];
          const employeeName = employeesData[phoneNumber].Name;
          const address = '';
          const department = employeesData[phoneNumber].Department;
          const baseLocation = employeesData[phoneNumber]['Base Location'];
          const firstSupervisor = employeesData[phoneNumber]['First Supervisor'];
          const secondSupervisor = employeesData[phoneNumber]['Second Supervisor'];

          sheet2
            .cell(`A${columnIndex}`)
            .value(followUpDate);
          sheet2
            .cell(`B${columnIndex}`)
            .value(employeeName);
          sheet2
            .cell(`C${columnIndex}`)
            .value(customer);
          sheet2
            .cell(`D${columnIndex}`)
            .value(firstContact);
          sheet2
            .cell(`E${columnIndex}`)
            .value(secondContact);
          sheet2
            .cell(`F${columnIndex}`)
            .value(timeString);
          sheet2
            .cell(`G${columnIndex}`)
            .value(address);
          sheet2
            .cell(`H${columnIndex}`)
            .value(productOne);
          sheet2
            .cell(`I${columnIndex}`)
            .value(productTwo);
          sheet2
            .cell(`J${columnIndex}`)
            .value(productThree);
          sheet2
            .cell(`K${columnIndex}`)
            .value(visitDate);
          sheet2
            .cell(`L${columnIndex}`)
            .value(closureDate);
          sheet2
            .cell(`M${columnIndex}`)
            .value(comment);
          sheet2
            .cell(`N${columnIndex}`)
            .value(department);
          sheet2
            .cell(`O${columnIndex}`)
            .value(baseLocation);
          sheet2
            .cell(`P${columnIndex}`)
            .value(firstSupervisor);
          sheet2
            .cell(`Q${columnIndex}`)
            .value(secondSupervisor);
        });
      });

      const closuresPhoneNumbersArray = Object.keys(closureObject);

      closuresPhoneNumbersArray.forEach((phoneNumber, index) => {
        const columnIndex = index + 2;
        const timeStringArray = Object.keys(closureObject[phoneNumber]);

        timeStringArray.forEach((timeString) => {
          const {
            closureDate,
            customer,
            firstContact,
            secondContact,
            address,
            productOne,
            productTwo,
            productThree,
            visitDate,
            followUpDate,
            comment,
          } = closureObject[phoneNumber][timeString];

          const employeeName = employeesData[phoneNumber].Name;
          const department = employeesData[phoneNumber].Department;
          const baseLocation = employeesData[phoneNumber]['Base Location'];
          const firstSupervisor = employeesData[phoneNumber]['First Supervisor'];
          const secondSupervisor = employeesData[phoneNumber]['Second Supervisor'];

          sheet3
            .cell(`A${columnIndex}`)
            .value(closureDate);
          sheet3
            .cell(`B${columnIndex}`)
            .value(employeeName);
          sheet3
            .cell(`C${columnIndex}`)
            .value(customer);
          sheet3
            .cell(`D${columnIndex}`)
            .value(firstContact);
          sheet3
            .cell(`E${columnIndex}`)
            .value(secondContact);
          sheet3
            .cell(`F${columnIndex}`)
            .value(timeString);
          sheet3
            .cell(`G${columnIndex}`)
            .value(address);
          sheet3
            .cell(`H${columnIndex}`)
            .value(productOne);
          sheet3
            .cell(`I${columnIndex}`)
            .value(productTwo);
          sheet3
            .cell(`J${columnIndex}`)
            .value(productThree);
          sheet3
            .cell(`K${columnIndex}`)
            .value(visitDate);
          sheet3
            .cell(`L${columnIndex}`)
            .value(followUpDate);
          sheet3
            .cell(`M${columnIndex}`)
            .value(comment);
          sheet3
            .cell(`N${columnIndex}`)
            .value(department);
          sheet3
            .cell(`O${columnIndex}`)
            .value(baseLocation);
          sheet3
            .cell(`P${columnIndex}`)
            .value(firstSupervisor);
          sheet3
            .cell(`Q${columnIndex}`)
            .value(secondSupervisor);
        });
      });

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) return Promise.resolve();

      const fs = require('fs');

      locals.messageObject.attachments.push({
        fileName,
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
