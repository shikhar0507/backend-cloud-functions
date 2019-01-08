'use strict';

const {
  rootCollections,
  db,
} = require('../../admin/admin');

const xlsxPopulate = require('xlsx-populate');

module.exports = (locals) => {
  const fileName = `Growthfile Daily Status Report.xlsx`;
  const filePath = `/tmp/${fileName}`;

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', 'daily system report')
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        initDocQuery,
        worksheet,
      ] = result;

      const usersStatusSheet = worksheet.addSheet('User Status Report');
      const activityStatusSheet = worksheet.addSheet('Activity Status Report');

      const sheet1 = worksheet.addSheet('Daily Report');
      worksheet.deleteSheet('Sheet1');

      return;
    })
    .catch(console.error);
};
