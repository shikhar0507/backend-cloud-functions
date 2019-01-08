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
  alphabetsArray,
  // momentDateObject,
  momentOffsetObject,
  employeeInfo,
  toMapsUrl,
} = require('./report-utils');
const {
  sendGridTemplateIds,
  reportNames,
  dateFormats,
} = require('../../admin/constants');

const xlsxPopulate = require('xlsx-populate');
const moment = require('moment');


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const standardDateString = moment().format(dateFormats.DATE);
  const fileName = `DSR_${office}_${standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  locals.sendMail = true;
  locals.messageObject.templateId = sendGridTemplateIds.dsr;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: standardDateString,
    subject: `DSR_${office}_${standardDateString}`,
  };

  const customersMap = new Map();

  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.DSR)
        .where('date', '==', momentDateObject.yesterday.DATE_NUMBER)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.DSR)
        .where('date', '==', momentDateObject.today.DATE_NUMBER)
        .where('month', '==', momentDateObject.today.MONTH_NUMBER)
        .where('year', '==', momentDateObject.today.YEAR)
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        yesterdayInitsQuery,
        todayInitsQuery,
        workbook,
      ] = result;

      if (yesterdayInitsQuery.empty && todayInitsQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      const employeesData = locals.officeDoc.get('employeesData');

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

      const customerFetch = [];

      visitsActivityIdsArray.forEach((activityId) => {
        const {
          customer,
        } = visitObject[activityId];

        const promise = rootCollections
          .offices
          .doc(officeId)
          .collection('Activities')
          .where('template', '==', 'customer')
          .where('attachment.Name.value', '==', customer)
          .limit(1)
          .get();

        customerFetch.push(promise);
      });

      followUpActivityIdsArray.forEach((activityId) => {
        const {
          customer,
        } = followUpObject[activityId];

        const promise = rootCollections
          .offices
          .doc(officeId)
          .collection('Activities')
          .where('template', '==', 'customer')
          .where('attachment.Name.value', '==', customer)
          .limit(1)
          .get();

        customerFetch.push(promise);
      });

      locals.workbook = workbook;
      locals.timezone = timezone;
      locals.visitObject = visitObject;
      locals.followUpObject = followUpObject;
      locals.visitsActivityIdsArray = visitsActivityIdsArray;
      locals.followUpActivityIdsArray = followUpActivityIdsArray;
      locals.employeesData = employeesData;

      return Promise.all(customerFetch);
    })
    .then((snapShots) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const customerName = snapShot.docs[0].get('attachment.Name.value');
        const customerLocation = snapShot.docs[0].get('venue')[0];

        customersMap.set(customerName, customerLocation);
      });

      if (locals.visitsActivityIdsArray.length > 0) {
        const sheet1 = locals.workbook.addSheet('DSR Visits');
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
          sheet1.cell(`${alphabetsArray[index]}1`).value(topRowValue);
        });

        locals.visitsActivityIdsArray.forEach((activityId, index) => {
          const {
            comment,
            purpose,
            customer,
            product1,
            product2,
            product3,
            phoneNumber,
            firstContact,
            secondContact,
            actualLocation,
            visitEndTimestamp,
            followUpStartTimestamp,
            followUpEndTimestamp,
            visitStartTimestamp,
          } = locals.visitObject[activityId];

          const startTime = timeStringWithOffset({
            timezone: locals.timezone,
            timestampToConvert: visitStartTimestamp,
            format: dateFormats.DATE_TIME,
          });
          const endTime = timeStringWithOffset({
            timezone: locals.timezone,
            timestampToConvert: visitEndTimestamp,
            format: dateFormats.DATE_TIME,
          });
          const visitDate = dateStringWithOffset({
            timezone: locals.timezone,
            timestampToConvert: visitStartTimestamp,
          });
          const followUpDateStart = dateStringWithOffset({
            timezone: locals.timezone,
            timestampToConvert: followUpStartTimestamp,
            format: dateFormats.DATE_TIME,
          });
          const followUpDateEnd = dateStringWithOffset({
            timezone: locals.timezone,
            timestampToConvert: followUpEndTimestamp,
            format: dateFormats.DATE_TIME,
          });

          const employeeObject =
            employeeInfo(locals.employeesData, phoneNumber);
          const employeeName = employeeObject.name;
          const department = employeeObject.department;
          const baseLocation = employeeObject.baseLocation;
          const firstSupervisor = employeeObject.firstSupervisor;
          const secondSupervisor = employeeObject.secondSupervisor;
          const customerLocation = (() => {
            if (!customersMap.get(customer)) return '';

            return customersMap.get(customer).location;
          })();

          const address = (() => {
            if (!customersMap.has(customer)) return '';

            return customersMap.get(customer).address;
          })();

          const columnIndex = index + 2;

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
          sheet1
            .cell(`N${columnIndex}`)
            .value(`${followUpDateStart} - ${followUpDateEnd}`);
          sheet1.cell(`O${columnIndex}`).value(comment);
          sheet1.cell(`P${columnIndex}`).value(department);
          sheet1.cell(`Q${columnIndex}`).value(baseLocation);
          sheet1.cell(`R${columnIndex}`).value(firstSupervisor);
          sheet1.cell(`S${columnIndex}`).value(secondSupervisor);
        });
      }

      if (locals.followUpActivityIdsArray.length > 0) {
        const sheet2 = locals.workbook.addSheet('DSR Follow-Up');
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
          sheet2.cell(`${alphabetsArray[index]}1`).value(topRowValue);
        });

        locals.followUpActivityIdsArray.forEach((activityId, index) => {
          const columnIndex = index + 2;

          const {
            comment,
            purpose,
            // customer name
            customer,
            product1,
            product2,
            product3,
            visitType,
            phoneNumber,
            firstContact,
            secondContact,
            actualLocation,
            visitDateEndTime,
            visitDateStartTime,
            closureEndTimestamp,
            followUpEndTimestamp,
            closureStartTimestamp,
            followUpStartTimestamp,
          } = locals.followUpObject[activityId];

          const date = dateStringWithOffset({
            timezone: locals.timezone,
            timestampToConvert: followUpStartTimestamp,
          });
          const startTime = (() => {
            let timestampToConvert = followUpStartTimestamp;

            if (closureStartTimestamp) {
              timestampToConvert = closureStartTimestamp;
            }

            return timeStringWithOffset({
              timezone: locals.timezone,
              timestampToConvert,
              format: dateFormats.DATE_TIME,
            });
          })();
          const endTime = (() => {
            let timestampToConvert = followUpEndTimestamp;

            if (closureEndTimestamp) {
              timestampToConvert = closureEndTimestamp;
            }

            return timeStringWithOffset({
              timezone: locals.timezone,
              timestampToConvert,
              format: dateFormats.DATE_TIME,
            });
          })();

          const employeeObject =
            employeeInfo(locals.employeesData, phoneNumber);
          const employeeName = employeeObject.name;
          const department = employeeObject.department;
          const baseLocation = employeeObject.baseLocation;
          const firstSupervisor = employeeObject.firstSupervisor;
          const secondSupervisor = employeeObject.secondSupervisor;
          const customerData = customersMap.get(customer);
          const visitDateStart = dateStringWithOffset({
            timezone,
            timestampToConvert: visitDateStartTime,
            format: dateFormats.DATE_TIME,
          });
          const visitDateEnd = dateStringWithOffset({
            timezone,
            timestampToConvert: visitDateEndTime,
            format: dateFormats.DATE_TIME,
          });

          sheet2.cell(`A${columnIndex}`).value(date);
          sheet2.cell(`B${columnIndex}`).value(visitType);
          sheet2.cell(`C${columnIndex}`).value(employeeName);
          sheet2.cell(`D${columnIndex}`).value(customer);
          sheet2.cell(`E${columnIndex}`).value(firstContact);
          sheet2.cell(`F${columnIndex}`).value(secondContact);

          if (customersMap.has(customer)
            && customersMap.get(customer).address) {
            sheet2
              .cell(`G${columnIndex}`)
              .value(customerData.address)
              .style({ fontColor: '0563C1', underline: true })
              .hyperlink(toMapsUrl(customerData.geopoint));
          } else {
            sheet2
              .cell(`G${columnIndex}`)
              .value('');
          }
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
          sheet2
            .cell(`O${columnIndex}`)
            .value(`${visitDateStart} - ${visitDateEnd}`);
          sheet2.cell(`P${columnIndex}`).value(comment);
          sheet2.cell(`Q${columnIndex}`).value(department);
          sheet2.cell(`R${columnIndex}`).value(baseLocation);
          sheet2.cell(`S${columnIndex}`).value(firstSupervisor);
          sheet2.cell(`T${columnIndex}`).value(secondSupervisor);
        });
      }

      // Default sheet
      if (locals.followUpActivityIdsArray.length > 0
        || locals.visitsActivityIdsArray.length > 0) {
        locals.workbook.deleteSheet('Sheet1');
      }

      return locals.workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      const fs = require('fs');

      locals.messageObject.attachments.push({
        fileName,
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      console.log({
        report: locals.change.after.get('report'),
        to: locals.messageObject.to,
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
