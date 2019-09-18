'use strict';

const {
  dateFormats,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const {
  getName,
  alphabetsArray,
  toMapsUrl,
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
  const momentYesterday = momentToday
    .clone()
    .subtract(1, 'day');
  const dateYesterday = momentYesterday
    .date();
  const monthYearString = momentYesterday
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
        .fromBlankAsync()
    ]);

  const expenseSheet = workbook
    .addSheet(`Expense${momentToday.format(dateFormats.DATE)}`);

  workbook
    .deleteSheet('Sheet1');

  [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    'Date',
    'Local/Travel',
    'Claim Type',
    'Amount',
    'Claim Details',
    'Approval Details'
  ].forEach((value, index) => {
    expenseSheet
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

          reimbursements
            .forEach(object => {
              const o = Object.assign({}, object, {
                date,
                month: doc.get('month'),
                year: doc.get('year'),
              });

              allOrderedItems.push(o);
            });
        });
    });


  if (allOrderedItems.length === 0) {
    console.log('empty data');

    return;
  }

  allOrderedItems
    .forEach((item, index) => {
      const columnIndex = index + 2;

      expenseSheet
        .cell(`A${columnIndex}`)
        .value(getName(locals.employeesData, item.phoneNumber));
      expenseSheet
        .cell(`B${columnIndex}`)
        .value(item.phoneNumber);
      expenseSheet
        .cell(`C${columnIndex}`)
        .value(locals.employeesData[item.phoneNumber]['Employee Code']);
      expenseSheet
        .cell(`D${columnIndex}`)
        .value(locals.employeesData[item.phoneNumber]['Base Location']);
      expenseSheet
        .cell(`E${columnIndex}`)
        .value(locals.employeesData[item.phoneNumber]['Region']);
      expenseSheet
        .cell(`F${columnIndex}`)
        .value(locals.employeesData[item.phoneNumber]['Department']);

      const dateString = momentTz(item.timestamp)
        .tz(timezone)
        .format(dateFormats.DATE_TIME);

      expenseSheet
        .cell(`G${columnIndex}`)
        .value(dateString);

      const localOrTravel = (() => {
        if (item.isTravel) {
          return 'travel';
        }

        return 'local';
      })();

      expenseSheet
        .cell(`H${columnIndex}`)
        .value(localOrTravel);

      expenseSheet
        .cell(`I${columnIndex}`)
        .value(item.name || item.claimType || ''); // claim type

      expenseSheet
        .cell(`J${columnIndex}`)
        .value(item.amount);

      if (item.template === 'km allowance') {
        expenseSheet
          .cell(`K${columnIndex}`)
          .value(item.amount); // claim details
      }

      if (item.template === 'daily allowance') {
        expenseSheet
          .cell(`K${columnIndex}`)
          .value(item.timestamp) // claim details
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(toMapsUrl(item));
      }

      if (item.template === 'claim'
        && item.photoURL) {
        expenseSheet
          .cell(`K${columnIndex}`)
          .value(`${item.amount}, ${item.claimType}`)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(item.photoURL || ''); // claim details
      } else {
        expenseSheet
          .cell(`K${columnIndex}`)
          .value(`${item.amount}, ${item.claimType}`);
      }

      const approvalDetails = (() => {
        if (item.template === 'claim') {
          if (item.confirmedBy) {
            return `${item.status},`
              + ` ${getName(locals.employeesData, item.confirmedBy)},`
              + ` ${momentTz(item.approvalTimestamp).tz(timezone).format(dateFormats.DATE_TIME)}`;
          }

          return `${item.status}`;
        }

        return `NA`;
      })();

      expenseSheet
        .cell(`L${columnIndex}`)
        .value(approvalDetails); // approval details
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

  console.log('mailed', locals.messageObject.to);

  return locals
    .sgMail
    .sendMultiple(locals.messageObject);
};
