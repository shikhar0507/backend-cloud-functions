'use strict';


const xlsxPopulate = require('xlsx-populate');

const {
  rootCollections,
} = require('../../admin/admin');
const {
  sendGridTemplateIds,
} = require('../../admin/constants');
const {
  getPreviousDayMonth,
} = require('./report-utils');

module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  locals.sendMail = true;
  locals.messageObject.templateId = sendGridTemplateIds.expenseClaim;

  const fileName = `${office} Expense Claim Report_${new Date().toDateString()}.xlsx`;
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

      if (initDocsQuery) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      const headers = [
        'Expense Date',
        'Employee Name',
        'Employee Contact',
        'Total Expense Claimed',
        'Expense Location',
        'Expense Location',
        'Expense Type',
        'Reference Number',
        'Reason',
      ];

      const alphabets =
        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];

      const sheet1 = worksheet.sheet('sheet1');

      headers
        .forEach(
          (header, index) => sheet1
            .cell(`${alphabets[index + 1]}1`)
            .value(header));

      const employeesData = officeDoc.get('employeesData');

      return;
    })
    .catch(console.error);
};
