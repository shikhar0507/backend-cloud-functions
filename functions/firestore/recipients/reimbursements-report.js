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
  getFieldValue,
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

  const expenseSummarySheet = workbook
    .addSheet(`Expense Summary`);

  const expenseSheet = workbook
    .addSheet(`Expense ${momentToday.format(dateFormats.DATE)}`);

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

  let allExpeneTypes = new Set();

  const allDates = Array
    .from(
      new Array(dateYesterday),
      (_, i) => i + 1
    );

  const expenseMap = new Map();
  const allOrderedItems = [];
  const allPhoneNumbers = new Set();

  snapShot
    .forEach(doc => {
      const statusObject = doc.get('statusObject');
      const phoneNumber = doc.id;

      allPhoneNumbers
        .add(phoneNumber);

      allDates
        .forEach(date => {
          const item = statusObject[date] || {};
          const reimbursements = item.reimbursements || [];

          reimbursements
            .forEach(reimbursement => {
              const ri = Object.assign({}, reimbursement, {
                date,
                month: doc.get('month'),
                year: doc.get('year'),
              });

              if (ri.template) {
                allExpeneTypes
                  .add(ri.template);
              }

              const old = expenseMap.get(phoneNumber) || {};

              old[ri.template] = old[ri.template] || 0;

              if (ri.status !== 'CANCELLED') {
                old[ri.template] += Number(ri.amount);
              }

              expenseMap
                .set(phoneNumber, old);

              allOrderedItems
                .push(ri);
            });
        });
    });

  console.log('allExpeneTypes', allExpeneTypes.size);

  allExpeneTypes = [...allExpeneTypes.keys()];

  [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    ...allExpeneTypes,
  ].forEach((value, index) => {
    expenseSummarySheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value);
  });

  let summarySheetIndex = 0;

  allPhoneNumbers.forEach(phoneNumber => {
    const values = [
      getFieldValue(locals.employeesData, phoneNumber, 'Name'),
      phoneNumber,
      getFieldValue(locals.employeesData, phoneNumber, 'Employee Code'),
      getFieldValue(locals.employeesData, phoneNumber, 'Base Location'),
      getFieldValue(locals.employeesData, phoneNumber, 'Region'),
      getFieldValue(locals.employeesData, phoneNumber, 'Department')
    ];

    const expensesForUser = expenseMap
      .get(phoneNumber) || {};

    allExpeneTypes
      .forEach(template => {
        const amount = expensesForUser[template] || 0;

        values
          .push(amount);
      });

    values
      .forEach((value, innerIndex) => {
        expenseSummarySheet
          .cell(`${alphabetsArray[innerIndex]}${summarySheetIndex + 2}`)
          .value(value);
      });

    summarySheetIndex++;
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
