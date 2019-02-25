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
} = require('../../admin/constants');

const {
  momentOffsetObject,
  timeStringWithOffset,
  employeeInfo,
} = require('./report-utils');

const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');


module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const standardDateString = momentTz().format(dateFormats.DATE);
  locals.messageObject['dynamic_template_data'] = {
    office,
    subject: `Footprints Report_${office}_${standardDateString}`,
    date: standardDateString,
  };
  const employeesData = locals.officeDoc.get('employeesData');
  const fileName = `${office} Footprints Report_${standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  const dated = momentTz()
    .utc()
    .clone()
    .tz(timezone)
    .subtract(1, 'day')
    .format(dateFormats.DATE);
  const offsetObject = momentTz().tz(timezone);
  const previousDay = offsetObject.subtract(1, 'day');
  const dayStartTimestamp = previousDay.startOf('day').unix() * 1000;
  const dayEndTimestamp = previousDay.endOf('day').unix() * 1000;

  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('timestamp', '>=', dayStartTimestamp)
        .where('timestamp', '<', dayEndTimestamp)
        .orderBy('timestamp')
        .orderBy('user')
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
        const accumulatedDistance = Number(doc.get('accumulatedDistance') || 0);
        const time = timeStringWithOffset({
          timezone,
          timestampToConvert: doc.get('timestamp'),
        });
        // For template === `check-in`, this field will be available.
        const comment = doc.get('activityData.attachment.Comment.value') || '';
        const employeeCode = employeeObject.employeeCode;

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
          .value(accumulatedDistance);
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
        report: 'footprints',
        to: locals.messageObject.to,
        office: locals.officeDoc.get('office'),
      });

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
