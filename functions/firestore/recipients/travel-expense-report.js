'use strict';

const {
  alphabetsArray,
  dateStringWithOffset,
  timeStringWithOffset,
} = require('./report-utils');
const {
  dateFormats,
  httpsActions,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');


const getEmployeeDetailsString = (employeesData, phoneNumber) => {
  if (!employeesData[phoneNumber]) {
    return `Not an active employee`;
  }

  const supervisorsString = (() => {
    let result = [];
    let firstSupervisor = employeesData[phoneNumber]['First Supervisor'];
    let secondSupervisor = employeesData[phoneNumber]['Second Supervisor'];

    if (employeesData[firstSupervisor]) {
      firstSupervisor = employeesData[firstSupervisor].Name;
    }

    if (employeesData[secondSupervisor]) {
      secondSupervisor = employeesData[secondSupervisor].Name;
    }

    if (employeesData[firstSupervisor]) {
      result.push(employeesData[firstSupervisor].Name);
    } else {
      result.push(firstSupervisor);
    }

    if (employeesData[secondSupervisor]) {
      result.push(employeesData[secondSupervisor].Name);
    } else {
      result.push(secondSupervisor);
    }

    if (result.length === 0) {
      return result;
    }

    return ` | Supervisors: ${result}`;
  })();

  return `Name: ${employeesData[phoneNumber].Name}`
    + ` | Employee Code: ${employeesData[phoneNumber]['Employee Code']}`
    + ` | Contact Number: ${employeesData[phoneNumber]['Employee Contact']}`
    + `${supervisorsString}`;
};

module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const employeesData = locals.officeDoc.get('employeesData');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const timestampFromTimer = locals.change.after.get('timestamp');
  const tsStart = momentTz().tz(timezone).startOf('month');
  const tsEnd = momentTz(timestampFromTimer).tz(timezone).endOf('day');
  const dateString = '';
  const sheetRefsMap = new Map();
  const rowIndexMap = new Map();
  const prevDateStringMap = new Map();
  let worksheet;

  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('timestamp', '>=', tsStart.valueOf())
        .where('timestamp', '<=', tsEnd.valueOf())
        .orderBy('timestamp')
        .get(),
      xlsxPopulate
        .fromBlankAsync()
    ])
    .then((result) => {
      const [addendumDocsQuery, workbook] = result;
      console.log('Docs read:', addendumDocsQuery.size);

      worksheet = workbook;

      addendumDocsQuery.docs.forEach((doc) => {
        let employeeSheet;
        let rowIndex;
        const phoneNumber = doc.get('user');
        const distanceTravelled = doc.get('distanceTravelled') || 0;


        if (!distanceTravelled) {
          return;
        }

        const sheetName = (() => {
          if (employeesData[phoneNumber]) {
            return employeesData[phoneNumber].Name;
          }

          return phoneNumber;
        })();

        const employeeName = (() => {
          if (employeesData[phoneNumber]) {
            return employeesData[phoneNumber].Name;
          }

          return phoneNumber;
        })();
        const dateString = dateStringWithOffset({
          timezone,
          timestampToConvert: doc.get('timestamp'),
          format: dateFormats.DATE,
        });
        const timeString = timeStringWithOffset({
          timezone,
          timestampToConvert: doc.get('timestamp'),
          format: dateFormats.TIME,
        });
        const identifier = (() => {
          const template = doc.get('template');
          const action = doc.get('action');

          if (template !== 'check-in' || action !== httpsActions.create) {
            return doc.get('identifier');
          }

          const venue = doc.get('activityData.venue')[0];

          if (!venue || !venue.location) {
            return doc.get('identifier');
          }

          return venue.location;
        })();
        const url = doc.get('url');

        if (rowIndexMap.has(phoneNumber)) {
          rowIndex = rowIndexMap.get(phoneNumber);
        } else {
          rowIndex = 2;
        }

        // Sheet has been created for the employee before or on
        // this iteration of the loop.
        if (sheetRefsMap.has(sheetName)) {
          // add new line
          const previousDateString = prevDateStringMap.get(phoneNumber);
          employeeSheet = sheetRefsMap.get(sheetName);

          if (dateString !== previousDateString) {
            rowIndex++;

            employeeSheet
              .cell(`B${rowIndex}`)
              .value(dateString);
            if (url && identifier) {
              employeeSheet
                .cell(`C${rowIndex}`)
                .value(identifier)
                .style({ fontColor: '0563C1', underline: true })
                .hyperlink(url);
            } else {
              employeeSheet
                .cell(`C${rowIndex}`)
                .value(identifier);
            }

            const numberOfActivities = employeeSheet
              .cell(`D${rowIndex}`)
              .value() || 0;

            employeeSheet
              .cell(`D${rowIndex}`)
              .value(numberOfActivities + 1);

            employeeSheet
              .cell(`E${rowIndex}`)
              .value(timeString);

            // last activity time
            employeeSheet
              .cell(`F${rowIndex}`)
              .value(timeString);
            employeeSheet
              .cell(`G${rowIndex}`)
              .value(distanceTravelled.toFixed(2));
          } else {
            // No rowIndex increment required here. Updating the current row
            if (Math.floor(distanceTravelled) === 0) {
              const numberOfActivities = employeeSheet
                .cell(`D${rowIndex}`)
                .value() || 0;

              employeeSheet
                .cell(`D${rowIndex}`)
                .value(numberOfActivities + 1);

              // Last activity time
              employeeSheet
                .cell(`F${rowIndex}`)
                .value(timeString);
            } else {
              rowIndex++;

              employeeSheet
                .cell(`B${rowIndex}`)
                .value(dateString);
              if (url && identifier) {
                employeeSheet
                  .cell(`C${rowIndex}`)
                  .value(identifier)
                  .style({ fontColor: '0563C1', underline: true })
                  .hyperlink(url);
              } else {
                employeeSheet
                  .cell(`C${rowIndex}`)
                  .value(identifier);
              }
              employeeSheet
                .cell(`D${rowIndex}`)
                .value(1);
              employeeSheet
                .cell(`E${rowIndex}`)
                .value(timeString);
              employeeSheet
                .cell(`F${rowIndex}`)
                .value(timeString);
              employeeSheet
                .cell(`G${rowIndex}`)
                .value(distanceTravelled.toFixed(2));

              rowIndexMap.set(phoneNumber, rowIndex);
            }
          }

          rowIndexMap.set(phoneNumber, rowIndex);
        } else {
          const employeeSheet = worksheet.addSheet(sheetName);
          employeeSheet.row(1).style('bold', true);

          [
            'Employee Name',
            'Date',
            'Created From',
            'Number Of Activities Created',
            'First Activity Time',
            'Last Activity Time',
            'Distance From Previous Location (in KM)',
            'Employee Details'
          ]
            .forEach((header, index) => {
              employeeSheet
                .cell(`${alphabetsArray[index]}1`)
                .value(header);
            });

          employeeSheet
            .cell(`A${rowIndex}`)
            .value(employeeName);
          employeeSheet
            .cell(`B${rowIndex}`)
            .value(dateString);

          if (url && identifier) {
            employeeSheet
              .cell(`C${rowIndex}`)
              .value(identifier)
              .style({ fontColor: '0563C1', underline: true })
              .hyperlink(url);
          } else {
            employeeSheet
              .cell(`C${rowIndex}`)
              .value(identifier);
          }

          employeeSheet
            .cell(`D${rowIndex}`)
            .value(1);
          employeeSheet
            .cell(`E${rowIndex}`)
            .value(timeString);
          employeeSheet
            .cell(`F${rowIndex}`)
            .value(timeString);
          employeeSheet
            .cell(`G${rowIndex}`)
            .value(distanceTravelled.toFixed(2));
          employeeSheet
            .cell(`H${rowIndex}`)
            .value(getEmployeeDetailsString(employeesData, phoneNumber));

          rowIndexMap.set(phoneNumber, rowIndex);
          sheetRefsMap.set(sheetName, employeeSheet);
        }

        prevDateStringMap.set(phoneNumber, dateString);
      });

      worksheet.deleteSheet('Sheet1');

      return worksheet.outputAsync();
    })
    .then((content) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals
        .messageObject['dynamic_template_data'] = {
          office,
          subject: `Footprints Report_${office}_${dateString}`,
          date: dateString,
        };

      locals
        .messageObject
        .attachments
        .push({
          content,
          fileName: `Travel Expense Report ${office}_Report_${dateString}.xlsx`,
          type: 'text/csv',
          disposition: 'attachment',
        });

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
