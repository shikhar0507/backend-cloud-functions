'use strict';

const {
  dateFormats,
  subcollectionNames,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const {
  getName,
  alphabetsArray,
  toMapsUrl,
  getFieldValue,
} = require('./report-utils');
const {
  getNumbersbetween,
} = require('../../admin/utils');
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
  const workbook = await xlsxPopulate
    .fromBlankAsync();
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

  let allExpenseTypes = new Set();
  const reimbursementDocPromises = [];
  const momentPrevMonth = momentToday
    .clone()
    .subtract(1, 'month');
  const firstDayOfReimbursementCycle = locals
    .officeDoc
    .get('attachment.First Day Of Reimbursement Cycle.value') || 1;
  const fetchPreviousMonthDocs = firstDayOfReimbursementCycle > momentYesterday.date();

  const firstRange = (() => {
    if (fetchPreviousMonthDocs) {
      return getNumbersbetween(
        firstDayOfReimbursementCycle,
        momentYesterday.clone().endOf('month').date() + 1,
      );
    }

    return [];
  })();
  const secondRange = getNumbersbetween(
    firstDayOfReimbursementCycle,
    momentYesterday.clone().date() + 1,
  );

  console.log('r1 fetching');
  const r1 = await locals
    .officeDoc
    .ref
    .collection(subcollectionNames.REIMBURSEMENTS)
    .doc(momentYesterday.format(dateFormats.MONTH_YEAR))
    .listCollections();

  console.log('r1 fetched');

  r1
    .forEach(colRef => {
      secondRange.forEach(date => {
        const promise = colRef
          .doc(`${date}`)
          .get();

        reimbursementDocPromises
          .push(promise);
      });
    });

  if (fetchPreviousMonthDocs) {
    console.log('r2 fetching');
    const r2 = await locals
      .officeDoc
      .ref
      .collection(subcollectionNames.REIMBURSEMENTS)
      .doc(momentPrevMonth.format(dateFormats.MONTH_YEAR))
      .listCollections();

    console.log('r2 fetched');

    r2
      .forEach(colRef => {
        firstRange.forEach(date => {
          const promise = colRef
            .orderBy('date')
            .doc(`${date}`)
            .get();

          reimbursementDocPromises
            .push(promise);
        });
      });
  }

  console.log('fetching reimbursementSnapshots');

  const reimbursementSnapshots = await Promise
    .all(reimbursementDocPromises);

  console.log('reimbursementSnapshots fetched');

  const expenseMap = new Map();
  const allPhoneNumbers = new Set();
  let reSheetIndex = 0;

  reimbursementSnapshots
    .forEach(doc => {
      const phoneNumber = doc.get('phoneNumber');
      const date = doc.get('date');
      const month = doc.get('month');
      const year = doc.get('year');
      const reimbursements = doc.get('reimbursements') || [];

      if (phoneNumber) {
        allPhoneNumbers
          .add(phoneNumber);
      }

      reimbursements.forEach(re => {
        const old = expenseMap
          .get(phoneNumber) || {};

        allExpenseTypes
          .add(re.template);

        old[
          re.template
        ] = old[re.template] || 0;

        if (re.status !== 'CANCELLED') {
          old[
            re.template
          ] += Number(re.amount);
        }

        expenseMap
          .set(phoneNumber, old);

        expenseSheet
          .cell(`A${reSheetIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Name'));
        expenseSheet
          .cell(`B${reSheetIndex + 2}`)
          .value(phoneNumber);
        expenseSheet
          .cell(`C${reSheetIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Employee Code'));
        expenseSheet
          .cell(`D${reSheetIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Base Location'));
        expenseSheet
          .cell(`E${reSheetIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Region'));
        expenseSheet
          .cell(`F${reSheetIndex + 2}`)
          .value(getFieldValue(locals.employeesData, phoneNumber, 'Department'));
        expenseSheet
          .cell(`G${reSheetIndex + 2}`)
          .value(momentTz().date(date).month(month).year(year).format(dateFormats.DATE));

        const localOrTravel = (() => {
          if (re.isTravel) {
            return 'Travel';
          }

          return 'Local';
        })();

        expenseSheet
          .cell(`H${reSheetIndex + 2}`)
          .value(localOrTravel);
        expenseSheet
          .cell(`I${reSheetIndex + 2}`)
          .value(re.name || re.claimType || '');
        expenseSheet
          .cell(`J${reSheetIndex + 2}`)
          .value(re.amount);

        if (re.template === 'km allowance') {
          expenseSheet
            .cell(`K${reSheetIndex + 2}`)
            .value(re.amount); // claim details
        }

        if (re.template === 'daily allowance'
          && re.geopoint) {
          expenseSheet
            .cell(`K${reSheetIndex + 2}`)
            .value(momentTz(re.timestamp).tz(timezone).format(dateFormats.DATE_TIME)) // claim details
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(toMapsUrl(re.geopoint));
        }

        if (re.template === 'claim'
          && re.photoURL) {
          expenseSheet
            .cell(`K${reSheetIndex + 2}`)
            .value(`${re.amount} ${re.claimType || ''}`)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(re.photoURL || ''); // claim details
        } else {
          expenseSheet
            .cell(`K${reSheetIndex + 2}`)
            .value(`${re.claimType || ''}`);
        }

        const approvalDetails = (() => {
          if (re.template === 'claim') {
            if (re.confirmedBy) {
              return `${re.status},`
                + ` ${getName(locals.employeesData, re.confirmedBy)},`
                + ` ${momentTz(re.approvalTimestamp).tz(timezone).format(dateFormats.DATE_TIME)}`;
            }

            return `${re.status}`;
          }

          return `NA`;
        })();

        expenseSheet
          .cell(`L${reSheetIndex + 2}`)
          .value(approvalDetails); // approval details

        reSheetIndex++;
      });
    });

  allExpenseTypes = [...allExpenseTypes.keys()];

  [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    ...allExpenseTypes,
  ].forEach((value, index) => {
    expenseSummarySheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value);
  });

  let summarySheetIndex = 0;

  if (allPhoneNumbers.size === 0) {
    return;
  }

  allPhoneNumbers
    .forEach(phoneNumber => {
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

      allExpenseTypes
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

  locals
    .messageObject
    .attachments
    .push({
      fileName: `Reimbursements Report_`
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
