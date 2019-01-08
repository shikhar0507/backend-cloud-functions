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
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);
  const standardDateString = momentTz().format(dateFormats.DATE);
  locals.messageObject.templateId = sendGridTemplateIds.footprints;
  locals.messageObject['dynamic_template_data'] = {
    office,
    subject: `Footprints Report_${office}_${standardDateString}`,
    date: standardDateString,
  };

  const fileName = `${office} Footprints Report_${standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .where('date', '==', momentDateObject.yesterday.DATE_NUMBER)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .orderBy('user')
        .orderBy('timestamp', 'asc')
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
      workbook.sheet('Sheet1').cell('D1').value('Time');
      workbook.sheet('Sheet1').cell('E1').value('Distance Travelled');
      workbook.sheet('Sheet1').cell('F1').value('Address');
      workbook.sheet('Sheet1').cell('G1').value('Comment');
      workbook.sheet('Sheet1').cell('H1').value('Department');
      workbook.sheet('Sheet1').cell('I1').value('Base Location');

      const employeesData = locals.officeDoc.get('employeesData');
      const dated = momentTz()
        .utc()
        .clone()
        .tz(timezone)
        .subtract(1, 'day')
        .format(dateFormats.DATE);

      addendumDocs.docs.forEach((doc, index) => {
        const isSupportRequest = doc.get('isSupportRequest');

        if (isSupportRequest) {
          return;
        }

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
        // For template === check-in, this field will be available.
        const comment = doc.get('activityData.attachment.Comment.value') || '';

        workbook
          .sheet('Sheet1')
          .cell(`A${index + 2}`)
          .value(dated);
        workbook
          .sheet('Sheet1')
          .cell(`B${index + 2}`)
          .value(name);
        workbook
          .sheet('Sheet1')
          .cell(`C${index + 2}`)
          .value(phoneNumber);
        workbook
          .sheet('Sheet1')
          .cell(`D${index + 2}`)
          .value(time);
        workbook
          .sheet('Sheet1')
          .cell(`E${index + 2}`)
          .value(accumulatedDistance);
        workbook
          .sheet('Sheet1')
          .cell(`F${index + 2}`)
          .value(identifier)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(url);
        workbook
          .sheet('Sheet1')
          .cell(`G${index + 2}`)
          .value(comment);
        workbook
          .sheet('Sheet1')
          .cell(`H${index + 2}`)
          .value(department);
        workbook
          .sheet('Sheet1')
          .cell(`I${index + 2}`)
          .value(baseLocation);
      });

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals.messageObject.attachments.push({
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        fileName: `Footprints ${office}_Report_${standardDateString}.xlsx`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      console.log({
        report: locals.change.after.get('report'),
        to: locals.messageObject.to,
      });

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
