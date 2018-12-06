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
  dateStringWithOffset,
  timeStringWithOffset,
  getYesterdaysDateString,
  alphabetsArray,
} = require('./report-utils');
const {
  sendGridTemplateIds,
} = require('../../admin/constants');

const xlsxPopulate = require('xlsx-populate');

module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const todaysDateString = new Date().toDateString();
  const yesterdaysDateString = getYesterdaysDateString();
  const fileName = `DSR_${office}_${todaysDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  locals.sendMail = true;
  locals.messageObject.templateId = sendGridTemplateIds.dsr;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: todaysDateString,
    subject: `DSR_${office}_${todaysDateString}`,
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
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', 'dsr')
        .where('dateString', '==', todaysDateString)
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        officeDoc,
        yesterdayInitsQuery,
        todayInitsQuery,
        workbook,
      ] = result;

      if (yesterdayInitsQuery.empty && todayInitsQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      const employeesData = officeDoc.get('employeesData');
      const timezone = officeDoc.get('attachment.Timezone.value');

      const visitObject = (() => {
        if (yesterdayInitsQuery.empty) return {};

        return yesterdayInitsQuery.docs[0].get('visitObject');
      })();

      const visitsActivityIdsArray = Object.keys(visitObject);

      const followUpObject = (() => {
        if (todayInitsQuery.empty) return {};

        return todayInitsQuery.docs[0].get('followUpObject');
      })();

      const followUpActivityIdsArray = Object.keys(followUpObject);

      if (visitsActivityIdsArray.length > 0) {
        const sheet1 = workbook.addSheet('DSR Visits');
        sheet1.row(1).style('bold', true);

        const visitsSheetTopRow = [
          'Visit Date',
          'Employee Name',
          'Customer Location',
          'First Contact',
          'Second Contact',
          'Address',
          'Actual Location',
          'Purpose',
          'Start Time',
          'End Time',
          'Product 1',
          'Product 2',
          'Product 3',
          'Follow-Up Date',
          'Comment',
          'Department',
          'Base Location',
          'First Supervisor',
          'Second Supervisor',
        ];

        visitsSheetTopRow.forEach((topRowValue, index) => {
          console.log(`${alphabetsArray[index]}1`, topRowValue);

          sheet1.cell(`${alphabetsArray[index]}1`).value(topRowValue);
        });

        visitsActivityIdsArray.forEach((activityId, index) => {
          console.log('id', activityId);
          const columnIndex = index + 2;

          const {
            purpose,
            phoneNumber,
            visitStartTimestamp,
            visitEndTimestamp,
            firstContact,
            secondContact,
            product1,
            product2,
            product3,
            followUpStartTimestamp,
            comment,
            actualLocation,
          } = visitObject[activityId];

          if (!employeesData[phoneNumber]) return;

          const startTime = timeStringWithOffset({
            timezone,
            timestampToConvert: visitStartTimestamp,
          });
          const endTime = timeStringWithOffset({
            timezone,
            timestampToConvert: visitEndTimestamp,
          });
          const visitDate = dateStringWithOffset({
            timezone,
            timestampToConvert: visitStartTimestamp,
          });

          const followUpDate = dateStringWithOffset({
            timezone,
            timestampToConvert: followUpStartTimestamp,
          });

          const employeeName = employeesData[phoneNumber].Name;
          // fetch customer activity
          const customerLocation = '';
          const address = '';
          const firstSupervisor = employeesData[phoneNumber]['First Supervisor'];
          const secondSupervisor = employeesData[phoneNumber]['Second Supervisor'];
          const department = employeesData[phoneNumber].Department;
          const baseLocation = employeesData[phoneNumber]['Base Location'];

          sheet1.cell(`A${columnIndex}`).value(visitDate);
          sheet1.cell(`B${columnIndex}`).value(employeeName);
          sheet1.cell(`C${columnIndex}`).value(customerLocation);
          sheet1.cell(`D${columnIndex}`).value(firstContact);
          sheet1.cell(`E${columnIndex}`).value(secondContact);
          sheet1.cell(`F${columnIndex}`).value(address);
          sheet1.cell(`G${columnIndex}`).value(actualLocation);
          sheet1.cell(`H${columnIndex}`).value(purpose);
          sheet1.cell(`I${columnIndex}`).value(startTime);
          sheet1.cell(`J${columnIndex}`).value(endTime);
          sheet1.cell(`K${columnIndex}`).value(product1);
          sheet1.cell(`L${columnIndex}`).value(product2);
          sheet1.cell(`M${columnIndex}`).value(product3);
          sheet1.cell(`N${columnIndex}`).value(followUpDate);
          sheet1.cell(`O${columnIndex}`).value(comment);
          sheet1.cell(`P${columnIndex}`).value(department);
          sheet1.cell(`Q${columnIndex}`).value(baseLocation);
          sheet1.cell(`R${columnIndex}`).value(firstSupervisor);
          sheet1.cell(`S${columnIndex}`).value(secondSupervisor);
        });
      }

      if (followUpActivityIdsArray.length > 0) {
        const sheet2 = workbook.addSheet('DSR Follow-Up');
        sheet2.row(1).style('bold', true);

        const followUpTopRow = [
          'Date',
          'Visit Type',
          'Employee Name',
          'Customer',
          'First Contact',
          'Second Contact',
          'Address',
          'Actual Location',
          'Purpose',
          'Start Time',
          'End Time',
          'Product 1',
          'Product 2',
          'Product 3',
          'Visit Date',
          'Comment',
          'Department',
          'Base Location',
          'First Supervisor',
          'Second Supervisor',
        ];

        followUpTopRow.forEach((topRowValue, index) => {
          console.log(`${alphabetsArray[index]}1`, topRowValue);

          sheet2.cell(`${alphabetsArray[index]}1`).value(topRowValue);
        });

        followUpActivityIdsArray.forEach((activityId, index) => {
          console.log('id', activityId);
          const columnIndex = index + 2;

          const {
            visitType,
            phoneNumber,
            followUpStartTimestamp,
            followUpEndTimestamp,
            customer,
            firstContact,
            secondContact,
            product1,
            product2,
            product3,
            visitDateStartTime,
            closureStartTimestamp,
            closureEndTimestamp,
            comment,
            purpose,
            actualLocation,
          } = followUpObject[activityId];

          if (!employeesData[phoneNumber]) return;

          const date = dateStringWithOffset({
            timezone,
            timestampToConvert: followUpStartTimestamp,
          });

          const employeeName = employeesData[phoneNumber].Name;

          const startTime = (() => {
            let timestampToConvert = followUpStartTimestamp;

            if (closureStartTimestamp) {
              timestampToConvert = closureStartTimestamp;
            }

            return timeStringWithOffset({
              timezone,
              timestampToConvert,
            });
          })();

          const endTime = (() => {
            let timestampToConvert = followUpEndTimestamp;

            if (closureEndTimestamp) {
              timestampToConvert = closureEndTimestamp;
            }

            return timeStringWithOffset({
              timezone,
              timestampToConvert,
            });
          })();

          const visitDate = dateStringWithOffset({
            timezone,
            timestampToConvert: visitDateStartTime,
          });

          const address = '';

          const firstSupervisor = employeesData[phoneNumber]['First Supervisor'];
          const secondSupervisor = employeesData[phoneNumber]['Second Supervisor'];
          const department = employeesData[phoneNumber].Department;
          const baseLocation = employeesData[phoneNumber]['Base Location'];

          sheet2.cell(`A${columnIndex}`).value(date);
          sheet2.cell(`B${columnIndex}`).value(visitType);
          sheet2.cell(`C${columnIndex}`).value(employeeName);
          sheet2.cell(`D${columnIndex}`).value(customer);
          sheet2.cell(`E${columnIndex}`).value(firstContact);
          sheet2.cell(`F${columnIndex}`).value(secondContact);
          sheet2.cell(`G${columnIndex}`).value(address);
          sheet2
            .cell(`H${columnIndex}`)
            .value(actualLocation.identifier)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(actualLocation.url);
          sheet2.cell(`I${columnIndex}`).value(purpose);
          sheet2.cell(`J${columnIndex}`).value(startTime);
          sheet2.cell(`K${columnIndex}`).value(endTime);
          sheet2.cell(`L${columnIndex}`).value(product1);
          sheet2.cell(`M${columnIndex}`).value(product2);
          sheet2.cell(`N${columnIndex}`).value(product3);
          sheet2.cell(`O${columnIndex}`).value(visitDate);
          sheet2.cell(`P${columnIndex}`).value(comment);
          sheet2.cell(`Q${columnIndex}`).value(department);
          sheet2.cell(`R${columnIndex}`).value(baseLocation);
          sheet2.cell(`S${columnIndex}`).value(firstSupervisor);
          sheet2.cell(`T${columnIndex}`).value(secondSupervisor);
        });
      }

      // Default sheet
      workbook.deleteSheet('Sheet1');

      console.log(filePath);

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) return Promise.resolve();

      locals.messageObject.attachments.push({
        fileName,
        content: new Buffer(require('fs').readFileSync(filePath)).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
