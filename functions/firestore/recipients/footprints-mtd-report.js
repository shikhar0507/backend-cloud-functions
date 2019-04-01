'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  employeeInfo,
  alphabetsArray,
  timeStringWithOffset,
} = require('./report-utils');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');


module.exports = (locals) => {
  const todayFromTimestamp = locals.change.after.get('timestamp');
  const office = locals.officeDoc.get('office');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const officeId = locals.officeDoc.id;
  const momentWithOffset = momentTz(todayFromTimestamp).tz(timezone);
  const momentYesterday = momentWithOffset.subtract(1, 'day');
  const yesterdaysDate = momentYesterday.date();
  const yesterdaysMonth = momentYesterday.month();
  const yesterdaysYear = momentYesterday.year();
  const employeesData = locals.officeDoc.get('employeesData');
  const firstAddendumPromises = [];
  const lastAddendumPromises = [];
  let footprintsObject;
  let initDocRef;
  let excelSheet;
  const dateString = momentYesterday.format(dateFormats.MONTH_YEAR);
  const fileName = `Footprints Month-to-Date ${dateString}`;
  const filePath = `/tmp/${fileName}.xlsx`;
  const fs = require('fs');

  const getDateHeaders = (momentYesterday) => {
    const result = [];
    const end = momentYesterday.date();

    for (let i = end; i >= 1; i--) {
      const momentInit = momentYesterday.date(i).format(dateFormats.MONTH_DATE);

      result.push(momentInit);
    }

    return result;
  };

  Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.FOOTPRINTS_MTD)
        .where('month', '==', momentYesterday.month())
        .where('year', '==', momentYesterday.year())
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        footprintsInitQuery,
        workbook,
      ] = result;

      locals.workbook = workbook;

      excelSheet = workbook.addSheet('Footprints MTD');
      excelSheet.row(1).style('bold', true);

      footprintsObject = (() => {
        if (footprintsInitQuery.empty) {
          initDocRef = rootCollections.inits.doc();

          return {};
        }

        const doc = footprintsInitQuery.docs[0];

        initDocRef = doc.ref;

        return doc.get('footprintsObject') || {};
      })();

      const phoneNumbersArray = Object.keys(employeesData);

      phoneNumbersArray.forEach((phoneNumber) => {
        if (!footprintsObject[phoneNumber]) {
          footprintsObject[phoneNumber] = {
            [yesterdaysDate]: {
              first: '',
              last: '',
            },
          };
        }

        const first = locals
          .officeDoc
          .ref
          .collection('Addendum')
          .where('date', '==', yesterdaysDate)
          .where('month', '==', yesterdaysMonth)
          .where('year', '==', yesterdaysYear)
          .where('user', '==', phoneNumber)
          .orderBy('timestamp', 'asc')
          .limit(1)
          .get();

        const last = locals
          .officeDoc
          .ref
          .collection('Addendum')
          .where('date', '==', yesterdaysDate)
          .where('month', '==', yesterdaysMonth)
          .where('year', '==', yesterdaysYear)
          .where('user', '==', phoneNumber)
          .orderBy('timestamp', 'desc')
          .limit(1)
          .get();

        firstAddendumPromises.push(first);
        lastAddendumPromises.push(last);
      });

      return Promise.all(firstAddendumPromises);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          return;
        }

        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('user');
        const first = doc.get('timestamp');

        footprintsObject[phoneNumber][yesterdaysDate] = {
          first: timeStringWithOffset({
            timezone,
            timestampToConvert: first,
            format: dateFormats.TIME,
          }),
        };
      });

      return Promise.all(lastAddendumPromises);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          return;
        }

        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('user');
        const last = doc.get('timestamp');

        footprintsObject[phoneNumber][yesterdaysDate].last = timeStringWithOffset({
          timezone,
          timestampToConvert: last,
          format: dateFormats.TIME,
        });
      });

      console.log('initDocRef', initDocRef.path);

      return initDocRef
        .set({
          office,
          officeId,
          footprintsObject,
          report: reportNames.FOOTPRINTS_MTD,
          month: momentYesterday.month(),
          year: momentYesterday.year(),
        }, {
            merge: true,
          });
    })
    .then(() => {
      Object
        .keys(employeesData)
        .forEach((phoneNumber, outerIndex) => {
          const employeeObject = employeeInfo(employeesData, phoneNumber);
          const employeeName = employeeObject.name;
          const liveSince = timeStringWithOffset({
            timezone,
            format: dateFormats.DATE,
            timestampToConvert: employeesData[phoneNumber].createTime,
          });

          excelSheet.cell(`A${outerIndex}`).value(employeeName);
          excelSheet.cell(`B${outerIndex}`).value(phoneNumber);
          excelSheet.cell(`C${outerIndex}`).value(employeeObject.department);
          excelSheet.cell(`D${outerIndex}`).value(employeeObject.baseLocation);
          excelSheet.cell(`E${outerIndex}`).value(liveSince);

          let alphabetIndexStart = 6;

          for (let date = yesterdaysDate; date >= 1; date--) {
            const {
              first,
              last,
            } = footprintsObject[phoneNumber][date - 1] || {};


            const alphabet = alphabetsArray[alphabetIndexStart];
            const value = (() => {
              if (!first && !last) {
                return '-';
              }

              if (first && !last) {
                return first;
              }

              return `${first} | ${last}`;
            })();

            const cell = `${alphabet}${outerIndex}`;

            excelSheet.cell(cell).value(value);
            alphabetIndexStart++;
          }
        });

      const headers = [
        'Employee Name',
        'Employee Contact',
        'Department',
        'Base Location',
        'Live Since',
      ];

      const dateHeaders = getDateHeaders(momentYesterday);

      []
        .concat(headers)
        .concat(dateHeaders)
        .forEach((header, index) => {
          excelSheet
            .cell(`${alphabetsArray[index]}1`)
            .value(header);
        });

      locals.workbook.deleteSheet('Sheet1');

      return locals.workbook.toFileAsync(filePath);
    })
    .then(() => {
      locals
        .messageObject['dynamic_template_data'] = {
          office,
          subject: `Footprints Report Month-to-Date_${office}_${dateString}`,
          date: dateString,
        };

      locals
        .messageObject
        .attachments
        .push({
          content: fs.readFileSync(filePath).toString('base64'),
          fileName: `Footprints Month-to-Date ${office}_Report_${dateString}.xlsx`,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log({
        to: locals.messageObject.to,
        report: reportNames.FOOTPRINTS_MTD,
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
