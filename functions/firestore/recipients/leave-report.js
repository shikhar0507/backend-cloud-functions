'use strict';

const xlsxPopulate = require('xlsx-populate');
const {
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  rootCollections,
} = require('../../admin/admin');
const {
  alphabetsArray,
  employeeInfo,
  dateStringWithOffset,
  momentOffsetObject,
} = require('./report-utils');
const momentTz = require('moment-timezone');
const fs = require('fs');

module.exports = (locals) => {
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const yesterdayMoment = momentTz()
    .utc()
    .clone()
    .tz(timezone)
    .subtract(1, 'days');
  const momentDateObject = momentOffsetObject(timezone);
  const yesterdaysDate = momentDateObject.yesterday.DATE_NUMBER;
  const yesterdaysMonthEndDate = yesterdayMoment.endOf('months').date();

  // Not sending email until the last date of the month
  if (yesterdaysDate !== yesterdaysMonthEndDate) {
    console.log('Not sending emails. Not the last day of the month');

    return Promise.resolve();
  }

  const office = locals.officeDoc.get('office');
  const officeId = locals.officeDoc.id;
  const standardDateString =
    momentTz()
      .utc()
      .tz(timezone)
      .format(dateFormats.DATE);
  const fileName = `${office} Leave Report_${standardDateString}.xlsx`;
  const filePath = `/tmp/${locals.fileName}`;
  const employeesData = locals.officeDoc.get('employeesData');

  locals.messageObject['dynamic_template_data'] = {
    office,
    date: standardDateString,
    subject: `Leave Report ${office}_${standardDateString}`,
  };

  /** Map of Person who approved the leave */
  const approverMap = new Map();
  const leavesLimitMap = new Map();
  const activitiesRef = rootCollections
    .offices
    .doc(officeId)
    .collection('Activities');

  return Promise
    .all([
      activitiesRef
        .where('template', '==', reportNames.LEAVE)
        .where('creationMonth', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('creationYear', '==', momentDateObject.yesterday.YEAR)
        // Cancelled activities don't show up in the report
        .where('isCancelled', '==', false)
        .get(),
      rootCollections
        .inits
        .where('report', '==', reportNames.LEAVE)
        .where('office', '==', office)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .limit(1)
        .get(),
      activitiesRef
        .where('template', '==', 'leave-type')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        leaveActivitiesQuery,
        initDocsQuery,
        leaveTypeActivitiesQuery,
        workbook,
      ] = result;

      console.log({
        leaveActivitiesQuery: leaveTypeActivitiesQuery.empty,
        leaveTypeActivitiesQuery: leaveTypeActivitiesQuery.empty,
        initDocsQuery: initDocsQuery.empty,
      });

      if (leaveActivitiesQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      console.log('initDocsQuery', initDocsQuery.docs[0].id);

      const leaveObject = initDocsQuery.docs[0].get('leaveObject');

      Object.keys(leaveObject).forEach((activityId) => {
        const activityObject = leaveObject[activityId];
        const approversPhoneNumber = activityObject.approvedBy;
        const name = employeeInfo(employeesData, approversPhoneNumber).name;

        approverMap.set(activityId, name || approversPhoneNumber);
      });

      leaveTypeActivitiesQuery.forEach((doc) => {
        const name = doc.get('attachment.Name.value');
        const annualLimit = doc.get('attachment.Annual Limit.value');

        leavesLimitMap.set(name, Number(annualLimit));
      });

      const sheet1 = workbook.addSheet('Leave');
      sheet1.row(1).style('bold', true);
      workbook.deleteSheet('Sheet1');

      const firstRowValues = [
        'Employee Name',
        'Employee Contact',
        'Leave Type',
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

      leaveActivitiesQuery.docs.forEach((doc, index) => {
        const columnIndex = index + 2;
        const schedule = doc.get('schedule')[0];
        const employeeContact = doc.get('creator');
        const employeeData = employeeInfo(employeesData, employeeContact);
        const employeeName = employeeData.name || employeeContact;
        const leaveType = doc.get('attachment.Leave Type.value');
        const annualLimt = (() => {
          if (!leaveType) {
            return '';
          }

          return leavesLimitMap.get(leaveType) || '';
        })();

        const totalLeavesTaken = momentTz(schedule.endTime)
          .diff(momentTz(schedule.startTime), 'days');
        const leaveDates = (() => {
          const startTimeString = dateStringWithOffset({
            timezone,
            timestampToConvert: schedule.startTime,
          });
          const endTimeString = dateStringWithOffset({
            timezone,
            timestampToConvert: schedule.endTime,
          });

          return `${endTimeString} - ${startTimeString}`;
        })();

        const approvedBy = approverMap.get(doc.id);
        const reason = doc.get('attachment.Reason.value');
        const baseLocation = employeeData.baseLocation;
        const firstSupervisor = (() => {
          const phoneNumber = employeeData.firstSupervisor;

          return employeeInfo(employeesData, phoneNumber).name || phoneNumber;
        })();

        const secondSupervisor = (() => {
          const phoneNumber = employeeData.secondSupervisor;

          return employeeInfo(employeesData, phoneNumber).name || phoneNumber;
        })();

        const department = employeeData.department;
        const totalLeavesRemaining = (() => {
          if (!leaveType) return '';
          if (!annualLimt) return '';

          // Annual Limit is always larger. This, probably
          // is not necessary.
          return Math.abs(annualLimt - totalLeavesTaken);
        })();

        sheet1
          .cell(`A${columnIndex}`)
          .value(employeeName);
        sheet1
          .cell(`B${columnIndex}`)
          .value(employeeContact);
        sheet1
          .cell(`C${columnIndex}`)
          .value(leaveType);
        sheet1
          .cell(`D${columnIndex}`)
          .value(annualLimt);
        sheet1
          .cell(`E${columnIndex}`)
          .value(totalLeavesTaken);
        sheet1
          .cell(`F${columnIndex}`)
          .value(leaveDates);
        sheet1
          .cell(`G${columnIndex}`)
          .value(totalLeavesRemaining);
        sheet1
          .cell(`H${columnIndex}`)
          .value(approvedBy);
        sheet1
          .cell(`I${columnIndex}`)
          .value(reason);
        sheet1
          .cell(`J${columnIndex}`)
          .value(department);
        sheet1
          .cell(`K${columnIndex}`)
          .value(baseLocation);
        sheet1
          .cell(`L${columnIndex}`)
          .value(firstSupervisor);
        sheet1
          .cell(`M${columnIndex}`)
          .value(secondSupervisor);
      });

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals.messageObject.attachments.push({
        fileName,
        content: fs.readFileSync(filePath).toString('base64'),
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
