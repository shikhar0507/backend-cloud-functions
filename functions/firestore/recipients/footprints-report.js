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
} = require('../../admin/constants');

const {
  getYesterdaysDateString,
  momentDateObject,
  timeStringWithOffset,
} = require('./report-utils');

const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const today = new Date();
  const yesterdaysDateString = getYesterdaysDateString();
  locals.messageObject.templateId = sendGridTemplateIds.footprints;
  locals.messageObject['dynamic_template_data'] = {
    office,
    subject: `${office} Footprints Report_${today.toDateString()}`,
    date: yesterdaysDateString,
  };

  const fileName = `${office} Footprints Report_${today.toDateString()}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  console.log({ filePath });

  const officeDocRef = rootCollections
    .offices
    .doc(officeId);

  return Promise
    .all([
      officeDocRef
        .get(),
      officeDocRef
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
        officeDoc,
        addendumDocs,
        workbook,
      ] = result;

      locals.toSendMails = true;
      console.log('addendumDocs.empty', addendumDocs.empty);

      if (addendumDocs.empty) {
        console.log('No docs found in Addendum');

        locals.toSendMails = false;

        return Promise.resolve(false);
      }

      workbook.sheet('Sheet1').row(1).style('bold', true);
      workbook.sheet('Sheet1').cell(`A1`).value('Dated');
      workbook.sheet('Sheet1').cell('B1').value('Employee Name');
      workbook.sheet('Sheet1').cell('C1').value('Time');
      workbook.sheet('Sheet1').cell('D1').value('Distance Travelled');
      workbook.sheet('Sheet1').cell('E1').value('Address');
      workbook.sheet('Sheet1').cell('F1').value('Department');
      workbook.sheet('Sheet1').cell('G1').value('Base Location');

      const employeesData = officeDoc.get('employeesData');

      addendumDocs.docs.forEach((doc, index) => {
        const phoneNumber = doc.get('user');

        /** 
         * Person doesn't belong to the office and was just
         * an assignee of the activity.
         */
        if (!employeesData[phoneNumber]) return;

        const department = employeesData[phoneNumber].Department;
        const name = employeesData[phoneNumber].Name;
        const baseLocation = employeesData[phoneNumber]['Base Location'];
        const url = doc.get('url');
        const identifier = doc.get('identifier');
        const accumulatedDistance = doc.get('accumulatedDistance');
        const time = timeStringWithOffset({
          timezone: officeDoc.get('attachment.Timezone.value'),
          timestampToConvert: doc.get('timestamp'),
        });

        workbook
          .sheet('Sheet1')
          .cell(`A${index + 2}`)
          .value(yesterdaysDateString);
        workbook
          .sheet('Sheet1')
          .cell(`B${index + 2}`)
          .value(name);
        workbook
          .sheet('Sheet1')
          .cell(`C${index + 2}`)
          .value(time);
        workbook
          .sheet('Sheet1')
          .cell(`D${index + 2}`)
          .value(accumulatedDistance);
        workbook
          .sheet('Sheet1')
          .cell(`E${index + 2}`)
          .value(identifier)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(url);
        workbook
          .sheet('Sheet1')
          .cell(`F${index + 2}`)
          .value(department);
        workbook
          .sheet('Sheet1')
          .cell(`G${index + 2}`)
          .value(baseLocation);
      });

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.toSendMails) {
        console.log('inside then. Not sending mails.');

        return Promise.resolve();
      }

      locals.messageObject.attachments.push({
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        fileName: `${office} Footprints Report_${today.toDateString()}.xlsx`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      console.log('locals.messageObject', locals.messageObject);

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
