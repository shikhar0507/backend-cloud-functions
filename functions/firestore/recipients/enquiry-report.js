'use strict';

const {
  rootCollections,
  users,
} = require('../../admin/admin');
const {
  momentOffsetObject,
} = require('./report-utils');
const {
  dateFormats,
} = require('../../admin/constants');
const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');
const momentTz = require('moment-timezone');

module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);
  const fileName = `${office} Enquiry Report_${locals.standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  const authMap = new Map();

  let enquiryArray;
  let sheet;
  const dateString = momentTz().tz(timezone).format(dateFormats.DATE);

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('date', '==', momentDateObject.yesterday.DATE_NUMBER)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .limit(1)
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

        return Promise.resolve();
      }

      sheet = worksheet.sheet('Sheet1');

      sheet.cell('A1').value('DATE');
      sheet.cell('B1').value('NAME');
      sheet.cell('C1').value(`Enquirer's Contact Number`);
      sheet.cell('D1').value(`Enquirer's Email Id`);
      sheet.cell('E1').value('Enquiry');

      enquiryArray = initDocsQuery.docs[0].get('enquiryArray');

      const authToFetch = [];

      enquiryArray.forEach((item) => {
        const promise = users.getUserByPhoneNumber(item.phoneNumber);
        authMap.set(item.phoneNumber, {});

        authToFetch.push(promise);
      });

      return Promise
        .all(authToFetch);
    })
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];
        const email = record.email;
        const displayName = record.displayName;

        authMap.set(phoneNumber, { email, displayName });
      });

      enquiryArray.forEach((item, index) => {
        const columnIndex = index + 2;
        const {
          enquiryText,
          phoneNumber,
          // companyName,
        } = item;

        const name = authMap.get(phoneNumber).displayName;

        sheet.cell(`A${columnIndex}`).value(dateString);
        sheet.cell(`B${columnIndex}`).value(name);
        sheet.cell(`C${columnIndex}`).value(phoneNumber);
        sheet.cell(`D${columnIndex}`).value(enquiryText);
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
