'use strict';

const {
  dateFormats,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const {
  getName,
  alphabetsArray,
} = require('./report-utils');
const env = require('../../admin/env');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(env.sgMailApiKey);


module.exports = async locals => {
  const timestampFromTimer = locals
    .change
    .after
    .get('timestamp');
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const momentToday = momentTz(timestampFromTimer)
    .tz(timezone);
  const mmomentYesterday = momentToday
    .clone()
    .subtract(1, 'day');
  const dateYesterday = mmomentYesterday
    .date();
  const monthYearString = mmomentYesterday
    .format(dateFormats.MONTH_YEAR);

  const [
    snapShot,
    workbook,
  ] = await Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Statuses')
        .doc(monthYearString)
        .collection('Employees')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ]);

  const reimbursementSheet = workbook
    .addSheet(`Reimbursement ${momentToday.format(dateFormats.DATE)}`);
  reimbursementSheet
    .row(0)
    .style('bold', true);
  workbook
    .deleteSheet('Sheet1');

  [
    'Employee',
    'Type',
    'Amount',
    'Details',
    'Reference',
    'Date',
    'Status',
  ].forEach((value, index) => {
    reimbursementSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value);
  });

  const allDates = Array
    .from(
      new Array(dateYesterday),
      (_, i) => i + 1
    );
  const allOrderedItems = [];

  snapShot
    .forEach(doc => {
      const statusObject = doc.get('statusObject');

      allDates
        .forEach(date => {
          const item = statusObject[date] || {};
          const reimbursements = item.reimbursements || [];

          // FIXME: This loop is bad. Optimize this.
          reimbursements
            .forEach(object => {
              allOrderedItems.push({
                date,
                month: doc.get('month'),
                year: doc.get('year'),
                photoUrl: object.photoUrl,
                amount: object.amount,
                details: object.details,
                identifier: object.identifier,
                latitude: object.latitude,
                longitude: object.longitude,
                template: object.template,
                phoneNumber: doc.get('phoneNumber'),
              });
            });
        });
    });

  if (allOrderedItems.length === 0) {
    return;
  }

  allOrderedItems
    .forEach((item, index) => {
      const columnIndex = index + 2;

      reimbursementSheet
        .cell(`A${columnIndex}`)
        .value(getName(locals.employeesData, item.phoneNumber));
      reimbursementSheet
        .cell(`B${columnIndex}`)
        .value(item.template);
      reimbursementSheet
        .cell(`C${columnIndex}`)
        .value(item.amount);
      reimbursementSheet
        .cell(`D${columnIndex}`)
        .value(item.details);
      reimbursementSheet
        .cell(`E${columnIndex}`)
        .value(item.photoUrl);

      const dd = momentTz()
        .date(item.date)
        .month(item.month)
        .year(item.year)
        .tz(timezone)
        .format(dateFormats.DATE);

      reimbursementSheet
        .cell(`F${columnIndex}`)
        .value(dd);
      reimbursementSheet
        .cell(`G${columnIndex}`)
        .value(item.status);
    });

  locals
    .messageObject
    .attachments
    .push({
      fileName: `Reimbursement Report_`
        + `${locals.officeDoc.get('office')}`
        + `_${momentToday.format(dateFormats.DATE)}.xlsx`,
      content: await workbook.outputAsync('base64'),
      type: 'text/csv',
      disposition: 'attachment',
    });

  if (!env.isProduction) {
    return;
  }

  console.log('mail sent', locals.messageObject.to);

  return locals
    .sgMail
    .sendMultiple(locals.messageObject);
};
