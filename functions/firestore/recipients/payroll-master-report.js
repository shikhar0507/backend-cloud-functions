'use strict';

const xlsxPopulate = require('xlsx-populate');
const {
  dateFormats,
} = require('../../admin/constants');
const {
  alphabetsArray,
} = require('./report-utils');
const momentTz = require('moment-timezone');

module.exports = async locals => {
  const timestampFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentToday = momentTz(timestampFromTimer).tz(timezone);

  const [
    workbook,
  ] = await Promise
    .all([
      xlsxPopulate
        .fromBlankAsync(),
    ]);

  // office(first day of monthly cycle 33), branch, leave-types, employee
  const officeSheet = workbook
    .addSheet('Offices');
  const branchesSheet = workbook
    .addSheet('Branches');
  const employeesSheet = workbook
    .addSheet('Employees');
  const leaveTypeSheet = workbook
    .addSheet('Leave Types');
  const regionsSheet = workbook
    .addSheet('Regions');

  officeSheet
    .row(0
    ).style('bold', true);
  branchesSheet
    .row(0)
    .style('bold', true);
  employeesSheet
    .row(0)
    .style('bold', true);
  leaveTypeSheet
    .row(0)
    .style('bold', true);

  workbook
    .deleteSheet('Sheet1');

  [
    'First Day Of Monthly Cycle',
    'Status',
  ].forEach((field, index) => {
    officeSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(field);
  });

  officeSheet
    .cell(`A2`)
    .value(locals.officeDoc.get('attachment.First Day Of Monthly Cycle.value') || 1);
  officeSheet
    .cell(`B2`)
    .value(locals.officeDoc.get('status'));

  [
    'Name',
    'Employee Contact',
    'Designation',
    'Department',
    'Base Location',
    'First Supervisor',
    'Second Supervisor',
    'Third Supervisor',
    'Daily Start Time',
    'Daily End Time',
    'Minimum Working Hours',
    'Minimum Daily Activity Count',
    'Monthly Off Days',
    'Employee Based In Customer Location',
    'Location Validation Check',
    'Task Specialization',
    'Product Specialization',
    'Maximum Advance Amount Given',
    'Employee Code',
  ].forEach((field, index) => {
    employeesSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(field);
  });

  const employeePhoneNumbers = Object.keys(locals.employeesData);
  const regionsSet = new Set();
  const branchMap = {};

  employeePhoneNumbers
    .forEach((phoneNumber, outerIndex) => {
      [
        locals.employeesData[phoneNumber].Name,
        locals.employeesData[phoneNumber]['Employee Contact'],
        locals.employeesData[phoneNumber].Designation,
        locals.employeesData[phoneNumber].Department,
        locals.employeesData[phoneNumber]['Base Location'],
        locals.employeesData[phoneNumber]['First Supervisor'],
        locals.employeesData[phoneNumber]['Second Supervisor'],
        locals.employeesData[phoneNumber]['Third Supervisor'],
        locals.employeesData[phoneNumber]['Daily Start Time'],
        locals.employeesData[phoneNumber]['Daily End Time'],
        locals.employeesData[phoneNumber]['Minimum Working Hours'],
        locals.employeesData[phoneNumber]['Minimum Daily Activity Count'],
        locals.employeesData[phoneNumber]['Monthly Off Days'],
        locals.employeesData[phoneNumber]['Employee Based In Customer Location'],
        locals.employeesData[phoneNumber]['Location Validation Check'],
        locals.employeesData[phoneNumber]['Task Specialization'],
        locals.employeesData[phoneNumber]['Product Specialization'],
        locals.employeesData[phoneNumber]['Maximum Advance Amount Given'],
        locals.employeesData[phoneNumber]['Employee Code'],
      ].forEach((value, innerIndex) => {
        employeesSheet
          .cell(`${alphabetsArray[innerIndex]}${outerIndex + 2}`)
          .value(value);
      });

      const region = locals.employeesData[phoneNumber].Region;

      if (region) {
        regionsSet.add(region);
      }

      const branch = locals.employeesData[phoneNumber]['Base Location'];

      if (branch) {
        branchMap[branch] = branchMap[branch] || {};

        branchMap[
          branch
        ]['Weekly Off'] = locals.employeesData[phoneNumber]['Weekly Off'];

        locals
          .employeesData[
          phoneNumber
        ].branchHolidays = locals.employeesData[phoneNumber].branchHolidays || [];

        branchMap[
          branch
        ]['Holiday 1'] = locals.employeesData[phoneNumber].branchHolidays[0];

        branchMap[
          branch
        ]['Holiday 2'] = locals.employeesData[phoneNumber].branchHolidays[1];

        branchMap[
          branch
        ]['Holiday 3'] = locals.employeesData[phoneNumber].branchHolidays[2];

        branchMap[
          branch
        ]['Holiday 4'] = locals.employeesData[phoneNumber].branchHolidays[3];

        branchMap[
          branch
        ]['Holiday 5'] = locals.employeesData[phoneNumber].branchHolidays[4];

        branchMap[
          branch
        ]['Holiday 6'] = locals.employeesData[phoneNumber].branchHolidays[5];

        branchMap[
          branch
        ]['Holiday 7'] = locals.employeesData[phoneNumber].branchHolidays[6];

        branchMap[
          branch
        ]['Holiday 8'] = locals.employeesData[phoneNumber].branchHolidays[7];

        branchMap[
          branch
        ]['Holiday 9'] = locals.employeesData[phoneNumber].branchHolidays[8];

        branchMap[
          branch
        ]['Holiday 10'] = locals.employeesData[phoneNumber].branchHolidays[9];

        branchMap[
          branch
        ]['Holiday 11'] = locals.employeesData[phoneNumber].branchHolidays[10];

        branchMap[
          branch
        ]['Holiday 12'] = locals.employeesData[phoneNumber].branchHolidays[11];

        branchMap[
          branch
        ]['Holiday 13'] = locals.employeesData[phoneNumber].branchHolidays[12];

        branchMap[
          branch
        ]['Holiday 14'] = locals.employeesData[phoneNumber].branchHolidays[13];

        branchMap[
          branch
        ]['Holiday 15'] = locals.employeesData[phoneNumber].branchHolidays[14];
      }
    });

  [
    'Name',
    'Branch Office',
    'Holiday 1',
    'Holiday 2',
    'Holiday 3',
    'Holiday 4',
    'Holiday 5',
    'Holiday 6',
    'Holiday 7',
    'Holiday 8',
    'Holiday 9',
    'Holiday 10',
    'Holiday 11',
    'Holiday 12',
    'Holiday 13',
    'Holiday 14',
    'Holiday 15',
    'First Contact',
    'Second Contact',
    'Branch Code',
    'Weekday Start Time',
    'Weekday End Time',
    'Saturday Start Time',
    'Saturday End Time',
    'Weekly Off',
  ].forEach((field, index) => {
    branchesSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(field);
  });

  [
    'Name',
  ].forEach((field, index) => {
    regionsSheet
      .cell(`A${index + 1}`)
      .value(field);
  });

  [
    ...regionsSet.keys(),
  ].forEach((region, index) => {
    regionsSheet
      .cell(`A${index + 2}`)
      .value(region);
  });

  Object
    .keys(branchMap)
    .forEach((name, outerIndex) => {
      const branchObject = branchMap[name];

      [
        name,
        branchObject['Branch Office'],
        branchObject['Holiday 1'],
        branchObject['Holiday 2'],
        branchObject['Holiday 3'],
        branchObject['Holiday 4'],
        branchObject['Holiday 5'],
        branchObject['Holiday 6'],
        branchObject['Holiday 7'],
        branchObject['Holiday 8'],
        branchObject['Holiday 9'],
        branchObject['Holiday 10'],
        branchObject['Holiday 11'],
        branchObject['Holiday 12'],
        branchObject['Holiday 13'],
        branchObject['Holiday 14'],
        branchObject['Holiday 15'],
        branchObject['First Contact'],
        branchObject['Second Contact'],
        branchObject['Branch Code'],
        branchObject['Weekday Start Time'],
        branchObject['Weekday End Time'],
        branchObject['Saturday Start Time'],
        branchObject['Saturday End Time'],
        branchObject['Weekly Off'],
      ].forEach((field, innerIndex) => {
        branchesSheet
          .cell(`${alphabetsArray[innerIndex]}${outerIndex + 2}`)
          .value(field);
      });
    });

  const leaveTypes = await locals
    .officeDoc
    .ref
    .collection('Activities')
    .where('template', '==', 'leave-type')
    .get();

  [
    'Name',
    'Annual Limit',
    'Status',
  ].forEach((field, index) => {
    leaveTypeSheet
      .cell(`${alphabetsArray[index]}1`)
      .value(field);
  });

  leaveTypes
    .docs
    .forEach((doc, index) => {
      const name = doc.get('attachment.Name.value');
      const annualLimit = doc.get('attachment.Annual Limit.value');
      const status = doc.get('status');

      leaveTypeSheet
        .cell(`A${index + 2}`)
        .value(name);

      leaveTypeSheet
        .cell(`B${index + 2}`)
        .value(annualLimit);

      leaveTypeSheet
        .cell(`C${index + 2}`)
        .value(status);
    });

  locals
    .messageObject
    .attachments
    .push({
      fileName: `Payroll Master Report_`
        + `${locals.officeDoc.get('office')}`
        + `_${momentToday.format(dateFormats.DATE)}.xlsx`,
      content: await workbook.outputAsync('base64'),
      type: 'text/csv',
      disposition: 'attachment',
    });

  return locals
    .sgMail
    .sendMultiple(locals.messageObject);
};
