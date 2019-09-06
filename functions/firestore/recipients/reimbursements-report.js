'use strict';

const {
  dateFormats,
  httpsActions,
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

  const [
    snapShot,
    workbook,
  ] = await Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('action', '==', httpsActions.checkIn)
        .where('date', '==', mmomentYesterday.date())
        .where('month', '==', mmomentYesterday.month())
        .where('year', '==', mmomentYesterday.year())
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ]);

  const reimbursementSheet = workbook
    .addSheet(`Reimbursement ${momentToday.format(dateFormats.DATE)}`);
  reimbursementSheet
    .row(0)
    .style('bold', true);

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
      .cell(`${alphabetsArray[index]}`)
      .value(value);
  });

  snapShot
    .docs
    .forEach((doc, index) => {
      const columnIndex = index + 2;
      const phoneNumber = doc.get('user');
      const name = getName(locals.employeesData, phoneNumber);
      const createTime = momentTz(doc.createTime.toDate())
        .tz(timezone)
        .format(dateFormats.DATE_TIME);
      const photoUrl = doc.get('attachment.Photo Url.value');

      const type = (() => {
        const template = doc.get('activityData.template');

        if (template === 'km allowance'
          || template === 'daily allowance') {
          return template;
        }

        return doc.get('attachment.Claim Type.value');
      })();

      reimbursementSheet
        .cell(`A${columnIndex}`)
        .value(name); // employee name
      reimbursementSheet
        .cell(`B${columnIndex}`)
        .value(type); // claim type // 'km allowance' || 'daily allowance'
      reimbursementSheet
        .cell(`C${columnIndex}`)
        .value(doc.get('attachment.Amount.value')); // amount
      reimbursementSheet
        .cell(`D${columnIndex}`)
        .value(doc.get('attachment.Details.value')); // details

      if (phoneNumber) {
        reimbursementSheet
          .cell(`E${columnIndex}`)
          .value(photoUrl)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(doc.get('activityData.attachment.Photo.value'));
      } else {
        reimbursementSheet
          .cell(`E${columnIndex}`)
          .value('');
      }

      reimbursementSheet
        .cell(`F${columnIndex}`)
        .value(createTime);
      reimbursementSheet
        .cell(`G${columnIndex}`)
        .value(doc.get('activityData.status'));
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

  await locals
    .sgMail
    .sendMultiple(locals.messageObject);
};
