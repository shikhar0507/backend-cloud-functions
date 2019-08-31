'use strict';

const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const {
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  getName,
  alphabetsArray,
} = require('./report-utils');


module.exports = async locals => {
  const timestampFromTimer = locals
    .change
    .after
    .get('timestamp');
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const momentFromTimer = momentTz(timestampFromTimer)
    .tz(timezone);
  const timestampMinus24Hours = momentFromTimer
    .clone()
    .startOf('day')
    .subtract(24, 'hours');
  const timestampPlus24Hours = momentFromTimer
    .clone()
    .endOf('day')
    .add(24, 'hours');
  const monthYearString = momentFromTimer
    .format(dateFormats.MONTH_YEAR);
  let numberOfEntries = 0;

  try {
    const [
      activities,
      workbook
    ] = await Promise
      .all([
        locals
          .officeDoc
          .ref
          .collection('Activities')
          .where('relevantTime', '>=', timestampMinus24Hours.valueOf())
          .where('relevantTime', '<=', timestampPlus24Hours.valueOf())
          .orderBy('relevantTime', 'desc')
          .get(),
        xlsxPopulate
          .fromBlankAsync(),
      ]);

    if (activities.empty) {
      return;
    }

    const worksheet = workbook
      .addSheet(`Schedule ${monthYearString}`);
    workbook
      .deleteSheet('Sheet1');

    worksheet
      .row(1)
      .style('bold', true);

    [
      'Activity Name',
      'Activity - Type',
      'Customer Name',
      'Customer Code',
      'Customer Address',
      'Schedule',
      'Created By',
      'Supervisor',
      'Status',
      'Last Updated On',
      'Check-In Times'
    ].forEach((field, index) => {
      worksheet
        .cell(`${alphabetsArray[index]}1`)
        .value(field);
    });

    let index = 0;

    activities
      .forEach(doc => {
        if (doc.get('template') !== 'duty') {
          return;
        }

        numberOfEntries++;

        const columnIndex = index + 2;
        const activityName = doc.get('activityName');
        // This is duty type
        const activityType = doc.get('attachment.Duty Type.value');
        // const customerName = doc.get('attachment.Customer.value');
        const schedule = doc.get('schedule')[0];
        const status = doc.get('status');
        const startTime = momentTz(schedule.startTime)
          .format(dateFormats.DATE_TIME);
        const endTime = momentTz(schedule.endTime)
          .format(dateFormats.DATE_TIME);
        const createdBy = doc.get('creator.displayName')
          || doc.get('creator.phoneNumber');
        const lastUpdatedOn = momentTz(doc.get('timestamp'))
          .format(dateFormats.DATE_TIME);
        const checkIns = doc.get('checkIns') || {};
        let checkInTimes = '';

        Object
          .keys(checkIns)
          .forEach(phoneNumber => {
            const timestamps = checkIns[phoneNumber]; // Array of ts
            const name = getName(locals.employeesData, phoneNumber);
            const firstCheckInFormatted = momentTz(timestamps[0])
              .tz(timezone)
              .format(dateFormats.DATE_TIME);
            const lastCheckInFormatted = momentTz(timestamps[timestamps.length - 1])
              .tz(timezone)
              .format(dateFormats.DATE_TIME);

            checkInTimes += `${name} (${firstCheckInFormatted}`
              + ` to ${lastCheckInFormatted}, ${timestamps.length})`;

            checkInTimes += '\n';
          });

        const customerName = doc
          .get('customerObject.Name');
        const customerCode = doc
          .get('customerObject.Customer Code');
        const customerAddress = doc
          .get('customerObject.address');
        const supervisors = getName(
          locals.employeesData,
          doc.get('attachment.Supervisor.value')
        );

        worksheet
          .cell(`A${columnIndex}`)
          .value(activityName);
        worksheet
          .cell(`B${columnIndex}`)
          .value(activityType);
        worksheet
          .cell(`C${columnIndex}`)
          .value(customerName);
        worksheet
          .cell(`D${columnIndex}`)
          .value(customerCode);
        worksheet
          .cell(`E${columnIndex}`)
          .value(customerAddress);
        worksheet
          .cell(`F${columnIndex}`)
          .value(`${startTime} - ${endTime}`);
        worksheet
          .cell(`G${columnIndex}`)
          .value(createdBy);
        worksheet
          .cell(`H${columnIndex}`)
          .value(supervisors);
        worksheet
          .cell(`I${columnIndex}`)
          .value(status);
        worksheet
          .cell(`J${columnIndex}`)
          .value(lastUpdatedOn);
        worksheet
          .cell(`K${columnIndex}`)
          .value(checkInTimes);

        index++;
      });

    if (numberOfEntries === 0) {
      return;
    }

    locals
      .messageObject
      .attachments
      .push({
        fileName: `Monthly Schedule Report_`
          + `${locals.officeDoc.get('office')}`
          + `_${momentFromTimer.format(dateFormats.DATE)}.xlsx`,
        content: await workbook.outputAsync('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

    console.log(JSON.stringify({
      office: locals.officeDoc.get('office'),
      report: reportNames.PAYROLL,
      to: locals.messageObject.to,
    }, ' ', 2));

    return locals
      .sgMail
      .sendMultiple(locals.messageObject);
  } catch (error) {
    console.error(error);
  }
};
