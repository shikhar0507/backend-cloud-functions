'use strict';

const {
  dateFormats,
  subcollectionNames,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const {
  alphabetsArray,
  toMapsUrl,
} = require('./report-utils');
const env = require('../../admin/env');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(env.sgMailApiKey);


module.exports = async locals => {
  const timestamp = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  // const firstDayOfReimbursementsCycle = locals
  //   .officeDoc
  //   .get('attachment.First Day Of Reimbursements Cycle.value') || 1;
  const momentToday = momentTz(timestamp).tz(timezone);
  const items = new Map();
  const workbook = await xlsxPopulate.fromBlankAsync();
  let allExpenseTypes = new Set();
  const summarySheet = workbook
    .addSheet('Expense Summary');
  const expenseSheet = workbook
    .addSheet(`Expense ${momentToday.format(dateFormats.DATE)}`);
  const claimSummaryObject = {};

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
    'Claim Type',
    'Amount',
    'Claim Details',
    'Approval Details',
    'From Location',
    'To Location',
  ].forEach((field, index) => {
    expenseSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(field);
  });

  const reimbursementDocs = await locals
    .officeDoc
    .ref
    .collection(subcollectionNames.REIMBURSEMENTS)
    .where('timestamp', '>=', momentToday.clone().startOf('month').valueOf())
    .where('timestamp', '<=', momentToday.valueOf())
    .orderBy('timestamp', 'asc')
    .get();

  if (reimbursementDocs.empty) {
    console.log('no docs found');

    return;
  }

  reimbursementDocs
    .forEach(doc => {
      const phoneNumber = doc.get('phoneNumber');
      const old = items.get(phoneNumber) || [];

      old.push(doc);

      items
        .set(phoneNumber, old);
    });

  const allPhoneNumbers = new Map();
  let innerIndex = 0;
  const employeeDataMap = new Map();

  items.forEach((docs, phoneNumber) => {
    docs.forEach(doc => {
      const {
        date,
        month,
        year,
        amount,
        employeeName,
        region,
        employeeCode,
        baseLocation,
        department,
        confirmedBy,
        cancelledBy,
        startIdentifier,
        endIdentifier,
        // km allowance, daily allowance or claim name
        reimbursementType,
        template,
        // attachmentName, // renamed to reimbursementType
        // reimbursementType,
      } = doc.data();

      const formattedDate = momentTz()
        .date(date)
        .month(month)
        .year(year)
        .format(dateFormats.DATE);

      const claimKey = `${phoneNumber}-${formattedDate}-${reimbursementType || template}`;

      claimSummaryObject[
        claimKey
      ] = claimSummaryObject[claimKey] || {};

      claimSummaryObject[
        claimKey
      ][reimbursementType || template] = claimSummaryObject[claimKey][reimbursementType || template] || 0;

      claimSummaryObject[
        claimKey
      ][reimbursementType || template] += Number(amount);

      employeeDataMap
        .set(phoneNumber, {
          employeeName,
          employeeCode,
          baseLocation,
          region,
          department,
        });

      allExpenseTypes
        .add(reimbursementType || template);

      const key = `${phoneNumber}` +
        `__${formattedDate}` +
        `__${reimbursementType}`;

      allPhoneNumbers.set(key, {
        employeeName,
        employeeCode,
        baseLocation,
        region,
        department,
        date: formattedDate,
      });

      const claimDetails = (() => {
        if (reimbursementType === 'claim' && confirmedBy) {
          return `Confirmed by: ${confirmedBy}`;
        }

        if (reimbursementType === 'claim' && cancelledBy) {
          return `Cancelled by: ${cancelledBy}`;
        }

        return reimbursementType;
      })();
      const approvalDetails = '';
      const fromLocation = startIdentifier;
      const toLocation = endIdentifier;

      expenseSheet
        .cell(`A${innerIndex + 2}`)
        .value(employeeName);
      expenseSheet
        .cell(`B${innerIndex + 2}`)
        .value(phoneNumber);
      expenseSheet
        .cell(`C${innerIndex + 2}`)
        .value(employeeCode);
      expenseSheet
        .cell(`D${innerIndex + 2}`)
        .value(baseLocation);
      expenseSheet
        .cell(`E${innerIndex + 2}`)
        .value(region);
      expenseSheet
        .cell(`F${innerIndex + 2}`)
        .value(department);
      expenseSheet
        .cell(`G${innerIndex + 2}`)
        .value(formattedDate);
      expenseSheet
        .cell(`H${innerIndex + 2}`)
        .value(reimbursementType); // claim type
      expenseSheet
        .cell(`I${innerIndex + 2}`)
        .value(amount);
      expenseSheet
        .cell(`J${innerIndex + 2}`)
        .value(claimDetails);
      expenseSheet
        .cell(`K${innerIndex + 2}`)
        .value(approvalDetails);

      if (doc.get('startLocation')) {
        expenseSheet
          .cell(`L${innerIndex + 2}`)
          .value(fromLocation)
          .style({
            fontColor: '0563C1',
            underline: true
          })
          .hyperlink(toMapsUrl(doc.get('startLocation')));
      } else {
        expenseSheet
          .cell(`L${innerIndex + 2}`)
          .value(fromLocation);
      }

      if (doc.get('endLocation')) {
        expenseSheet
          .cell(`M${innerIndex + 2}`)
          .value(toLocation)
          .style({
            fontColor: '0563C1',
            underline: true
          })
          .hyperlink(toMapsUrl(doc.get('endLocation')));
      } else {
        expenseSheet
          .cell(`M${innerIndex + 2}`)
          .value(toLocation);
      }

      innerIndex++;
    });
  });

  allExpenseTypes = [...allExpenseTypes.values()]
    .filter(Boolean);

  const summarySheetHeaders = [
    'Employee Name',
    'Employee Contact',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    'Date',
    ...allExpenseTypes,
  ];

  summarySheetHeaders
    .forEach((field, index) => {
      summarySheet
        .cell(`${alphabetsArray[index]}1`)
        .value(field);
    });

  let summaryIndex = 0;

  allPhoneNumbers.forEach((object, key) => {
    const [
      phoneNumber,
      date,
      reimbursementType,
    ] = key.split('__');

    const fields = [
      object.employeeName,
      phoneNumber,
      object.employeeCode,
      object.baseLocation,
      object.region,
      object.department,
      date,
    ];

    const claimKey = `${phoneNumber}-${date}-${reimbursementType}`;
    const reimsForUser = claimSummaryObject[claimKey] || {};

    allExpenseTypes
      .forEach(expenseType => {
        const amount = reimsForUser[expenseType] || 0;

        fields.push(amount.toFixed(2));
      });

    fields
      .forEach((value, innerIndex) => {
        summarySheet
          .cell(`${alphabetsArray[innerIndex]}${summaryIndex + 2}`)
          .value(value);
      });

    summaryIndex++;
  });

  locals
    .messageObject
    .attachments
    .push({
      fileName: `Reimbursements Report_` +
        `${locals.officeDoc.get('office')}` +
        `_${momentToday.format(dateFormats.DATE)}.xlsx`,
      content: await workbook.outputAsync('base64'),
      type: 'text/csv',
      disposition: 'attachment',
    });

  console.log('locals.messageObject', locals.messageObject.to);

  return locals
    .sgMail
    .sendMultiple(locals.messageObject);
};
