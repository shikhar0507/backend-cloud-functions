'use strict';

const moment = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const {
  sendGridTemplateIds,
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  rootCollections,
} = require('../../admin/admin');
const {
  alphabetsArray,
  // momentDateObject,
  momentOffsetObject,
} = require('./report-utils');

const momentTz = require('moment-timezone');

module.exports = (locals) => {
  const office = locals.change.after.get('office');
  const standardDateString = moment().format(dateFormats.DATE);
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);

  locals.messageObject.templateId = sendGridTemplateIds.leave;
  locals.sendMail = true;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: standardDateString,
    subject: `Leave Report ${office}_${standardDateString}`,
  };

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.LEAVE)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        initDocsQuery,
        workbook,
      ] = result;

      if (initDocsQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      const timezone = locals.officeDoc.get('attachment.Timezone.value');
      const leaveObject = initDocsQuery.docs[0].get('leaveObject');
      const activityIdsArray = Object.keys(leaveObject);

      if (activityIdsArray.length === 0) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      const standardDateString =
        momentTz()
          .utc()
          .tz(timezone)
          .format(dateFormats.DATE);
      locals.fileName = `${office} Leave Report_${standardDateString}.xlsx`;
      locals.filePath = `/tmp/${locals.fileName}`;

      const sheet1 = workbook.addSheet('Leave');
      sheet1.row(1).style('bold', true);
      workbook.deleteSheet('Sheet1');

      const firstRowValues = [
        'Employee Name',
        'Employee Contact',
        'Annual Limit',
        'Total Leaves Taken',
        'Leave Dates',
        'Total Leaves Remaining',
        'Approved By',
        'Reason',
        'Department',
        'Base Location',
        'First Supervisor',
        'Second Supervisor',
      ];

      firstRowValues.forEach((header, index) => {
        sheet1
          .cell(`${alphabetsArray[index]}1`)
          .value(header);
      });

      const employeesData = locals.officeDoc.get('employeesData');

      activityIdsArray.forEach((activityId, index) => {
        const leaveData = leaveObject[activityId];
        const phoneNumber = leaveData.phoneNumber;
        const employeeName = employeesData[phoneNumber].Name;
        const employeeContact = phoneNumber;
        const annualLimit = leaveData.annualLeavesEntitled;
        const totalLeavesTaken = leaveData.totalLeavesTaken;
        const leaveDates = (() => {
          const leaveStartMoment =
            moment(leaveData.leaveStartTimestamp)
              .utc()
              .clone(timezone);
          const leaveEndMoment = moment(leaveData.leaveEndTimestamp)
            .utc()
            .clone(timezone);

          return `${leaveStartMoment.format(dateFormats.DATE)} `
            + `- ${leaveEndMoment.format(dateFormats.DATE)}`;
        })();

        const totalLeavesRemaining = leaveData.totalLeavesRemaining;
        const approvedBy = leaveData.approvedBy;
        const reason = leaveData.reason;
        const department = employeesData[phoneNumber].Department;
        const baseLocation = employeesData[phoneNumber]['Base Location'];
        const firstSupervisor = employeesData[phoneNumber]['First Supervisor'];
        const secondSupervisor = employeesData[phoneNumber]['Second Supervisor'];
        const columnIndex = index + 2;

        sheet1.cell(`A${columnIndex}`).value(employeeName);
        sheet1.cell(`B${columnIndex}`).value(employeeContact);
        sheet1.cell(`C${columnIndex}`).value(annualLimit);
        sheet1.cell(`D${columnIndex}`).value(totalLeavesTaken);
        sheet1.cell(`E${columnIndex}`).value(leaveDates);
        sheet1.cell(`F${columnIndex}`).value(totalLeavesRemaining);
        sheet1.cell(`G${columnIndex}`).value(approvedBy);
        sheet1.cell(`H${columnIndex}`).value(reason);
        sheet1.cell(`I${columnIndex}`).value(department);
        sheet1.cell(`J${columnIndex}`).value(baseLocation);
        sheet1.cell(`K${columnIndex}`).value(firstSupervisor);
        sheet1.cell(`L${columnIndex}`).value(secondSupervisor);
      });

      return workbook.toFileAsync(locals.filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      const fs = require('fs');

      locals.messageObject.attachments.push({
        fileName: locals.fileName,
        content: new Buffer(fs.readFileSync(locals.filePath)).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      console.log({
        report: locals.change.after.get('report'),
        to: locals.messageObject.to,
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
