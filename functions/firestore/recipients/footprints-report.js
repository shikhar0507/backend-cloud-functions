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
  timeStringWithOffset,
} = require('./report-utils');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');


const getDateHeaders = (momentYesterday) => {
  const result = [];
  const end = momentYesterday.date();

  for (let index = end; index >= 1; index--) {
    const momentInit = momentYesterday
      .date(index)
      .format(dateFormats.MONTH_DATE);

    result.push(momentInit);
  }

  return result;
};


const handleMtdReport = (locals) => {
  let footprintsObject;
  let initDocRef;
  let excelSheet;
  const firstAddendumPromises = [];
  const lastAddendumPromises = [];
  const todayFromTimestamp = locals.change.after.get('timestamp');
  const office = locals.officeDoc.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const officeId = locals.officeDoc.id;
  const momentWithOffset = momentTz(todayFromTimestamp).tz(timezone);
  const momentYesterday = momentWithOffset.subtract(1, 'day');
  const yesterdaysDate = momentYesterday.date();
  const yesterdaysMonth = momentYesterday.month();
  const yesterdaysYear = momentYesterday.year();
  const employeesData = locals.officeDoc.get('employeesData');

  console.log(locals.payrollObject);

  return rootCollections
    .inits
    .where('office', '==', office)
    .where('report', '==', reportNames.FOOTPRINTS_MTD)
    .where('month', '==', momentYesterday.month())
    .where('year', '==', momentYesterday.year())
    .limit(1)
    .get()
    .then((footprintsInitQuery) => {
      excelSheet = locals.workbook.addSheet('Footprints MTD');
      excelSheet.row(1).style('bold', true);

      footprintsObject = (() => {
        if (footprintsInitQuery.empty) {
          initDocRef = rootCollections.inits.doc();

          return {};
        }

        const doc = footprintsInitQuery.docs[0];

        initDocRef = doc.ref;

        return doc.get('footprintsObject') || {};
      })();

      const phoneNumbersArray = Object.keys(employeesData);

      phoneNumbersArray
        .forEach((phoneNumber) => {
          if (!footprintsObject[phoneNumber]) {
            footprintsObject[phoneNumber] = {
              [yesterdaysDate]: {
                first: '',
                last: '',
              },
            };
          }

          const baseQuery = locals
            .officeDoc
            .ref
            .collection('Addendum')
            .where('date', '==', yesterdaysDate)
            .where('month', '==', yesterdaysMonth)
            .where('year', '==', yesterdaysYear)
            .where('user', '==', phoneNumber);

          const first = baseQuery
            .orderBy('timestamp', 'asc')
            .limit(1)
            .get();

          const last = baseQuery
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

          firstAddendumPromises.push(first);
          lastAddendumPromises.push(last);
        });

      return Promise.all(firstAddendumPromises);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          return;
        }

        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('user');
        const first = doc.get('timestamp');

        footprintsObject[phoneNumber][yesterdaysDate] = {
          first: timeStringWithOffset({
            timezone,
            timestampToConvert: first,
            format: dateFormats.TIME,
          }),
        };
      });

      return Promise.all(lastAddendumPromises);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          return;
        }

        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('user');
        const last = doc.get('timestamp');

        footprintsObject[phoneNumber][yesterdaysDate]
          .last = timeStringWithOffset({
            timezone,
            timestampToConvert: last,
            format: dateFormats.TIME,
          });
      });

      const headers = [
        'Employee Name',
        'Employee Contact',
        'Department',
        'Base Location',
        'Live Since',
      ];

      const dateHeaders = getDateHeaders(momentYesterday);

      []
        .concat(headers)
        .concat(dateHeaders)
        .forEach((header, index) => {
          excelSheet
            .cell(`${alphabetsArray[index]}1`)
            .value(header);
        });

      Object
        .keys(employeesData)
        .forEach((phoneNumber, outerIndex) => {
          const employeeObject = employeeInfo(employeesData, phoneNumber);
          const employeeName = employeeObject.name;
          const liveSince = timeStringWithOffset({
            timezone,
            format: dateFormats.DATE,
            timestampToConvert: employeesData[phoneNumber].createTime,
          });

          const columnIndex = outerIndex + 2;

          excelSheet
            .cell(`A${columnIndex}`)
            .value(employeeName);
          excelSheet
            .cell(`B${columnIndex}`)
            .value(phoneNumber);
          excelSheet
            .cell(`C${columnIndex}`)
            .value(employeeObject.department);
          excelSheet
            .cell(`D${columnIndex}`)
            .value(employeeObject.baseLocation);
          excelSheet
            .cell(`E${columnIndex}`)
            .value(liveSince);

          let alphabetIndexStart = 5;

          for (let date = yesterdaysDate; date > 0; date--) {
            const {
              first,
              last,
            } = footprintsObject[phoneNumber][date] || {};

            const alphabet = alphabetsArray[alphabetIndexStart];
            const value = (() => {
              if (locals.payrollObject[phoneNumber]
                && locals.payrollObject[phoneNumber][date]
                && locals.payrollObject[phoneNumber][date].status
                && locals.payrollObject[phoneNumber][date].status.startsWith('LEAVE')) {
                return 'LEAVE';
              }

              if (locals.payrollObject[phoneNumber]
                && locals.payrollObject[phoneNumber][date]
                && locals.payrollObject[phoneNumber][date].status
                && locals.payrollObject[phoneNumber][date].status === 'ON DUTY') {
                return 'ON DUTY';
              }

              if (!first && !last) {
                return '-';
              }

              if (first && !last) {
                return first;
              }

              return `${first} | ${last}`;
            })();

            const cell = `${alphabet}${columnIndex}`;

            excelSheet.cell(cell).value(value);

            alphabetIndexStart++;
          }
        });

      locals.footprintsMtdSheetAdded = true;

      return initDocRef
        .set({
          office,
          officeId,
          footprintsObject,
          report: reportNames.FOOTPRINTS_MTD,
          month: momentYesterday.month(),
          year: momentYesterday.year(),
        }, {
            merge: true,
          });
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
  const yesterdaysDate = offsetObjectYesterday.date();
  let lastIndex;

  locals.messageObject['dynamic_template_data'] = {
    office,
    subject: `Footprints Report_${office}_${standardDateString}`,
    date: standardDateString,
  };

  const activePhoneNumbersSet = new Set();

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
      rootCollections
        .inits
        .where('report', '==', reportNames.PAYROLL)
        .where('office', '==', office)
        .where('month', '==', offsetObjectYesterday.month())
        .where('year', '==', offsetObjectYesterday.year())
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        addendumDocs,
        payrollInitDocQuery,
        workbook,
      ] = result;

      locals.workbook = workbook;

      if (addendumDocs.empty) {
        locals.sendMail = false;

        console.log('no activity', {
          date: offsetObjectYesterday.date(),
          month: offsetObjectYesterday.month(),
          year: offsetObjectYesterday.year(),
        });

        return Promise.resolve(false);
      }

      const payrollObject = (() => {
        if (payrollInitDocQuery.empty) {
          return {};
        }

        return payrollInitDocQuery.docs[0].get('payrollObject') || {};
      })();

      locals.payrollObject = payrollObject;

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

        activePhoneNumbersSet.add(phoneNumber);

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

          if (action === httpsActions.signup) {
            return `Signed up on Growthfile`;
          }

          if (action === httpsActions.install) {
            return `Installed Growthfile`;
          }

          if (action === httpsActions.create) {
            return `Created ${doc.get('activityData.template')}`;
          }

          if (action === httpsActions.update) {
            return `Updated ${doc.get('activityData.template')}`;
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

        lastIndex = columnIndex;
      });

      Object
        .keys(employeesData)
        .forEach((phoneNumber) => {
          /** Ignoring people who were active.during the date */
          if (activePhoneNumbersSet.has(phoneNumber)) {
            return;
          }

          /** Increment before adding more data is required since that is  */
          lastIndex++;

          const comment = (() => {
            if (payrollObject[phoneNumber]
              && payrollObject[phoneNumber][yesterdaysDate]
              && payrollObject[phoneNumber][yesterdaysDate].status
              && payrollObject[phoneNumber][yesterdaysDate].status.startsWith('LEAVE')) {
              return `On Leave`;
            }

            if (payrollObject[phoneNumber]
              && payrollObject[phoneNumber][yesterdaysDate]
              && payrollObject[phoneNumber][yesterdaysDate].status
              && payrollObject[phoneNumber][yesterdaysDate].status === 'ON DUTY') {
              return `On Duty`;
            }

            return `Inactive on ${dated}`;
          })();

          const {
            name,
            employeeCode,
            department,
            baseLocation,
          } = employeeInfo(employeesData, phoneNumber);

          footprintsSheet
            .cell(`A${lastIndex}`)
            .value(dated);
          footprintsSheet
            .cell(`B${lastIndex}`)
            .value(name);
          footprintsSheet
            .cell(`C${lastIndex}`)
            .value(phoneNumber);
          footprintsSheet
            .cell(`D${lastIndex}`)
            .value(employeeCode);
          footprintsSheet
            .cell(`E${lastIndex}`)
            .value('');
          footprintsSheet
            .cell(`F${lastIndex}`)
            .value(0);
          footprintsSheet
            .cell(`G${lastIndex}`)
            .value('');
          footprintsSheet
            .cell(`H${lastIndex}`)
            .value(comment);
          footprintsSheet
            .cell(`I${lastIndex}`)
            .value(department);
          footprintsSheet
            .cell(`J${lastIndex}`)
            .value(baseLocation);
        });

      if (!addendumDocs.empty) {
        locals.footprintsSheetAdded = true;
        locals.workbook.deleteSheet('Sheet1');
      }

      return null;
    })
    .then(() => handleMtdReport(locals))
    .then(() => {
      if (!locals.footprintsSheetAdded) {
        return Promise.resolve();
      }

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
      // return;
    })
    .catch(console.error);
};
