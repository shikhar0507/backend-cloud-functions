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
  employeeInfo,
} = require('./report-utils');
const {
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const fs = require('fs');


const handleSheetTwo = (params) => {
  const {
    worksheet,
    todayInitsQuery,
    customersData,
    employeesData,
    timezone,
  } = params;

  if (todayInitsQuery.empty) {
    return Promise.resolve(params);
  }

  const followUpObject = todayInitsQuery.docs[0].get('followUpObject');

  if (!followUpObject) {
    return Promise.resolve(params);
  }

  const phoneNumbers = Object.keys(followUpObject);

  if (phoneNumbers.length === 0) {
    return Promise.resolve(params);
  }

  const sheet2 = worksheet.addSheet('DSR Follow-Up');
  sheet2.row(1).style('bold', true);

  const followUpTopRow = [
    'Date',
    'Visit Type',
    'Employee Name',
    'Customer',
    'First Contact',
    'Second Contact',
    'Locality',
    'City',
    'State',
    'Address',
    'Actual Location',
    'Status',
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

  phoneNumbers.forEach((phoneNumber) => {
    const activityIdsArray = Object.keys(followUpObject[phoneNumber]);

    activityIdsArray.forEach((id, index) => {
      const {
        status,
        comment,
        purpose,
        customer,
        product1,
        product2,
        product3,
        visitType,
        firstContact,
        secondContact,
        actualLocation,
        visitEndTimestamp,
        visitStartTimestamp,
        closureEndTimestamp,
        followUpEndTimestamp,
        closureStartTimestamp,
        followUpStartTimestamp,
        locality,
        city,
        state,
      } = followUpObject[phoneNumber][id];

      const date = dateStringWithOffset({
        timezone,
        timestampToConvert: followUpStartTimestamp,
      });
      const startTime = (() => {
        let timestampToConvert = followUpStartTimestamp;

        if (closureStartTimestamp) {
          timestampToConvert = closureStartTimestamp;
        }

        return timeStringWithOffset({
          timezone,
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
          timezone,
          timestampToConvert,
          format: dateFormats.DATE_TIME,
        });
      })();

      const {
        name,
        department,
        baseLocation,
        firstSupervisor,
        secondSupervisor,
      } = employeeInfo(employeesData, phoneNumber);
      const visitDateStart = dateStringWithOffset({
        timezone,
        timestampToConvert: visitStartTimestamp,
        format: dateFormats.DATE_TIME,
      });
      const visitDateEnd = dateStringWithOffset({
        timezone,
        timestampToConvert: visitEndTimestamp,
        format: dateFormats.DATE_TIME,
      });

      const columnIndex = index + 2;

      sheet2.cell(`A${columnIndex}`).value(date);
      sheet2.cell(`B${columnIndex}`).value(visitType);
      sheet2.cell(`C${columnIndex}`).value(name);
      sheet2.cell(`D${columnIndex}`).value(customer);
      sheet2.cell(`E${columnIndex}`).value(firstContact);
      sheet2.cell(`F${columnIndex}`).value(secondContact);
      sheet2.cell(`G${columnIndex}`).value(locality);
      sheet2.cell(`I${columnIndex}`).value(city);
      sheet2.cell(`J${columnIndex}`).value(state);

      if (customer && customersData[customer]) {
        sheet2
          .cell(`K${columnIndex}`)
          .value(customersData[customer].identifier)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(customersData[customer].url);
      } else {
        sheet2
          .cell(`K${columnIndex}`)
          .value('');
      }

      console.log('actualLocation', actualLocation);

      sheet2
        .cell(`L${columnIndex}`)
        .value(actualLocation.identifier)
        .style({ fontColor: '0563C1', underline: true })
        .hyperlink(actualLocation.url);
      sheet2.cell(`M${columnIndex}`).value(status);
      sheet2.cell(`N${columnIndex}`).value(purpose);
      sheet2.cell(`O${columnIndex}`).value(startTime);
      sheet2.cell(`P${columnIndex}`).value(endTime);
      sheet2.cell(`Q${columnIndex}`).value(product1);
      sheet2.cell(`R${columnIndex}`).value(product2);
      sheet2.cell(`S${columnIndex}`).value(product3);
      sheet2.cell(`T${columnIndex}`)
        .value(`${visitDateStart} - ${visitDateEnd}`);
      sheet2.cell(`U${columnIndex}`).value(comment);
      sheet2.cell(`V${columnIndex}`).value(department);
      sheet2.cell(`W${columnIndex}`).value(baseLocation);
      sheet2.cell(`X${columnIndex}`).value(firstSupervisor);
      sheet2.cell(`Y${columnIndex}`).value(secondSupervisor);
    });
  });

  params.sheetTwoAdded = true;

  return params;
};


const handleSheetOne = (params) => {
  const {
    worksheet,
    yesterdayInitsQuery,
    customersData,
    employeesData,
    timezone,
  } = params;

  if (yesterdayInitsQuery.empty) {
    return Promise.resolve(params);
  }

  const visitObject = yesterdayInitsQuery.docs[0].get('visitObject');

  if (!visitObject) {
    return Promise.resolve(params);
  }

  const phoneNumbers = Object.keys(visitObject);

  if (phoneNumbers.length === 0) {
    return Promise.resolve(params);
  }

  const sheet1 = worksheet.addSheet('DSR Visits');
  sheet1.row(1).style('bold', true);

  const visitsSheetTopRow = [
    'Visit Date',
    'Employee Name',
    'Customer Location',
    'First Contact',
    'Second Contact',
    'Locality',
    'City',
    'State',
    'Address',
    'Actual Location',
    'Status',
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

  phoneNumbers.forEach((phoneNumber) => {
    const activityIdsArray = Object.keys(visitObject[phoneNumber]);

    activityIdsArray.forEach((activityId, index) => {
      const {
        status,
        comment,
        // Customer's name
        customer,
        firstContact,
        followUpEndTimestamp,
        followUpStartTimestamp,
        product1,
        product2,
        product3,
        purpose,
        secondContact,
        visitEndTimestamp,
        visitStartTimestamp,
        actualLocation,
        locality,
        city,
        state,
      } = visitObject[phoneNumber][activityId];

      const columnIndex = index + 2;

      const startTime = timeStringWithOffset({
        timezone,
        timestampToConvert: visitStartTimestamp,
        format: dateFormats.DATE_TIME,
      });
      const endTime = timeStringWithOffset({
        timezone,
        timestampToConvert: visitEndTimestamp,
        format: dateFormats.DATE_TIME,
      });
      const visitDate = dateStringWithOffset({
        timezone,
        timestampToConvert: visitStartTimestamp,
      });
      const followUpDateStart = dateStringWithOffset({
        timezone,
        timestampToConvert: followUpStartTimestamp,
        format: dateFormats.DATE_TIME,
      });
      const followUpDateEnd = dateStringWithOffset({
        timezone,
        timestampToConvert: followUpEndTimestamp,
        format: dateFormats.DATE_TIME,
      });

      const employeeObject = employeeInfo(employeesData, phoneNumber);
      const customerLocation = (() => {
        if (!customersData[customer]) return '';

        return customersData[customer].identifier;
      })();

      const url = (() => {
        if (!customersData[customer]) return '';

        return customersData[customer].url;
      })();

      const employeeName = employeeObject.name;
      const department = employeeObject.department;
      const baseLocation = employeeObject.baseLocation;
      const firstSupervisor = employeeObject.firstSupervisor;
      const secondSupervisor = employeeObject.secondSupervisor;

      sheet1.cell(`A${columnIndex}`).value(visitDate);
      sheet1.cell(`B${columnIndex}`).value(employeeName);
      sheet1.cell(`C${columnIndex}`).value(customerLocation);
      sheet1.cell(`D${columnIndex}`).value(firstContact);
      sheet1.cell(`E${columnIndex}`).value(secondContact);
      sheet1.cell(`F${columnIndex}`).value(locality);
      sheet1.cell(`G${columnIndex}`).value(city);
      sheet1.cell(`H${columnIndex}`).value(state);
      sheet1
        .cell(`I${columnIndex}`)
        .value(customerLocation)
        .style({ fontColor: '0563C1', underline: true })
        .hyperlink(url);
      sheet1
        .cell(`J${columnIndex}`)
        .value(actualLocation.identifier)
        .style({ fontColor: '0563C1', underline: true })
        .hyperlink(actualLocation.url);
      sheet1.cell(`K${columnIndex}`).value(status);
      sheet1.cell(`L${columnIndex}`).value(purpose);
      sheet1.cell(`M${columnIndex}`).value(startTime);
      sheet1.cell(`N${columnIndex}`).value(endTime);
      sheet1.cell(`O${columnIndex}`).value(product1);
      sheet1.cell(`P${columnIndex}`).value(product2);
      sheet1.cell(`Q${columnIndex}`).value(product3);
      sheet1
        .cell(`R${columnIndex}`)
        .value(`${followUpDateStart} - ${followUpDateEnd}`);
      sheet1.cell(`S${columnIndex}`).value(comment);
      sheet1.cell(`T${columnIndex}`).value(department);
      sheet1.cell(`U${columnIndex}`).value(baseLocation);
      sheet1.cell(`V${columnIndex}`).value(firstSupervisor);
      sheet1.cell(`W${columnIndex}`).value(secondSupervisor);
    });
  });

  params.sheetOneAdded = true;

  return params;
};

module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const employeesData = locals.officeDoc.get('employeesData');
  const todayFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObjectToday = momentTz(todayFromTimer).tz(timezone).startOf('day');
  const momentDateObjectYesterday =
    momentTz(todayFromTimer)
      .subtract(1, 'day')
      .tz(timezone)
      .startOf('day');
  const standardDateString = momentDateObjectToday.format(dateFormats.DATE);
  const fileName = `DSR_${office}_${standardDateString}.xlsx`;
  const customersData = locals.officeDoc.get('customersData');
  const filePath = `/tmp/${fileName}`;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: standardDateString,
    subject: `DSR_${office}_${standardDateString}`,
  };

  let params;

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.DSR)
        .where('date', '==', momentDateObjectYesterday.date())
        .where('month', '==', momentDateObjectYesterday.month())
        .where('year', '==', momentDateObjectYesterday.year())
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.DSR)
        .where('date', '==', momentDateObjectToday.date())
        .where('month', '==', momentDateObjectToday.month())
        .where('year', '==', momentDateObjectToday.year())
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        yesterdayInitsQuery,
        todayInitsQuery,
        worksheet,
      ] = result;

      params = {
        timezone,
        worksheet,
        customersData,
        todayInitsQuery,
        employeesData,
        yesterdayInitsQuery,
        sendMail: locals.sendMail,
      };

      if (yesterdayInitsQuery.empty && todayInitsQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve(params);
      }

      return handleSheetOne(params);
    })
    .then(handleSheetTwo)
    .then((params) => {
      if (!params.sheetOneAdded && !params.sheetTwoAdded) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      if (!params.todayInitsQuery.empty || !params.yesterdayInitsQuery.empty) {
        params.worksheet.deleteSheet('Sheet1');
      }

      return params.worksheet.toFileAsync(filePath);
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

      console.log({
        report: reportNames.DSR,
        to: locals.messageObject.to,
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
