'use strict';

const {
  alphabetsArray,
  dateStringWithOffset,
  timeStringWithOffset,
  getEmployeeDetailsString,
  getUrl,
  getIdentifier,
} = require('./report-utils');
const {dateFormats} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');

module.exports = locals => {
  const office = locals.officeDoc.get('office');
  // const employeesData = locals.employeesData;
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  // const timestampFromTimer = locals.change.after.get('timestamp');
  const tsStart = momentTz(new Date('16 July 2019')).startOf('day');
  const tsEnd = momentTz(new Date('31 July 2019')).endOf('day');

  const sheetRefsMap = new Map();
  const rowIndexMap = new Map();
  const prevDateStringMap = new Map();
  let worksheet;

  return Promise.all([
    locals.officeDoc.ref
      .collection('Addendum')
      .where('timestamp', '>=', tsStart.valueOf())
      .where('timestamp', '<=', tsEnd.valueOf())
      .orderBy('timestamp')
      .get(),
    xlsxPopulate.fromBlankAsync(),
  ])
    .then(result => {
      const [addendumDocsQuery, workbook] = result;
      console.log('Docs read:', addendumDocsQuery.size);

      worksheet = workbook;

      addendumDocsQuery.docs.forEach(doc => {
        let employeeSheet;
        let rowIndex;
        const phoneNumber = doc.get('user');
        const distanceTravelled = doc.get('distanceTravelled') || 0;

        if (!distanceTravelled) {
          return;
        }

        const sheetName = (() => {
          if (locals.employeesData[phoneNumber]) {
            return locals.employeesData[phoneNumber].Name;
          }

          return phoneNumber;
        })();

        const employeeName = (() => {
          if (locals.employeesData[phoneNumber]) {
            return locals.employeesData[phoneNumber].Name;
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
        const identifier = getIdentifier(doc);
        const url = getUrl(doc);

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

            employeeSheet.cell(`B${rowIndex}`).value(dateString);
            if (url && identifier) {
              employeeSheet
                .cell(`C${rowIndex}`)
                .value(identifier)
                .style({
                  fontColor: '0563C1',
                  underline: true,
                })
                .hyperlink(url);
            } else {
              employeeSheet.cell(`C${rowIndex}`).value(identifier);
            }

            const numberOfActivities =
              employeeSheet.cell(`D${rowIndex}`).value() || 0;

            employeeSheet.cell(`D${rowIndex}`).value(numberOfActivities + 1);

            employeeSheet.cell(`E${rowIndex}`).value(timeString);

            // last activity time
            employeeSheet.cell(`F${rowIndex}`).value(timeString);
            employeeSheet
              .cell(`G${rowIndex}`)
              .value(distanceTravelled.toFixed(2));
          } else {
            // No rowIndex increment required here. Updating the current row
            if (Math.floor(distanceTravelled) === 0) {
              const numberOfActivities =
                employeeSheet.cell(`D${rowIndex}`).value() || 0;

              employeeSheet.cell(`D${rowIndex}`).value(numberOfActivities + 1);

              // Last activity time
              employeeSheet.cell(`F${rowIndex}`).value(timeString);
            } else {
              rowIndex++;

              employeeSheet.cell(`B${rowIndex}`).value(dateString);
              if (url && identifier) {
                employeeSheet
                  .cell(`C${rowIndex}`)
                  .value(identifier)
                  .style({
                    fontColor: '0563C1',
                    underline: true,
                  })
                  .hyperlink(url);
              } else {
                employeeSheet.cell(`C${rowIndex}`).value(identifier);
              }
              employeeSheet.cell(`D${rowIndex}`).value(1);
              employeeSheet.cell(`E${rowIndex}`).value(timeString);
              employeeSheet.cell(`F${rowIndex}`).value(timeString);
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
            'Employee Details',
          ].forEach((header, index) => {
            employeeSheet.cell(`${alphabetsArray[index]}1`).value(header);
          });

          employeeSheet.cell(`A${rowIndex}`).value(employeeName);
          employeeSheet.cell(`B${rowIndex}`).value(dateString);

          if (url && identifier) {
            employeeSheet
              .cell(`C${rowIndex}`)
              .value(identifier)
              .style({
                fontColor: '0563C1',
                underline: true,
              })
              .hyperlink(url);
          } else {
            employeeSheet.cell(`C${rowIndex}`).value(identifier);
          }

          employeeSheet.cell(`D${rowIndex}`).value(1);
          employeeSheet.cell(`E${rowIndex}`).value(timeString);
          employeeSheet.cell(`F${rowIndex}`).value(timeString);
          employeeSheet
            .cell(`G${rowIndex}`)
            .value(distanceTravelled.toFixed(2));
          employeeSheet
            .cell(`H${rowIndex}`)
            .value(getEmployeeDetailsString(locals.employeesData, phoneNumber));

          rowIndexMap.set(phoneNumber, rowIndex);
          sheetRefsMap.set(sheetName, employeeSheet);
        }

        prevDateStringMap.set(phoneNumber, dateString);
      });

      worksheet.deleteSheet('Sheet1');
      const dateString =
        `${tsStart.format(dateFormats.DATE)}` +
        `-${tsEnd.format(dateFormats.DATE)}`;

      // return worksheet.outputAsync('base64');
      return worksheet.toFileAsync(
        `/tmp/Travel Expense Report_${office}_${dateString}.xlsx`,
      );
    })
    .then(content => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      const dateString =
        `${tsStart.format(dateFormats.DATE)}` +
        `-${tsEnd.format(dateFormats.DATE)}`;

      locals.messageObject['dynamic_template_data'] = {
        office,
        subject: `Travel Expense Report_${office}_${dateString}`,
        date: dateString,
      };

      locals.messageObject.attachments.push({
        content,
        fileName: `Travel Expense Report ${office}_Report_${dateString}.xlsx`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      // return locals
      //   .sgMail
      //   .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
