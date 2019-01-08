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
  dateFormats,
} = require('../../admin/constants');
const {
  rootCollections,
} = require('../../admin/admin');
const {
  employeeInfo,
  momentOffsetObject,
  alphabetsArray,
  dateStringWithOffset,
} = require('./report-utils');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');


module.exports = (locals) => {
  const office = locals.change.after.get('office');
  const momentDateObject = momentOffsetObject(locals.timezone);
  const fileName = `Install Report ${office}_${locals.standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  // locals.messageObject.templateId = sendGridTemplateIds.installs;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: locals.standardDateString,
    subject: `Install Report_${office}_${locals.standardDateString}`,
  };

  locals.multipleInstallsMap = new Map();

  const topHeaders = [
    'Date',
    'Employee Name',
    'Employee Contact',
    'Signed Up Date',
    'Number Of Installs',
    // 'Install Device ID',
    'Also Used By',
    'Employee Code',
    'Department',
    'First Supervisor',
    'Contact Number',
    'Second Supervisor',
    'Contact Number',
  ];

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.INSTALL)
        .where('date', '==', momentDateObject.yesterday.DATE_NUMBER)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        initDocsQuery,
        worksheet,
      ] = result;

      if (initDocsQuery.empty) {
        locals.sendMail = false;

        /** No report to be sent since no one installed yesterday. */
        return Promise.resolve();
      }

      locals.worksheet = worksheet;

      topHeaders.forEach((item, index) => {
        worksheet
          .sheet('Sheet1')
          .cell(`${alphabetsArray[index]}1`)
          .value(item);
      });

      let header = 'Install Date and Time\n\n';

      const yesterdaysStartTime =
        momentTz()
          .utc()
          .subtract(1, 'days')
          .startOf('day')
          .unix() * 1000;

      const promises = [];

      initDocsQuery.docs.forEach((doc) => {
        const {
          phoneNumber,
          installs,
        } = doc.data();

        promises
          .push(rootCollections
            .updates
            .where('phoneNumber', '==', phoneNumber)
            .limit(1)
            .get());

        installs.forEach((timestampNumber) => {
          const installTimeString = dateStringWithOffset({
            timezone: locals.timezone,
            timestampToConvert: timestampNumber,
            format: 'lll',
          });

          header += `${installTimeString}\n`;
        });

        installs.forEach((timestampNumber) => {
          if (timestampNumber > yesterdaysStartTime) return;

          locals.multipleInstallsMap.set(phoneNumber, header);
        });
      });

      locals.initDocsQuery = initDocsQuery;

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

      return Promise.all(promises);
    })
    .then((snapShots) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      const deviceMap = new Map();
      const deviceIdMap = new Map();
      const latestDeviceMap = new Map();

      snapShots.forEach((snapShot) => {
        const doc = snapShot.docs[0];
        const deviceIdsArray = doc.get('deviceIdsArray') || [];
        const latestDeviceId = doc.get('latestDeviceId') || '';
        const phoneNumber = doc.get('phoneNumber');
        const obj = {};

        deviceIdsArray.forEach((val) => {
          obj[val] = null;
        });

        latestDeviceMap.set(phoneNumber, latestDeviceId);

        deviceIdMap.set(phoneNumber, obj);

        deviceIdsArray.forEach((id) => {
          deviceMap.set(id, phoneNumber);
        });
      });

      const sheet1 = locals.worksheet.sheet('Sheet1');
      const employeesData = locals.officeDoc.get('employeesData');

      locals.initDocsQuery.docs.forEach((doc, index) => {
        const {
          phoneNumber,
          installs,
        } = doc.data();

        const columnIndex = index + 2;
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
        const date = dateStringWithOffset({
          timestampToConvert: installs[installs.length - 1],
          timezone: locals.timezone,
          format: dateFormats.DATE_TIME,
        });

        const signedUpOn = dateStringWithOffset({
          timestampToConvert: employeesData[phoneNumber].createTime,
          timezone: locals.timezone,
          format: dateFormats.DATE_TIME,
        });
        const installDeviceId = latestDeviceMap.get(phoneNumber);

        const alsoUsedBy = (() => {
          const people = [];
          const arr = deviceIdMap.get(installDeviceId) || [];
          console.log({ arr, phoneNumber });

          arr.forEach((id) => {
            const name = deviceMap.get(id) || '';

            people.push(name);
          });

          return people;
        })();

        sheet1.cell(`A${columnIndex}`).value(date);
        sheet1.cell(`B${columnIndex}`).value(name);
        sheet1.cell(`C${columnIndex}`).value(phoneNumber);
        sheet1.cell(`D${columnIndex}`).value(signedUpOn);
        sheet1.cell(`E${columnIndex}`).value(numberOfInstalls);
        // sheet1.cell(`F${columnIndex}`).value(installDeviceId);
        sheet1.cell(`F${columnIndex}`).value(`${alsoUsedBy}`);
        sheet1.cell(`G${columnIndex}`).value(employeeCode);
        sheet1.cell(`H${columnIndex}`).value(department);
        sheet1.cell(`I${columnIndex}`).value(firstSupervisorsName);
        sheet1.cell(`J${columnIndex}`).value(firstSupervisorPhoneNumber);
        sheet1.cell(`K${columnIndex}`).value(secondSupervisorsName);
        sheet1.cell(`L${columnIndex}`).value(secondSupervisorPhoneNumber);
      });

      return locals.worksheet.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      const fs = require('fs');

      locals.messageObject.attachments.push({
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        fileName: `Install Report_${office}_${locals.standardDateString}.xlsx`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
