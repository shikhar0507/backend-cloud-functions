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
  employeeInfo,
  momentOffsetObject,
  alphabetsArray,
  dateStringWithOffset,
} = require('./report-utils');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const fs = require('fs');


module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const momentDateObject = momentOffsetObject(locals.timezone);
  const employeesData = locals.officeDoc.get('employeesData');
  const fileName = `Install Report ${office}_${locals.standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  locals.messageObject['dynamic_template_data'] = {
    office,
    date: locals.standardDateString,
    subject: `Install Report_${office}_${locals.standardDateString}`,
  };

  // key -> deviceId
  // value -> array of users
  const deviceUsers = new Map();
  const latestDeviceIdsMap = new Map();
  const multipleInstallsMap = new Map();
  let installsListAttachmentHeader = 'Install Date and Time\n\n';
  const yesterdaysStartTime =
    momentTz()
      .utc()
      .subtract(1, 'days')
      .startOf('day')
      .unix() * 1000;

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

      const topHeaders = [
        'Date',
        'Employee Name',
        'Employee Contact',
        'Signed Up Date',
        'Number Of Installs',
        'Also Used By',
        'Employee Code',
        'Department',
        'First Supervisor',
        'Contact Number',
        'Second Supervisor',
        'Contact Number',
      ];

      topHeaders.forEach((item, index) => {
        worksheet
          .sheet('Sheet1')
          .cell(`${alphabetsArray[index]}1`)
          .value(item);
      });

      const promises = [];

      initDocsQuery.docs.forEach((doc) => {
        const {
          phoneNumber,
          installs,
        } = doc.data();

        installs
          .forEach((timestampNumber) => {
            const installTimeString = dateStringWithOffset({
              timezone: locals.timezone,
              timestampToConvert: timestampNumber,
              format: dateFormats.DATE_TIME,
            });

            installsListAttachmentHeader += `${installTimeString}\n`;
          });

        installs.forEach((timestampNumber) => {
          if (timestampNumber > yesterdaysStartTime) return;

          multipleInstallsMap.set(phoneNumber, installsListAttachmentHeader);
        });

        const promise = rootCollections
          .updates
          .where('phoneNumber', '==', phoneNumber)
          .limit(1)
          .get();

        promises
          .push(promise);
      });

      multipleInstallsMap
        .forEach((timestampsString, phoneNumber) => {
          locals.messageObject.attachments.push({
            content: Buffer.from(timestampsString).toString('base64'),
            fileName: `${phoneNumber}.txt`,
            type: 'text/plain',
            disposition: 'attachment',
          });
        });

      locals.worksheet = worksheet;
      locals.initDocsQuery = initDocsQuery;

      return Promise.all(promises);
    })
    .then((result) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      result.forEach((snapShot) => {
        // Snapshot won't be empty here because users with auth
        // are guaranteed to have a document in the `/Updates` collection
        const updatesDoc = snapShot.docs[0];
        const phoneNumber = updatesDoc.get('phoneNumber');
        const deviceIdsArray = updatesDoc.get('deviceIdsArray');
        const latestDeviceId = updatesDoc.get('latestDeviceId');

        latestDeviceIdsMap.set(phoneNumber, latestDeviceId);

        const name =
          employeeInfo(employeesData, phoneNumber).name || phoneNumber;

        deviceIdsArray.forEach((id) => {
          if (!deviceUsers.has(id)) {
            deviceUsers.set(id, [name]);
          } else {

            deviceUsers.get(id).push(name);
            const newArr = deviceUsers.get(id);

            deviceUsers.set(id, newArr);
          }
        });
      });

      console.log({ deviceUsers });
      const sheet1 = locals.worksheet.sheet('Sheet1');

      locals
        .initDocsQuery
        .docs
        .forEach((doc, index) => {
          const columnIndex = index + 2;
          const { phoneNumber, installs } = doc.data();

          const latestDeviceId = latestDeviceIdsMap.get(phoneNumber);
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

          const alsoUsedBy = (() => {
            const name = deviceUsers.get(latestDeviceId);

            if (!name) return '';

            // Avoids putting self in the `alsoUsedBy` field
            if (name === employeeObject.name) return '';

            return `${deviceUsers.get(latestDeviceId)}`;
          })();

          console.log(phoneNumber, alsoUsedBy);

          sheet1.cell(`A${columnIndex}`).value(date);
          sheet1.cell(`B${columnIndex}`).value(name);
          sheet1.cell(`C${columnIndex}`).value(phoneNumber);
          sheet1.cell(`D${columnIndex}`).value(signedUpOn);
          sheet1.cell(`E${columnIndex}`).value(numberOfInstalls);
          sheet1.cell(`F${columnIndex}`).value(alsoUsedBy);
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

      locals.messageObject.attachments.push({
        fileName,
        content: fs.readFileSync(filePath).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
