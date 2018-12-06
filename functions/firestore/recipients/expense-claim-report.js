'use strict';


const xlsxPopulate = require('xlsx-populate');

const {
  rootCollections,
} = require('../../admin/admin');
const {
  sendGridTemplateIds,
} = require('../../admin/constants');
const {
  dateStringWithOffset,
  getPreviousDayMonth,
  getPreviousDayYear,
} = require('./report-utils');

module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const todaysDateString = new Date().toDateString();

  locals.sendMail = true;
  locals.messageObject.templateId = sendGridTemplateIds.expenseClaim;
  locals.messageObject['dynamic_template_data'] = {
    date: todaysDateString,
    subject: `Expense Claim Report_${office}_${todaysDateString}`,
  };

  const fileName = `Expense Claim Report_${office}_${todaysDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', 'expense claim')
        .where('month', '==', getPreviousDayMonth())
        .where('year', '==', getPreviousDayYear())
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocsQuery,
        worksheet,
      ] = result;

      if (initDocsQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      /**
       * init doc has the following fields
       * based on init
       * date: new Date(expenseDateStartTime).getDate(),
       *  phoneNumber: addendumDoc.get('user'),
       * amount: activityData.attachment.Amount.value,
       *  status: activityData.status,
       */

      const headers = [
        'Expense Date',
        'Employee Name',
        'Employee Contact',
        'Amount',
        'Status',
        'Expense Location',
        'Expense Type',
        'Reference Number',
        'Reason',
      ];

      const alphabets =
        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

      const sheet1 = worksheet.sheet('Sheet1');
      sheet1.row(1).style('bold', true);

      headers
        .forEach(
          (header, index) => {
            sheet1
              .cell(`${alphabets[index]}1`)
              .value(header);
          });

      const employeesData = officeDoc.get('employeesData');
      const timezone = officeDoc.get('attachment.Timezone.value');
      const expenseClaimObject = initDocsQuery.docs[0].get('expenseClaimObject');
      const activityIdsArray = Object.keys(expenseClaimObject);

      activityIdsArray.forEach((activityId, index) => {
        const columnNumber = index + 2;
        const row = expenseClaimObject[activityId];

        const expenseDate = dateStringWithOffset({
          timezone,
          timestampToConvert: row.expenseDateStartTime,
        });
        const phoneNumber = row.phoneNumber;
        const status = row.status;
        const employeeName = employeesData[phoneNumber].Name;
        const amount = row.amount;
        const expenseLocation = row.expenseLocation;
        const expenseType = row.expenseType;
        const referenceNumber = row.referenceNumber;
        const reason = row.reason;

        sheet1.cell(`A${columnNumber}`).value(expenseDate);
        sheet1.cell(`B${columnNumber}`).value(employeeName);
        sheet1.cell(`C${columnNumber}`).value(phoneNumber);
        sheet1.cell(`D${columnNumber}`).value(amount);
        sheet1.cell(`E${columnNumber}`).value(status);
        sheet1.cell(`F${columnNumber}`).value(expenseLocation);
        sheet1.cell(`G${columnNumber}`).value(expenseType);
        sheet1.cell(`H${columnNumber}`).value(referenceNumber);
        sheet1.cell(`H${columnNumber}`).value(reason);
      });

      return worksheet.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) return Promise.resolve();

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
