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
const fs = require('fs');


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const today = new Date();
  const todaysDateString = today.toDateString();
  const yesterdaysDateString = getYesterdaysDateString();

  locals.messageObject.templateId = sendGridTemplateIds.dsr;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: new Date().toDateString(),
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
        .where('date', '==', yesterdaysDateString)
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocsQuery,
        worksheet,
      ] = result;

      if (initDocsQuery.empty) {
        console.log('DSR Inits doc empty');

        return Promise.resolve();
      }

      const topRow = [
        'Visit Date',
        'Employee Name',
        'Customer',
        'First Contact',
        'Second Contact',
        'Time',
        'Address',
        'Product 1',
        'Product 2',
        'Product 3',
        'Follow Up Date',
        'Comment',
        'Department',
        'Base Location',
        'First Supervisor',
        'Second Supervisor',
      ];

      const letters = [
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H',
        'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
      ];

      topRow.forEach((item, index) => {
        const alphabet = letters[index];

        worksheet
          .sheet('DSR Visit Report')
          .cell(`${alphabet}${index + 1}`)
          .value(item);
      });

      const {
        visitsObject,
        followUpsObject,
        closureObject,
      } = initDocsQuery
        .docs[0]
        .data();

      const {
        employeesData,
      } = officeDoc.data();

      const visitsPhoneNumbers
        = Object.keys(visitsObject);

      visitsPhoneNumbers.forEach((phoneNumber, index) => {
        const columnIndex = index + 1;
        const sheetName = 'DSR Visit Report';
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

          worksheet
            .sheet(sheetName)
            .cell(`A${columnIndex}`)
            .value(visitDate);
          worksheet
            .sheet(sheetName)
            .cell(`B${columnIndex}`)
            .value(employeeName);
          worksheet
            .sheet(sheetName)
            .cell(`C${columnIndex}`)
            .value(customer);
          worksheet
            .sheet(sheetName)
            .cell(`D${columnIndex}`)
            .value(firstContact);
          worksheet
            .sheet(sheetName)
            .cell(`E${columnIndex}`)
            .value(secondContact);
          worksheet
            .sheet(sheetName)
            .cell(`F${columnIndex}`)
            .value(timeString);
          worksheet
            .sheet(sheetName)
            .cell(`G${columnIndex}`)
            .value(address);
          worksheet
            .sheet(sheetName)
            .cell(`H${columnIndex}`)
            .value(productOne);
          worksheet
            .sheet(sheetName)
            .cell(`I${columnIndex}`)
            .value(productTwo);
          worksheet
            .sheet(sheetName)
            .cell(`J${columnIndex}`)
            .value(productThree);
          worksheet
            .sheet(sheetName)
            .cell(`K${columnIndex}`)
            .value(followUpDate);
          worksheet
            .sheet(sheetName)
            .cell(`L${columnIndex}`)
            .value(comment);
          worksheet
            .sheet(sheetName)
            .cell(`M${columnIndex}`)
            .value(department);
          worksheet
            .sheet(sheetName)
            .cell(`N${columnIndex}`)
            .value(baseLocation);
          worksheet
            .sheet(sheetName)
            .cell(`O${columnIndex}`)
            .value(firstSupervisor);
          worksheet
            .sheet(sheetName)
            .cell(`P${columnIndex}`)
            .value(secondSupervisor);
        });
      });

      const followUpPhoneNumbers = Object.keys(followUpsObject);

      followUpPhoneNumbers.forEach((phoneNumber, index) => {
        const columnIndex = index + 1;
        const sheetName = 'DSR Follow-Up Report';
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

          worksheet
            .sheet(sheetName)
            .cell(`A${columnIndex}`)
            .value(followUpDate);
          worksheet
            .sheet(sheetName)
            .cell(`B${columnIndex}`)
            .value(employeeName);
          worksheet
            .sheet(sheetName)
            .cell(`C${columnIndex}`)
            .value(customer);
          worksheet
            .sheet(sheetName)
            .cell(`D${columnIndex}`)
            .value(firstContact);
          worksheet
            .sheet(sheetName)
            .cell(`E${columnIndex}`)
            .value(secondContact);
          worksheet
            .sheet(sheetName)
            .cell(`F${columnIndex}`)
            .value(timeString);
          worksheet
            .sheet(sheetName)
            .cell(`G${columnIndex}`)
            .value(address);
          worksheet
            .sheet(sheetName)
            .cell(`H${columnIndex}`)
            .value(productOne);
          worksheet
            .sheet(sheetName)
            .cell(`I${columnIndex}`)
            .value(productTwo);
          worksheet
            .sheet(sheetName)
            .cell(`J${columnIndex}`)
            .value(productThree);
          worksheet
            .sheet(sheetName)
            .cell(`K${columnIndex}`)
            .value(visitDate);
          worksheet
            .sheet(sheetName)
            .cell(`L${columnIndex}`)
            .value(closureDate);
          worksheet
            .sheet(sheetName)
            .cell(`M${columnIndex}`)
            .value(comment);
          worksheet
            .sheet(sheetName)
            .cell(`N${columnIndex}`)
            .value(department);
          worksheet
            .sheet(sheetName)
            .cell(`O${columnIndex}`)
            .value(baseLocation);
          worksheet
            .sheet(sheetName)
            .cell(`P${columnIndex}`)
            .value(firstSupervisor);
          worksheet
            .sheet(sheetName)
            .cell(`Q${columnIndex}`)
            .value(secondSupervisor);
        });
      });

      const closuresPhoneNumbersArray = Object.keys(closureObject);

      closuresPhoneNumbersArray.forEach((phoneNumber, index) => {
        const columnIndex = index + 1;
        const sheetName = 'DSR Closure Report';
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


          worksheet
            .sheet(sheetName)
            .cell(`A${columnIndex}`)
            .value(closureDate);
          worksheet
            .sheet(sheetName)
            .cell(`B${columnIndex}`)
            .value(employeeName);
          worksheet
            .sheet(sheetName)
            .cell(`C${columnIndex}`)
            .value(customer);
          worksheet
            .sheet(sheetName)
            .cell(`D${columnIndex}`)
            .value(firstContact);
          worksheet
            .sheet(sheetName)
            .cell(`E${columnIndex}`)
            .value(secondContact);
          worksheet
            .sheet(sheetName)
            .cell(`F${columnIndex}`)
            .value(timeString);
          worksheet
            .sheet(sheetName)
            .cell(`G${columnIndex}`)
            .value(address);
          worksheet
            .sheet(sheetName)
            .cell(`H${columnIndex}`)
            .value(productOne);
          worksheet
            .sheet(sheetName)
            .cell(`I${columnIndex}`)
            .value(productTwo);
          worksheet
            .sheet(sheetName)
            .cell(`J${columnIndex}`)
            .value(productThree);
          worksheet
            .sheet(sheetName)
            .cell(`K${columnIndex}`)
            .value(visitDate);
          worksheet
            .sheet(sheetName)
            .cell(`L${columnIndex}`)
            .value(followUpDate);
          worksheet
            .sheet(sheetName)
            .cell(`M${columnIndex}`)
            .value(comment);
          worksheet
            .sheet(sheetName)
            .cell(`N${columnIndex}`)
            .value(department);
          worksheet
            .sheet(sheetName)
            .cell(`O${columnIndex}`)
            .value(baseLocation);
          worksheet
            .sheet(sheetName)
            .cell(`P${columnIndex}`)
            .value(firstSupervisor);
          worksheet
            .sheet(sheetName)
            .cell(`Q${columnIndex}`)
            .value(secondSupervisor);
        });
      });

      return;
    })
    .catch(console.error);
};
