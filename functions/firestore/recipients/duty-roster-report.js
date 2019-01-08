'use strict';

const {
  rootCollections,
  users,
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
  toMapsUrl,
} = require('./report-utils');


const xlsxPopulate = require('xlsx-populate');
const moment = require('moment');


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
  const authMap = new Map();

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
      locals.sheet1 = sheet1;

      const firstRowValues = [
        'Duty Type',
        'Description',
        'Reporting Time',
        'Reporting Location',
        'Created By',
        'Created On',
        'Status',
        'Confirmed By',
        'Confirmed On',
        'Place',
        'Assignees',
      ];

      firstRowValues.forEach((header, index) => {
        sheet1
          .cell(`${alphabetsArray[index]}1`)
          .value(header);
      });

      const employeesData = locals.officeDoc.get('employeesData');
      const dutyRosterObject = initDocQuery.docs[0].get('dutyRosterObject');
      const activityIdsArray = Object.keys(dutyRosterObject);
      locals.employeesData = employeesData;
      locals.dutyRosterObject = dutyRosterObject;
      locals.activityIdsArray = activityIdsArray;

      const authFetch = [];
      const tmp = new Set();
      activityIdsArray.forEach((activityId) => {
        const user = dutyRosterObject[activityId].user;
        const assignees = dutyRosterObject[activityId].assignees;

        assignees.forEach((phoneNumber) => {
          authFetch.push(users.getUserByPhoneNumber(phoneNumber));
          tmp.add(phoneNumber);
        });

        if (employeeInfo(employeesData, user).name) return;

        authFetch.push(users.getUserByPhoneNumber(user));
        tmp.add(user);
      });

      console.log({ tmp });

      return Promise.all(authFetch);
    })
    .then((userRecords) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record) return;

        authMap.set(phoneNumber, record.displayName);
      });

      return null;
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals.activityIdsArray.forEach((activityId, index) => {
        const columnIndex = index + 2;

        const {
          status,
          dutyType,
          description,
          reportingLocation,
          reportingLocationGeopoint,
          reportingTimeStart,
          reportingTimeEnd,
          createdBy,
          createdOn,
          place,
          when,
          user,
          // phoneNumber,
          assignees,
        } = locals.dutyRosterObject[activityId];

        const {
          url,
          identifier,
        } = place;

        const assigneesArray = [];

        assignees.forEach((phoneNumber) => {
          const employeeObject =
            employeeInfo(locals.employeesData, phoneNumber);

          const name = (() => {
            if (employeeObject.name) {
              return employeeObject.name;
            }

            if (authMap.has(phoneNumber)
              && authMap.get(phoneNumber).displayName) {
              return authMap.get(phoneNumber).displayName;
            }

            return phoneNumber;
          })();

          assigneesArray.push(name);
        });

        const reportingTimeStartTimestamp = timeStringWithOffset({
          timestampToConvert: reportingTimeStart,
          timezone: locals.timezone,
          format: dateFormats.DATE_TIME,
        });

        const reportingTimeEndTimestamp = timeStringWithOffset({
          timestampToConvert: reportingTimeEnd,
          timezone: locals.timezone,
          format: dateFormats.DATE_TIME,
        });

        const createdOnTimeString = dateStringWithOffset({
          timezone: locals.timezone,
          timestampToConvert: createdOn,
          format: dateFormats.DATE_TIME,
        });
        const creatorName = (() => {
          // employeeInfo(locals.employeesData, createdBy).name || createdBy;
          if (employeeInfo(locals.employeesData, createdBy).name) {
            return employeeInfo(locals.employeesData, createdBy).name;
          }

          if (authMap.has(createdBy) && authMap.get(createdBy).displayName) {
            return authMap.get(createdBy).displayName;
          }

          return createdBy;
        })();

        const confirmedWhen = dateStringWithOffset({
          timezone,
          timestampToConvert: when,
          format: dateFormats.DATE_TIME,
        });
        const confirmedBy = (() => {
          if (employeeInfo(locals.employeesData, user).name) {
            return employeeInfo(locals.employeesData, user).name;
          }

          if (authMap.get(user)
            && authMap.get(user).displayName) {
            return authMap.get(user).displayName;
          }

          return user;
        })();

        locals.sheet1.cell(`A${columnIndex}`).value(dutyType);
        locals.sheet1.cell(`B${columnIndex}`).value(description);
        locals
          .sheet1
          .cell(`C${columnIndex}`)
          .value(`${reportingTimeStartTimestamp} - ${reportingTimeEndTimestamp}`);

        if (reportingLocation) {
          locals
            .sheet1
            .cell(`D${columnIndex}`)
            .value(reportingLocation)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(toMapsUrl(reportingLocationGeopoint));
        } else {
          locals
            .sheet1
            .cell(`D${columnIndex}`)
            .value(identifier);
        }

        locals.sheet1.cell(`E${columnIndex}`).value(creatorName);
        locals.sheet1.cell(`F${columnIndex}`).value(createdOnTimeString);
        locals.sheet1.cell(`G${columnIndex}`).value(status);
        locals.sheet1.cell(`H${columnIndex}`).value(confirmedWhen);
        locals.sheet1.cell(`I${columnIndex}`).value(confirmedBy);

        if (place.identifier) {
          locals
            .sheet1
            .cell(`J${columnIndex}`)
            .value(place.identifier)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(url);
        } else {
          locals
            .sheet1
            .cell(`J${columnIndex}`)
            .value(place.identifier || '');
        }

        locals.sheet1.cell(`K${columnIndex}`).value(`${assigneesArray} `);
      });

      return locals.workbook.toFileAsync(filePath);
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

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
