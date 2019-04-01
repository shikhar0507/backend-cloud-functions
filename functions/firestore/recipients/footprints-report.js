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
  dateFormats,
  httpsActions,
  reportNames,
} = require('../../admin/constants');
const {
  employeeInfo,
  alphabetsArray,
  dateStringWithOffset,
  timeStringWithOffset,
} = require('./report-utils');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');


const handleInstallReport = (locals) => {
  const employeesData = locals.officeDoc.get('employeesData');
  const timestampFromTimer = locals.change.after.get('timestamp');
  const office = locals.officeDoc.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentWithOffsetYesterday = momentTz(timestampFromTimer)
    .subtract(1, 'day')
    .tz(timezone);

  // key -> deviceId
  // value -> array of users
  const deviceUsers = new Map();
  const latestDeviceIdsMap = new Map();
  const multipleInstallsMap = new Map();
  let installsListAttachmentHeader = 'Install Date and Time\n\n';
  const yesterdaysStartTime = momentTz()
    .utc()
    .subtract(1, 'days')
    .startOf('day')
    .unix() * 1000;

  return rootCollections
    .inits
    .where('office', '==', office)
    .where('report', '==', reportNames.INSTALL)
    .where('date', '==', momentWithOffsetYesterday.date())
    .where('month', '==', momentWithOffsetYesterday.month())
    .where('year', '==', momentWithOffsetYesterday.year())
    .get()
    .then((initDocsQuery) => {
      if (!locals.sendMail || initDocsQuery.empty) {
        /** No report to be sent since no one installed yesterday. */
        return Promise.resolve();
      }

      locals.installsSheetAdded = true;

      const promises = [];

      initDocsQuery.docs.forEach((doc) => {
        const {
          phoneNumber,
          installs,
        } = doc.data();

        installs
          .forEach((timestampNumber) => {
            const installTimeString = dateStringWithOffset({
              timezone,
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

      locals.initDocsQuery = initDocsQuery;

      return Promise.all(promises);
    })
    .then((result) => {
      if (!locals.sendMail || !result) {
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

        const name = employeeInfo(
          employeesData,
          phoneNumber
        )
          .name || phoneNumber;

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

      const installsSheet = locals.workbook.addSheet('Installs');
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
        installsSheet
          .cell(`${alphabetsArray[index]}1`)
          .value(item);
      });

      locals
        .initDocsQuery
        .docs
        .forEach((doc, index) => {
          const {
            phoneNumber,
            installs,
          } = doc.data();

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
            timezone,
            format: dateFormats.DATE_TIME,
          });

          const signedUpOn = dateStringWithOffset({
            timestampToConvert: employeesData[phoneNumber].createTime,
            timezone,
            format: dateFormats.DATE_TIME,
          });

          const alsoUsedBy = (() => {
            const name = deviceUsers.get(latestDeviceId);

            if (!name) return '';

            // Avoids putting self in the `alsoUsedBy` field
            if (name === employeeObject.name) return '';

            return `${deviceUsers.get(latestDeviceId)}`;
          })();

          const columnIndex = index + 2;

          installsSheet.cell(`A${columnIndex}`).value(date);
          installsSheet.cell(`B${columnIndex}`).value(name);
          installsSheet.cell(`C${columnIndex}`).value(phoneNumber);
          installsSheet.cell(`D${columnIndex}`).value(signedUpOn);
          installsSheet.cell(`E${columnIndex}`).value(numberOfInstalls);
          installsSheet.cell(`F${columnIndex}`).value(alsoUsedBy);
          installsSheet.cell(`G${columnIndex}`).value(employeeCode);
          installsSheet.cell(`H${columnIndex}`).value(department);
          installsSheet.cell(`I${columnIndex}`).value(firstSupervisorsName);
          installsSheet.cell(`J${columnIndex}`).value(firstSupervisorPhoneNumber);
          installsSheet.cell(`K${columnIndex}`).value(secondSupervisorsName);
          installsSheet.cell(`L${columnIndex}`).value(secondSupervisorPhoneNumber);
        });

      return locals.workbook;
    })
    .catch(console.error);
};

const handleSignUpReport = (locals) => {
  const office = locals.officeDoc.get('office');
  const timestampFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentWithOffsetYesterday = momentTz(timestampFromTimer).subtract(1, 'day').tz(timezone);
  const employeesData = locals.officeDoc.get('employeesData');

  return rootCollections
    .inits
    .where('office', '==', office)
    .where('date', '==', momentWithOffsetYesterday.date())
    .where('month', '==', momentWithOffsetYesterday.month())
    .where('year', '==', momentWithOffsetYesterday.year())
    .where('report', '==', reportNames.SIGNUP)
    .limit(1)
    .get()
    .then((initDocsQuery) => {
      if (initDocsQuery.empty) {
        return Promise.resolve();
      }

      locals.signupSheetAdded = true;

      const signUpSheet = locals.workbook.addSheet('SignUps');
      signUpSheet.row(1).style('bold', true);

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
        signUpSheet
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
          timezone,
          timestampToConvert: (() => {
            if (employeesObject[phoneNumber]) {
              return employeesObject[phoneNumber].signedUpOn;
            }

            return '';
          })(),
        });
        const addedOn = dateStringWithOffset({
          timezone,
          timestampToConvert: (() => {
            if (employeesData[phoneNumber]) {
              return employeesData[phoneNumber].createTime;
            }

            return '';
          })(),
        });
        // This value could be an empty string
        if (signedUpOn) totalSignUpsCount++;

        signUpSheet.cell(`A${columnNumber}`).value(employeeName);
        signUpSheet.cell(`B${columnNumber}`).value(phoneNumber);
        signUpSheet.cell(`C${columnNumber}`).value(addedOn);
        signUpSheet.cell(`D${columnNumber}`).value(signedUpOn);
        signUpSheet.cell(`E${columnNumber}`).value(employeeCode);
        signUpSheet.cell(`F${columnNumber}`).value(department);
        signUpSheet.cell(`G${columnNumber}`).value(firstSupervisor.name);
        signUpSheet.cell(`H${columnNumber}`).value(firstSupervisorPhoneNumber);
        signUpSheet.cell(`I${columnNumber}`).value(secondSupervisor.name);
        signUpSheet.cell(`J${columnNumber}`).value(secondSupervisorPhoneNumber);
      });

      return locals.workbook;
    })
    .catch(console.error);
};


module.exports = (locals) => {
  const todayFromTimer = locals.change.after.get('timestamp');
  const office = locals.officeDoc.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const employeesData = locals.officeDoc.get('employeesData') || {};
  const standardDateString =
    momentTz(todayFromTimer)
      .tz(timezone)
      .format(dateFormats.DATE);
  const fileName = `${office} Footprints Report_${standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  const dated = momentTz(todayFromTimer)
    .tz(timezone)
    .subtract(1, 'day')
    .format(dateFormats.DATE);
  const offsetObjectYesterday = momentTz(todayFromTimer)
    .tz(timezone)
    .subtract(1, 'day');

  locals.messageObject['dynamic_template_data'] = {
    office,
    subject: `Footprints Report_${office}_${standardDateString}`,
    date: standardDateString,
  };

  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('date', '==', offsetObjectYesterday.date())
        .where('month', '==', offsetObjectYesterday.month())
        .where('year', '==', offsetObjectYesterday.year())
        .orderBy('user')
        .orderBy('timestamp')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        addendumDocs,
        workbook,
      ] = result;

      if (addendumDocs.empty) {
        locals.sendMail = false;

        return Promise.resolve(false);
      }

      const footprintsSheet = workbook.addSheet('Footprints');

      footprintsSheet.row(1).style('bold', true);
      footprintsSheet.cell(`A1`).value('Dated');
      footprintsSheet.cell('B1').value('Employee Name');
      footprintsSheet.cell('C1').value('Employee Contact');
      footprintsSheet.cell('D1').value('Employee Code');
      footprintsSheet.cell('E1').value('Time');
      footprintsSheet.cell('F1').value('Distance Travelled');
      footprintsSheet.cell('G1').value('Address');
      footprintsSheet.cell('H1').value('Comment');
      footprintsSheet.cell('I1').value('Department');
      footprintsSheet.cell('J1').value('Base Location');

      /**
       * Not using count param from the `callback` function because
       * skipping supportRequest addendum docs intereferes with
       * the actual count resulting in blank lines.
       */
      let count = 0;
      const distanceMap = new Map();

      addendumDocs.forEach((doc) => {
        const isSupportRequest = doc.get('isSupportRequest');
        const columnIndex = count + 2;

        if (isSupportRequest) {
          return;
        }

        count++;

        const phoneNumber = doc.get('user');
        const employeeObject = employeeInfo(employeesData, phoneNumber);
        const name = employeeObject.name;
        const department = employeeObject.department;
        const baseLocation = employeeObject.baseLocation;
        const url = doc.get('url');
        const identifier = doc.get('identifier');
        const time = timeStringWithOffset({
          timezone,
          timestampToConvert: doc.get('timestamp'),
        });
        const commentFromAttachment = doc.get('activityData.attachment.Comment.value') || '';
        const employeeCode = employeeObject.employeeCode;
        const distanceTravelled = (() => {
          let value = Number(doc.get('distanceTravelled') || 0);

          if (distanceMap.has(phoneNumber)) {
            value += distanceMap.get(phoneNumber);
          } else {
            // Distance starts with 0 for every person each day
            value = 0;
          }

          // Value in the map also needs to be updated otherwise
          // it will always add only the last updated value on each iteration.
          distanceMap.set(phoneNumber, value);

          return value.toFixed(2);
        })();

        const comment = (() => {
          if (commentFromAttachment) {
            return commentFromAttachment;
          }

          const action = doc.get('action');

          if (action === httpsActions.create) {
            return `Created ${doc.get('activityData.template')}`;
          }

          if (action === httpsActions.update) {
            return `Updated details`;
          }

          if (action === httpsActions.changeStatus) {
            const newStatus = doc.get('status');

            const string = (() => {
              if (newStatus === 'PENDING') {
                return 'reversed';
              }

              return newStatus;
            })();

            return `${string.toUpperCase()} ${doc.get('activityData.template')}`;
          }

          if (action === httpsActions.share) {
            const shareArray = doc.get('share');

            const adjective = (() => {
              if (shareArray.length > 1) {
                return 'were';
              }

              return 'was';
            })();

            return `Phone number(s) ${doc.get('share')} ${adjective} added`;
          }

          // action is 'comment'
          return doc.get('comment');
        })();

        footprintsSheet
          .cell(`A${columnIndex}`)
          .value(dated);
        footprintsSheet
          .cell(`B${columnIndex}`)
          .value(name);
        footprintsSheet
          .cell(`C${columnIndex}`)
          .value(phoneNumber);
        footprintsSheet
          .cell(`D${columnIndex}`)
          .value(employeeCode);
        footprintsSheet
          .cell(`E${columnIndex}`)
          .value(time);
        footprintsSheet
          .cell(`F${columnIndex}`)
          .value(distanceTravelled);
        footprintsSheet
          .cell(`G${columnIndex}`)
          .value(identifier)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(url);
        footprintsSheet
          .cell(`H${columnIndex}`)
          .value(comment);
        footprintsSheet
          .cell(`I${columnIndex}`)
          .value(department);
        footprintsSheet
          .cell(`J${columnIndex}`)
          .value(baseLocation);
      });

      if (!addendumDocs.empty) {
        locals.footprintsSheetAdded = true;
      }

      locals.workbook = workbook;

      return handleInstallReport(locals);
    })
    .then(() => handleSignUpReport(locals))
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      if (!locals.footprintsSheetAdded
        && !locals.signupSheetAdded
        && !locals.installsSheetAdded) {
        return Promise.resolve();
      }

      locals.workbook.deleteSheet('Sheet1');

      return locals.workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals
        .messageObject
        .attachments
        .push({
          content: fs.readFileSync(filePath).toString('base64'),
          fileName: `Footprints ${office}_Report_${standardDateString}.xlsx`,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log({
        report: reportNames.FOOTPRINTS,
        to: locals.messageObject.to,
        office: locals.officeDoc.get('office'),
      });

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
