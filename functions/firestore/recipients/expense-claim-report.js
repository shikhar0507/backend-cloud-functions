'use strict';


const xlsxPopulate = require('xlsx-populate');

const {
  rootCollections,
} = require('../../admin/admin');
const {
  sendGridTemplateIds,
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  dateStringWithOffset,
  momentOffsetObject,
  alphabetsArray,
  employeeInfo,
} = require('./report-utils');

const momentTz = require('moment-timezone');

module.exports = (locals) => {
  const {
    office,
  } = locals.change.after.data();

  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);
  const todaysDateString = momentTz().format(dateFormats.DATE);

  locals.messageObject.templateId = sendGridTemplateIds.expenseClaim;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: todaysDateString,
    subject: `Expense Claim Report_${office}_${todaysDateString}`,
  };

  const fileName = `Expense Claim Report_${office}_${todaysDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.EXPENSE_CLAIM)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
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

      const headers = [
        'Employee Name',
        'Employee Contact',
        'Amount',
        'Status',
        'Confirmed On',
        'Confirmed By',
        'Confirmed At',
        'Expense Date',
        'Expense Type',
        'Expense Location',
        'Reference Number',
        'Reason',
      ];

      const sheet1 = worksheet.sheet('Sheet1');
      sheet1.row(1).style('bold', true);

      headers.forEach((header, index) => {
        sheet1
          .cell(`${alphabetsArray[index]}1`)
          .value(header);
      });

      const employeesData = locals.officeDoc.get('employeesData');
      const expenseClaimObject = initDocsQuery.docs[0].get('expenseClaimObject');
      const activityIdsArray = Object.keys(expenseClaimObject);

      activityIdsArray.forEach((activityId, index) => {
        const columnNumber = index + 2;
        const row = expenseClaimObject[activityId];
        const expenseDate = dateStringWithOffset({
          timezone,
          timestampToConvert: row.expenseDateStartTime,
          format: dateFormats.DATE_TIME,
        });
        const phoneNumber = row.phoneNumber;
        const status = row.status;
        const employeeObject = employeeInfo(employeesData, phoneNumber);
        const employeeName = employeeObject.name || phoneNumber;
        const amount = row.amount;
        const expenseLocation = row.expenseLocation;
        const expenseType = row.expenseType;
        const referenceNumber = row.referenceNumber;
        const reason = row.reason;
        // Some older init docs may not be compatible with the logic
        // of showing url on all places of location in url.
        // Henceforth, we are short circuiting with the OR codition
        // const confirmedAt = row.confirmedAt || '';

        const confirmedOn = dateStringWithOffset({
          timezone,
          timestampToConvert: row.confirmedOn,
          format: dateFormats.DATE_TIME,
        });
        const confirmedBy = employeeInfo(employeesData, row.confirmedBy).name;
        const confirmedAt = row.confirmedAt || {};

        sheet1.cell(`A${columnNumber}`).value(employeeName);
        sheet1.cell(`B${columnNumber}`).value(phoneNumber);
        sheet1.cell(`C${columnNumber}`).value(Number(amount));
        sheet1.cell(`D${columnNumber}`).value(status);
        sheet1.cell(`E${columnNumber}`).value(confirmedOn);
        sheet1.cell(`F${columnNumber}`).value(confirmedBy);

        if (confirmedAt.url) {
          sheet1
            .cell(`G${columnNumber}`)
            .value(confirmedAt.identifier)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(confirmedAt.url);
        } else {
          sheet1
            .cell(`G${columnNumber}`)
            .value('');
        }

        sheet1.cell(`H${columnNumber}`).value(expenseDate);

        if (expenseLocation.url) {
          sheet1.
            cell(`I${columnNumber}`)
            .value(expenseLocation.identifier)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(expenseLocation.url);
        } else {
          sheet1.
            cell(`I${columnNumber}`)
            .value('');
        }
        sheet1.cell(`J${columnNumber}`).value(expenseType);
        sheet1.cell(`K${columnNumber}`).value(referenceNumber);
        sheet1.cell(`L${columnNumber}`).value(reason);
      });

      return worksheet.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        console.log('not sending after worksheet');

        return Promise.resolve();
      }

      const fs = require('fs');

      locals.messageObject.attachments.push({
        fileName,
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
