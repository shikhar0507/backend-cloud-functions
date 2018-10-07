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
  let str = ` Employee Name,`
    + ` Employee Contact,`
    + ` Department,`
    + ` Base Location,`
    + ` Live Since, `;
  const monthName = monthNames[today.getMonth()];
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

  str += `FULL DAY,`
    + ` HALF DAY,`
    + ` LEAVE,`
    + ` HOLIDAY,`
    + ` BLANK,`
    + ` LATE,`
    + ` ON-DUTY,`
    + ` WEEKLY OFF,`
    + ` TOTAL,`;

  str += '\n';

  return str;
};

const getRow = (employeesData, phoneNumber, payrollObject) => {
  let str = '';

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
        .where('report', '==', 'payroll')
        .where('month', '==', getPreviousDayMonth())
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        officeDoc,
        initDocsQuery,
      ] = result;

      if (initDocsQuery.empty) {
        console.log('Init docs not found.');

        return Promise.resolve();
      }

      const initDoc = initDocsQuery.docs[0];
      const employeesData = officeDoc.get('employeesData');
      const employeesPhoneNumberList = Object.keys(employeesData);
      const payrollObject = initDoc.get('payrollObject');

      employeesPhoneNumberList.forEach((phoneNumber) => {
        locals.csvString += getRow(employeesData, phoneNumber, payrollObject);
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Payroll Report_${yesterdaysDateString}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
