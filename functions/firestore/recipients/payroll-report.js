'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

const {
  sendGridTemplateIds,
} = require('../../admin/constants');

const {
  getYesterdaysDateString,
  getPreviousDayMonth,
  getNumberOfDaysInMonth,
} = require('./report-utils');


const getHeader = () => {
  const today = new Date();
  const date = today.getDate();
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec',
  ];

  const monthName = monthNames[today.getMonth()];

  let str = ` Employee Name,`
    + ` Employee Contact,`
    + ` Department,`
    + ` Base Location,`
    + ` Live Since, `;

  const numberOfDays = getNumberOfDaysInMonth({
    month: today.getMonth() + 1,
    year: today.getFullYear(),
  });

  /** Human readable dates start with 1. */
  for (let i = 0; i <= numberOfDays; i++) {
    str += `${monthName}-${i + 1}`;

    if (i !== date) {
      str += `, `;
    }
  }

  str += '\n';

  return str;
};


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  const yesterdaysDateString = getYesterdaysDateString();

  locals.messageObject.templateId = sendGridTemplateIds.payroll;
  locals.csvString = getHeader();
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: yesterdaysDateString,
    subject: `Payroll Report_${office}_${yesterdaysDateString}`,
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
        .where('distanceAccurate', '==', true)
        .where('month', '==', getPreviousDayMonth())
        .get(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocs,
      ] = result;

      return Promise.resolve();
    })
    .catch(console.error);
};
