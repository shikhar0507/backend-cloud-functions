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
  dateFormats,
  httpsActions,
  reportNames,
} = require('../../admin/constants');
const {
  timeStringWithOffset,
  employeeInfo,
} = require('./report-utils');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');


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
  const offsetObjectYesterday = momentTz(todayFromTimer).tz(timezone).subtract(1, 'day');

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

      workbook.sheet('Sheet1').row(1).style('bold', true);
      workbook.sheet('Sheet1').cell(`A1`).value('Dated');
      workbook.sheet('Sheet1').cell('B1').value('Employee Name');
      workbook.sheet('Sheet1').cell('C1').value('Employee Contact');
      workbook.sheet('Sheet1').cell('D1').value('Employee Code');
      workbook.sheet('Sheet1').cell('E1').value('Time');
      workbook.sheet('Sheet1').cell('F1').value('Distance Travelled');
      workbook.sheet('Sheet1').cell('G1').value('Address');
      workbook.sheet('Sheet1').cell('H1').value('Comment');
      workbook.sheet('Sheet1').cell('I1').value('Department');
      workbook.sheet('Sheet1').cell('J1').value('Base Location');

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

        workbook
          .sheet('Sheet1')
          .cell(`A${columnIndex}`)
          .value(dated);
        workbook
          .sheet('Sheet1')
          .cell(`B${columnIndex}`)
          .value(name);
        workbook
          .sheet('Sheet1')
          .cell(`C${columnIndex}`)
          .value(phoneNumber);
        workbook
          .sheet('Sheet1')
          .cell(`D${columnIndex}`)
          .value(employeeCode);
        workbook
          .sheet('Sheet1')
          .cell(`E${columnIndex}`)
          .value(time);
        workbook
          .sheet('Sheet1')
          .cell(`F${columnIndex}`)
          .value(distanceTravelled);
        workbook
          .sheet('Sheet1')
          .cell(`G${columnIndex}`)
          .value(identifier)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(url);
        workbook
          .sheet('Sheet1')
          .cell(`H${columnIndex}`)
          .value(comment);
        workbook
          .sheet('Sheet1')
          .cell(`I${columnIndex}`)
          .value(department);
        workbook
          .sheet('Sheet1')
          .cell(`J${columnIndex}`)
          .value(baseLocation);
      });

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals.messageObject.attachments.push({
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
