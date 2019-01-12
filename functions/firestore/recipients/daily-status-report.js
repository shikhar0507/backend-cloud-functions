'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  reportNames,
} = require('../../admin/constants');
const {
  alphabetsArray,
} = require('../recipients/report-utils');
const fs = require('fs');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');


module.exports = (locals) => {
  const fileName = `Growthfile Daily Status Report.xlsx`;
  const filePath = `/tmp/${fileName}`;
  const yesterdayStartMoment =
    momentTz()
      .subtract(1, 'days')
      .startOf('days');
  const yesterdayMomentObject = yesterdayStartMoment.toObject();

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', yesterdayMomentObject.date)
        .where('month', '==', yesterdayMomentObject.months)
        .where('year', '==', yesterdayMomentObject.years)
        .where()
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .where('lastQueryFrom', '>=', yesterdayStartMoment.unix() * 1000)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        initDocsQuery,
        profilesDocsQuery,
        worksheet,
      ] = result;

      const usersStatusSheet = worksheet.addSheet('User Status Report');
      const activityStatusSheet = worksheet.addSheet('Activity Status Report');
      const activeYesterday = profilesDocsQuery.size;

      worksheet.deleteSheet('Sheet1');

      [
        'TOTAL USERS',
        'USERS ADDED YESTERDAY',
        'ACTIVE YESTERDAY',
        'INSTALLED YESTERDAY',
      ]
        .forEach((topRowValue, index) => {
          usersStatusSheet
            .cell(`${alphabetsArray[index]}1`).value(topRowValue);
        });

      const {
        totalUsers,
        usersAdded,
        installedYesterday,
      } = initDocsQuery.docs[0].data();

      usersStatusSheet.cell('A2').value(totalUsers);
      usersStatusSheet.cell('B2').value(usersAdded);
      usersStatusSheet.cell('C2').value(activeYesterday);
      usersStatusSheet.cell('D2').value(installedYesterday);

      [
        'TOTAL',
        'ADDED YESTERDAY',
        'USING ADMIN API',
        'USING CLIENT API',
        'AUTO GENERATED',
        'WITH SUPPORT',
        'CREATE API',
        'UPDATE API',
        'CHANGE STATUS API',
        'SHARE API',
        'COMMENT API',
      ]
        .forEach((topRowValue, index) => {
          activityStatusSheet
            .cell(`${alphabetsArray[index]}1`).value(topRowValue);
        });

      return worksheet.toFileAsync();
    })
    .then(() => {
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
