'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  reportNames,
  sendGridTemplateIds,
  dateFormats,
} = require('../../admin/constants');
const {
  alphabetsArray,
  momentOffsetObject,
  employeeInfo,
  timeStringWithOffset,
  dateStringWithOffset,
} = require('./report-utils');


const xlsxPopulate = require('xlsx-populate');
const moment = require('moment');

const toMapsUrl = (geopoint) => {
  const latitude = geopoint._latitude || geopoint.latitude;
  const longitude = geopoint._longitude || geopoint.longitude;

  return `https://www.google.com/maps/@${latitude},${longitude}`;
};


module.exports = (locals) => {
  const {
    office,
  } = locals.change.after.data();

  locals.sendMail = true;

  const todaysDateString = moment().format(dateFormats.DATE);
  locals.messageObject.templateId = sendGridTemplateIds.dutyRoster;
  const fileName
    = `${office} Duty Roster Report_${todaysDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  locals.messageObject['dynamic_template_data'] = {
    office,
    date: todaysDateString,
    subject: `Duty Roster Report_${office}_${todaysDateString}`,
  };

  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentDateObject = momentOffsetObject(timezone);

  return Promise
    .all([
      rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', reportNames.DUTY_ROSTER)
        .where('month', '==', momentDateObject.yesterday.MONTH_NUMBER)
        .where('year', '==', momentDateObject.yesterday.YEAR)
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        initDocQuery,
        workbook,
      ] = result;

      if (initDocQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      const sheet1 = workbook.addSheet('Duty Roster');
      sheet1.row(1).style('bold', true);
      workbook.deleteSheet('Sheet1');

      locals.workbook = workbook;

      const firstRowValues = [
        'Duty Type',
        'Description',
        'Reporting Time',
        'Reporting Location',
        'Created By',
        'Created On',
        'Status',
        'When',
        'User',
        'Place',
        'Assignees',
      ];

      firstRowValues.forEach((header, index) => {
        sheet1
          .cell(`${alphabetsArray[index]}1`)
          .value(header);
      });

      const employeesData = locals.officeDoc.get('employeesData');
      const timezone = locals.officeDoc.get('attachment.Timezone.value');
      const dutyRosterObject = initDocQuery.docs[0].get('dutyRosterObject');
      const activityIdsArray = Object.keys(dutyRosterObject);

      activityIdsArray.forEach((activityId, index) => {
        const columnIndex = index + 2;

        const {
          status,
          dutyType,
          description,
          reportingLocation,
          reportingLocationGeopoint,
          reportingTimeStart,
          createdBy,
          createdOn,
          place,
          when,
          user,
          assignees,
        } = dutyRosterObject[activityId];

        const {
          url,
          identifier,
        } = place;

        const assigneesArray = [];

        assignees.forEach((phoneNumber) => {
          const employeeObject = employeeInfo(employeesData, phoneNumber);

          assigneesArray.push(employeeObject.name || phoneNumber);
        });

        const reportingTime = timeStringWithOffset({
          timestampToConvert: reportingTimeStart,
          timezone,
        });

        const createdOnTimeString = dateStringWithOffset({
          timezone,
          timestampToConvert: createdOn,
        });

        const creatorName =
          employeeInfo(employeesData, createdBy).name || createdBy;

        const confirmedWhen = dateStringWithOffset({
          timezone,
          timestampToConvert: when,
        });

        const confirmedBy = employeeInfo(employeesData, user).name || user;

        sheet1.cell(`A${columnIndex}`).value(dutyType);
        sheet1.cell(`B${columnIndex}`).value(description);
        sheet1.cell(`C${columnIndex}`).value(reportingTime);

        console.log(activityId, reportingLocation);

        if (reportingLocation) {
          sheet1
            .cell(`D${columnIndex}`)
            .value(reportingLocation)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(toMapsUrl(reportingLocationGeopoint));
        } else {
          sheet1
            .cell(`D${columnIndex}`)
            .value(identifier);
        }
        sheet1.cell(`E${columnIndex}`).value(creatorName);
        sheet1.cell(`F${columnIndex}`).value(createdOnTimeString);
        sheet1.cell(`G${columnIndex}`).value(status);
        sheet1.cell(`H${columnIndex}`).value(confirmedWhen);
        sheet1.cell(`I${columnIndex}`).value(confirmedBy);

        if (place.identifier) {
          sheet1
            .cell(`J${columnIndex}`)
            .value(place.identifier)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(url);
        } else {
          sheet1
            .cell(`J${columnIndex}`)
            .value(place.identifier || '');
        }

        sheet1.cell(`K${columnIndex}`).value(`${assigneesArray} `);
      });

      return locals.workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) return Promise.resolve();

      const fs = require('fs');

      locals.messageObject.attachments.push({
        fileName,
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
