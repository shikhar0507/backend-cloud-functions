const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const {
  rootCollections,
} = require('../../admin/admin');
const {
  dateFormats,
  subcollectionNames
} = require('../../admin/constants');
const {
  getNumbersbetween,
} = require('../../admin/utils');
const {
  toMapsUrl,
  alphabetsArray,
} = require('./report-utils');

const getSheets = async (date = '') => {
  const worksheetRef = await xlsxPopulate.fromBlankAsync();
  const summarySheet = worksheetRef.addSheet('Summary');
  const dataSheet = worksheetRef.addSheet(`Reimbursements ${date}`);

  summarySheet.row(1).style('bold', true);
  dataSheet.row(1).style('bold', true);
  worksheetRef.deleteSheet('Sheet1');

  [
    'Name',
    'Phone Number',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    'Date',
    'Amount'
  ].forEach((value, index) => {
    summarySheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value);
  });

  [
    'Name',
    'Phone Number',
    'Employee Code',
    'Base Location',
    'Region',
    'Department',
    'Date',
    'Reimbursement Type', // claim, daily allowance or km allowance
    'Reimbursement Name', // daily allowance name
    'Approval Details', // claim's status change log
    'Start Location',
    'End Location',
    'Amount',
    'Distance Travelled',
  ].forEach((value, index) => {
    dataSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(value);
  });

  return {
    dataSheet,
    summarySheet,
    worksheetRef,
  };
};

const getReimbursementPromises = ({
  dates,
  month,
  year,
  officeId
}) => {
  const result = [];

  dates.forEach(date => {
    result.push(
      rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.REIMBURSEMENTS)
      .where('date', '==', date)
      .where('month', '==', month)
      .where('year', '==', year)
      .get()
    );
  });

  return result;
};

const getApprovalDetails = ({
  cancelledBy,
  cancellationTimestamp,
  confirmedBy,
  confirmationTimestamp,
  timezone,
}) => {
  let result = '';

  if (cancelledBy) {
    result += `${cancelledBy} cancelled claim at` +
      ` ${momentTz(cancellationTimestamp).tz(timezone).format(dateFormats.DATE_TIME)}. `;
  }

  if (confirmedBy) {
    result += `${confirmedBy} confirmed claim at` +
      ` ${momentTz(confirmationTimestamp).tz(timezone).format(dateFormats.DATE_TIME)}. `;
  }

  return result.trim();
};

const reimbursementsReport = async locals => {
  const timestampFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentToday = momentTz(timestampFromTimer).tz(timezone);
  const momentYesterday = momentToday.clone().subtract(1, 'day');
  const momentPrevMonth = momentYesterday.clone().subtract(1, 'month');
  const firstDayOfReimbursementsCycle = locals.officeDoc.get('attachment.First Day Of Reimbursement Cycle.value') || 1;
  const fetchPreviousMonthDocs = firstDayOfReimbursementsCycle > momentYesterday.date();

  const firstRange = (() => {
    if (fetchPreviousMonthDocs) {
      return getNumbersbetween(
        firstDayOfReimbursementsCycle,
        momentPrevMonth.clone().endOf('month').date() + 1,
      );
    }

    return [];
  })();
  const secondRange = getNumbersbetween(
    (fetchPreviousMonthDocs ? 1 : firstDayOfReimbursementsCycle),
    momentYesterday.clone().date() + 1,
  );

  console.log('firstDayOfReimbursementsCycle', firstDayOfReimbursementsCycle);
  console.log('firstRange', firstRange);
  console.log('secondRange', secondRange);

  const p1 = getReimbursementPromises({
    dates: firstRange,
    month: momentPrevMonth.month(),
    year: momentPrevMonth.year(),
    officeId: locals.officeDoc.id,
  });

  const p2 = getReimbursementPromises({
    dates: secondRange,
    month: momentYesterday.month(),
    year: momentYesterday.year(),
    officeId: locals.officeDoc.id,
  });

  const [sheetsResult, reimbursementSnaps] = await Promise.all([
    getSheets(momentToday.format(dateFormats.DATE)),
    Promise.all([...p1, ...p2])
  ]);

  const {
    dataSheet,
    summarySheet,
    worksheetRef,
  } = sheetsResult;

  let rowCounter = 2;

  const detailsMap = new Map();
  const totalAmountByDate = new Map();

  reimbursementSnaps.forEach(snap => {
    snap.forEach(doc => {
      const {
        date,
        month,
        year,
        employeeName,
        phoneNumber,
        employeeCode,
        baseLocation,
        region,
        department,
        reimbursementType,
        reimbursementName,
        // claim approval detail fields
        cancelledBy,
        cancellationTimestamp,
        confirmedBy,
        confirmationTimestamp,
        // claim approval detail fields
        currentGeopoint,
        currentIdentifier,
        previousGeopoint,
        previousIdentifier,
        amount,
        currency,
        distance,
      } = doc.data();
      const isKmAllowance = reimbursementType === 'km allowance';
      const formattedDate = momentTz().date(date).month(month).year(year).format(dateFormats.DATE);
      const approvalDetails = getApprovalDetails({
        cancelledBy,
        cancellationTimestamp,
        confirmedBy,
        confirmationTimestamp,
        timezone,
      });

      const idx = `${phoneNumber}__${formattedDate}`;
      const oldAmount = totalAmountByDate.get(idx) || 0;

      totalAmountByDate.set(
        `${phoneNumber}__${formattedDate}`,
        oldAmount + Number(amount)
      );

      detailsMap.set(phoneNumber, {
        // formattedDate,
        employeeName,
        employeeCode,
        baseLocation,
        region,
        department,
      });

      // 'Name',
      // 'Phone Number',
      // 'Employee Code',
      // 'Base Location',
      // 'Region',
      // 'Department',
      // 'Date',
      // 'Reimbursement Type', // claim, daily allowance or km allowance
      // 'Reimbursement Name', // daily allowance name
      // 'Approval Details', // claim's status change log
      // 'Start Location',
      // 'End Location',

      dataSheet.cell(`A${rowCounter}`).value(employeeName);
      dataSheet.cell(`B${rowCounter}`).value(phoneNumber);
      dataSheet.cell(`C${rowCounter}`).value(employeeCode);
      dataSheet.cell(`D${rowCounter}`).value(baseLocation);
      dataSheet.cell(`E${rowCounter}`).value(region);
      dataSheet.cell(`F${rowCounter}`).value(department);
      dataSheet.cell(`G${rowCounter}`).value(formattedDate);
      dataSheet.cell(`H${rowCounter}`).value(reimbursementType);
      dataSheet.cell(`I${rowCounter}`).value(reimbursementName);
      dataSheet.cell(`J${rowCounter}`).value(approvalDetails);

      if (previousIdentifier && isKmAllowance) {
        const url = toMapsUrl(previousGeopoint);
        dataSheet.cell(`K${rowCounter}`).value(previousIdentifier).style({
            fontColor: '0563C1',
            underline: true
          })
          .hyperlink(url);
      } else {
        dataSheet.cell(`K${rowCounter}`).value('');
      }

      if (currentIdentifier && isKmAllowance) {
        const url = toMapsUrl(currentGeopoint);
        dataSheet.cell(`L${rowCounter}`).value(currentIdentifier).style({
            fontColor: '0563C1',
            underline: true
          })
          .hyperlink(url);
      } else {
        dataSheet.cell(`L${rowCounter}`).value('');
      }

      dataSheet.cell(`M${rowCounter}`).value(`${amount} ${currency}`);
      dataSheet.cell(`N${rowCounter}`).value(distance || '');

      rowCounter++;
    });
  });

  let summarySheetCounter = 2;
  totalAmountByDate.forEach((amount, key) => {
    const [phoneNumber, dateString] = key.split('__');
    const {
      employeeName,
      employeeCode,
      baseLocation,
      region,
      department,
    } = detailsMap.get(phoneNumber) || {};
    // 'Name',
    // 'Phone Number',
    // 'Employee Code',
    // 'Base Location',
    // 'Region',
    // 'Department',
    // 'Date',
    // 'Amount'

    summarySheet.cell(`A${summarySheetCounter}`).value(employeeName);
    summarySheet.cell(`B${summarySheetCounter}`).value(phoneNumber);
    summarySheet.cell(`C${summarySheetCounter}`).value(employeeCode);
    summarySheet.cell(`D${summarySheetCounter}`).value(baseLocation);
    summarySheet.cell(`E${summarySheetCounter}`).value(region);
    summarySheet.cell(`F${summarySheetCounter}`).value(department);
    summarySheet.cell(`G${summarySheetCounter}`).value(dateString);
    summarySheet.cell(`H${summarySheetCounter}`).value(amount);

    summarySheetCounter++;
  });

  await worksheetRef.toFileAsync('/tmp/stuff.xlsx');

  locals.messageObject.attachments.push({
    fileName: `Reimbursements Report_` +
      `${locals.officeDoc.get('office')}` +
      `_${momentToday.format(dateFormats.DATE)}.xlsx`,
    content: await worksheetRef.outputAsync('base64'),
    type: 'text/csv',
    disposition: 'attachment',
  });

  return locals.sgMail.sendMultiple(locals.messageObject);
};

module.exports = async locals => {
  try {
    return reimbursementsReport(locals);
  } catch (error) {
    console.error(error);

    return;
  }
};
