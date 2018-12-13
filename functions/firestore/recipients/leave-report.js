'use strict';

const xlsxPopulate = require('xlsx-populate');
// const { } = require('./report-utils');
const {
  sendGridTemplateIds,
} = require('../../admin/constants');
const {
  rootCollections,
} = require('../../admin/admin');
const {
  alphabetsArray,
  momentDateObject,
} = require('./report-utils');

module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after();

  const todaysDateString = new Date().toDateString();
  const fileName = `${office} DSR Report_${todaysDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  locals.messageObject.templateId = sendGridTemplateIds.leave;
  locals.messageObject['dynamic_template_data'] = {};

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .get(),
      rootCollections
        .inits
        .where('report', '==', 'leave')
        .where('office', '==', office)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocsQuery,
        workbook,
      ] = result;
      /**
       * FIELDS:
       * 
       *  1. Employee Name
       *  2. Employee Contact
       *  3. Annual Limit
       *  4. Total Leaves Taken
       *  5. Leave Dates
       *  6. Total Leaves Remaining
       *  7. Approved By
       *  8. Reason
       *  9. Department
       *  10. Base Location
       *  11. First Supervisor
       *  12. Second Supervisor
       */

      const sheet1 = workbook.addSheet('Leave');
      sheet1.row(1).style('bold', true);
      workbook.deleteSheet('Sheet1');

      const firstRowValues = [
        'Employee Name',
        'Employee Contact',
        'Annual Limit',
        'Total Leaves Taken',
        'Leave Dates',
        'Total Leaves Remaining',
        'Approved By',
        'Reason',
        'Department',
        'Base Location',
        'First Supervisor',
        'Second Supervisor',
      ];

      firstRowValues.forEach((header, index) => {
        sheet1
          .cell(`${alphabetsArray[index]}1`)
          .value(header);
      });

      return;
    })
    .catch(console.error);
};
