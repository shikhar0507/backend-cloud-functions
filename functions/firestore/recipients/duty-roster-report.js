'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  alphabetsArray,
  employeeInfo,
  timeStringWithOffset,
  dateStringWithOffset,
  toMapsUrl,
} = require('./report-utils');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');
const fs = require('fs');


const activitiesDueTodaySheet = (params) => {
  const { worksheet, dueToday, locals, timezone } = params;

  if (!locals.sendMail || dueToday.empty) {
    return Promise.resolve(params);
  }

  const sheet2 = worksheet.addSheet('Duties Assigned For Today');

  const firstRowValues = [
    'Name',
    'Description',
    'Reporting Time',
    'Reporting Location',
    'Created By',
    'Status',
    'Assignees',
  ];

  firstRowValues.forEach((header, index) => {
    sheet2
      .cell(`${alphabetsArray[index]}1`)
      .value(header);
  });

  const employeesData = locals.officeDoc.get('employeesData');
  const dutyRosterObject = dueToday.docs[0].get('dutyRosterObject');

  Object.keys(dutyRosterObject).forEach((activityId, index) => {
    const columnIndex = index + 2;

    const {
      status,
      dutyType,
      name,
      description,
      reportingLocation,
      reportingLocationGeopoint,
      reportingTimeStart,
      reportingTimeEnd,
      createdBy,
      assignees,
    } = dutyRosterObject[activityId];

    const assigneesString = (() => {
      let str = '';
      assignees.forEach((phoneNumber) => {
        const name = employeeInfo(employeesData, phoneNumber).name;

        if (!name) {
          str += `${phoneNumber}`;

          return;
        }

        str += `${name}`;

        if (index !== assignees.length) {
          str += ',';
        }
      });

      return str;
    })();

    const reportingTimeStartTimestamp = timeStringWithOffset({
      timestampToConvert: reportingTimeStart,
      timezone,
      format: dateFormats.DATE_TIME,
    });
    const reportingTimeEndTimestamp = timeStringWithOffset({
      timestampToConvert: reportingTimeEnd,
      timezone,
      format: dateFormats.DATE_TIME,
    });
    const creatorName = (() => {
      const result = employeeInfo(employeesData, createdBy).name;

      if (result) return result;

      return createdBy;
    })();

    const reportingTime =
      `${reportingTimeStartTimestamp} - ${reportingTimeEndTimestamp}`;

    sheet2
      .cell(`A${columnIndex}`)
      .value(dutyType || name);
    sheet2
      .cell(`B${columnIndex}`)
      .value(description);
    sheet2
      .cell(`C${columnIndex}`)
      .value(reportingTime);

    if (reportingLocation) {
      sheet2
        .cell(`D${columnIndex}`)
        .value(reportingLocation)
        .style({ fontColor: '0563C1', underline: true })
        .hyperlink(toMapsUrl(reportingLocationGeopoint));
    } else {
      sheet2
        .cell(`D${columnIndex}`)
        .value('');
    }

    sheet2
      .cell(`E${columnIndex}`)
      .value(creatorName);
    sheet2
      .cell(`F${columnIndex}`)
      .value(status);
    sheet2
      .cell(`G${columnIndex}`)
      .value(`${assigneesString} `);
  });

  return params;
};

const activitiesCreatedYesterdaySheet = (params) => {
  const {
    worksheet,
    createdYesterday,
    locals,
    assigneesArrayMap,
    timezone,
  } = params;

  if (!locals.sendMail || createdYesterday.empty) {
    return Promise.resolve(params);
  }

  const queries = [];
  const activityIdsArray = [];

  createdYesterday.forEach((activity) => {
    const query = rootCollections
      .activities
      .doc(activity.id)
      .collection('Assignees')
      .get();

    activityIdsArray.push(activity.id);
    queries.push(query);
  });

  const sheet1 = worksheet.addSheet('Duties Created Yesterday');
  const topFields = [
    'Name',
    'Description',
    'Reporting Time',
    'Reporting Location',
    'Created By',
    'Created On,',
    'Status',
    'Assignees',
  ];

  topFields.forEach((field, index) => {
    sheet1
      .cell(`${alphabetsArray[index]}1`)
      .value(field);
  });

  const employeesData = locals.officeDoc.get('employeesData');

  console.log('before promise');

  return Promise
    .all(queries)
    .then((result) => {
      result.forEach((snapShot, index) => {
        const id = activityIdsArray[index];

        const assignees = snapShot.docs.map((doc) => {
          const name = employeeInfo(employeesData, doc.id).name;

          if (name) {
            console.log('no name', doc.id);

            return name;
          }

          return '';
        });

        assigneesArrayMap.set(id, assignees);
      });

      createdYesterday.docs.forEach((doc, index) => {
        const name = doc.get('attachment.Name.value');
        const description = doc.get('attachment.Description.value');
        const reportingSchedule = doc.get('schedule')[0];
        const venue = doc.get('venue')[0];
        const reportingTimeStart = dateStringWithOffset({
          timezone,
          timestampToConvert: reportingSchedule.startTime,
        });
        const reportingTimeEnd = dateStringWithOffset({
          timezone,
          timestampToConvert: reportingSchedule.endTime,
        });

        const reportingLocation = (() => {
          if (!venue.address) return '';

          return {
            url: toMapsUrl(venue.geopoint),
            address: venue.address,
          };
        })();

        const reportingTime = `${reportingTimeStart} - ${reportingTimeEnd}`;
        const createdBy = employeeInfo(employeesData, doc.get('creator')).name || doc.get('creator');
        const creationDate = doc.get('creationDate');
        const creationMonth = doc.get('creationMonth');
        const creationYear = doc.get('creationYear');
        const createdOn = dateStringWithOffset({
          timezone,
          timestampToConvert: momentTz()
            .date(creationDate)
            .month(creationMonth)
            .year(creationYear)
            .unix() * 1000,
        });
        const status = doc.get('status');
        const assignees = assigneesArrayMap.get(doc.id).toString();
        const columnIndex = index + 2;

        sheet1
          .cell(`A${columnIndex}`)
          .value(name);
        sheet1
          .cell(`B${columnIndex}`)
          .value(description);
        sheet1
          .cell(`C${columnIndex}`)
          .value(reportingTime);

        if (reportingLocation) {
          sheet1
            .cell(`D${columnIndex}`)
            .value(reportingLocation.address)
            .style({ fontColor: '0563C1', underline: true })
            .hyperlink(reportingLocation.url);
        } else {
          sheet1
            .cell(`D${columnIndex}`)
            .value('');
        }

        sheet1
          .cell(`E${columnIndex}`)
          .value(createdBy);
        sheet1
          .cell(`F${columnIndex}`)
          .value(createdOn);
        sheet1
          .cell(`G${columnIndex}`)
          .value(status);
        sheet1
          .cell(`H${columnIndex}`)
          .value(assignees);
      });

      return params;
    })
    .catch(console.error);
};



module.exports = (locals) => {
  const office = locals.officeDoc.get('office');
  const todayFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const offsetObjectToday = momentTz(todayFromTimer).tz(timezone);
  const momentOffsetObjectYesterday = momentTz(todayFromTimer).tz(timezone).subtract(1, 'day');
  const standardDateString = offsetObjectToday.format(dateFormats.DATE);
  const fileName = `${office} Duty Roster Report_${standardDateString}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  locals.messageObject['dynamic_template_data'] = {
    office,
    date: standardDateString,
    subject: `Duty Roster Report_${office}_${standardDateString}`,
  };
  const params = {
    locals,
    assigneesArrayMap: new Map(),
  };

  return Promise
    .all([
      // duty roster activities created yesterday...
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', reportNames.DUTY_ROSTER)
        .where('creationDate', '==', momentOffsetObjectYesterday.date())
        .where('creationMonth', '==', momentOffsetObjectYesterday.month())
        .where('creationYear', '==', momentOffsetObjectYesterday.year())
        .get(),
      rootCollections
        .inits
        .where('report', '==', reportNames.DUTY_ROSTER)
        .where('date', '==', offsetObjectToday.date())
        .where('month', '==', offsetObjectToday.month())
        .where('year', '==', offsetObjectToday.year())
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [activityDocsQuery, initDocsQuery, worksheet] = result;

      if (activityDocsQuery.empty && initDocsQuery.empty) {
        locals.sendMail = false;

        return Promise.resolve({ locals });
      }

      params.timezone = timezone;
      params.worksheet = worksheet;
      params.createdYesterday = activityDocsQuery;
      params.dueToday = initDocsQuery;

      return params;
    })
    .then(activitiesCreatedYesterdaySheet)
    .then(activitiesDueTodaySheet)
    .then((params) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      params.worksheet.deleteSheet('Sheet1');

      return params.worksheet.toFileAsync(filePath);
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

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
