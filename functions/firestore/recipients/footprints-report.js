'use strict';

const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const {
  db,
  rootCollections,
} = require('../../admin/admin');
const env = require('../../admin/env');
const {
  reportNames,
  httpsActions,
  dateFormats,
} = require('../../admin/constants');
const {
  getName,
  alphabetsArray,
  employeeInfo,
  timeStringWithOffset,
  getUrl,
  getIdentifier,
} = require('./report-utils');


const isDiffLessThanFiveMinutes = (first, second) => {
  if (!first || !second) return false;

  return Math.abs(momentTz(second).diff(first, 'minute')) < 5;
};

const getComment = doc => {
  if (doc.get('activityData.attachment.Comment.value')) {
    return doc.get('activityData.attachment.Comment.value');
  }

  const action = doc.get('action');

  if (action === httpsActions.signup) {
    return `Signed up on Growthfile`;
  }

  if (action === httpsActions.install) {
    return `Installed Growthfile`;
  }

  if (action === httpsActions.updatePhoneNumber) {
    const oldPhoneNumber = doc.get('oldPhoneNumber');
    const newPhoneNumber = doc.get('newPhoneNumber');
    return `Phone number changed: ${oldPhoneNumber} to ${newPhoneNumber}`;
  }

  if (action === httpsActions.create) {
    if (doc.get('activityData.template') === 'enquiry') {
      return `${doc.get('activityData.attachment.Product.value')}`
        + ` ${doc.get('activityData.attachment.Enquiry.value')}`;
    }

    return `Created ${doc.get('activityData.template')}`;
  }

  if (action === httpsActions.update) {
    return `Updated ${doc.get('activityData.template')}`;
  }

  if (action === httpsActions.changeStatus) {
    const newStatus = doc.get('status');

    const numbersString = (() => {
      if (newStatus === 'PENDING') {
        return 'reversed';
      }

      return newStatus;
    })();

    return `${numbersString.toUpperCase()}`
      + ` ${doc.get('activityData.template')}`;
  }

  if (action === httpsActions.share) {
    const shareArray = doc.get('share');

    const adjective = (() => {
      if (shareArray.length > 1) {
        return 'were';
      }

      return 'was';
    })();

    return `Phone number(s) ${doc.get('share')} ${adjective} added`;
  }

  if (action === httpsActions.branchView) {
    return '';
  }

  if (action === httpsActions.productView) {
    return '';
  }

  if (action === httpsActions.videoPlay) {
    return '';
  }

  // action is 'comment'
  return doc.get('comment');
};

const handleScheduleReport = async (locals, workbook) => {
  const timestampFromTimer = locals
    .change
    .after
    .get('timestamp');
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const momentFromTimer = momentTz(timestampFromTimer)
    .tz(timezone);
  const timestampMinus24Hours = momentFromTimer
    .clone()
    .startOf('day')
    .subtract(24, 'hours');
  const timestampPlus24Hours = momentFromTimer
    .clone()
    .endOf('day')
    .add(24, 'hours');
  const monthYearString = momentFromTimer
    .format(dateFormats.MONTH_YEAR);

  const activities = await locals
    .officeDoc
    .ref
    .collection('Activities')
    .where('relevantTime', '>=', timestampMinus24Hours.valueOf())
    .where('relevantTime', '<=', timestampPlus24Hours.valueOf())
    .orderBy('relevantTime', 'desc')
    .get();

  if (activities.empty) {
    return;
  }

  const worksheet = workbook
    .addSheet(`Schedule ${monthYearString}`);

  [
    'Activity Name',
    'Activity - Type',
    'Customer Name',
    'Customer Code',
    'Customer Address',
    'Schedule',
    'Created By',
    'Supervisor',
    'Status',
    'Last Updated On',
    'Check-In Times'
  ].forEach((field, index) => {
    worksheet
      .cell(`${alphabetsArray[index]}1`)
      .value(field);
  });

  let index = 0;

  activities
    .forEach(doc => {
      if (doc.get('template') !== 'duty') {
        return;
      }

      const columnIndex = index + 2;
      const activityName = doc.get('activityName');
      // This is duty type
      const activityType = doc.get('attachment.Duty Type.value');
      const schedule = doc.get('schedule')[0];
      const status = doc.get('status');
      const startTime = momentTz(schedule.startTime)
        .tz(timezone)
        .format(dateFormats.DATE_TIME);
      const endTime = momentTz(schedule.endTime)
        .tz(timezone)
        .format(dateFormats.DATE_TIME);
      const createdBy = doc.get('creator.displayName')
        || doc.get('creator.phoneNumber');
      const lastUpdatedOn = momentTz(doc.get('timestamp'))
        .tz(timezone)
        .format(dateFormats.DATE_TIME);
      const checkIns = doc.get('checkIns') || {};
      let checkInTimes = '';

      Object
        .keys(checkIns)
        .forEach(phoneNumber => {
          const timestamps = checkIns[phoneNumber]; // Array of ts
          const name = getName(locals.employeesData, phoneNumber);

          if (timestamps.length === 0) {
            checkInTimes += `${name} (-- to --, 0) \n`;

            return;
          }

          const firstCheckInFormatted = momentTz(timestamps[0])
            .tz(timezone)
            .format(dateFormats.DATE_TIME);
          const lastCheckInFormatted = momentTz(timestamps[timestamps.length - 1])
            .tz(timezone)
            .format(dateFormats.DATE_TIME);

          checkInTimes += `${name} (${firstCheckInFormatted}`
            + ` to ${lastCheckInFormatted}, ${timestamps.length})`;

          checkInTimes += '\n';
        });

      const customerName = doc
        .get('customerObject.Name');
      const customerCode = doc
        .get('customerObject.Customer Code');
      const customerAddress = doc
        .get('customerObject.address');
      const supervisor = getName(
        locals.employeesData,
        doc.get('attachment.Supervisor.value')
      );

      [
        activityName,
        activityType,
        customerName,
        customerCode,
        customerAddress,
        `${startTime} - ${endTime}`,
        createdBy,
        supervisor,
        status,
        lastUpdatedOn,
        checkInTimes,
      ].forEach((value, i) => {
        worksheet
          .cell(`${alphabetsArray[i]}${columnIndex}`)
          .value(value);
      });

      index++;
    });
};


module.exports = async locals => {
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const timestampFromTimer = locals
    .change
    .after
    .get('timestamp');
  const momentToday = momentTz(timestampFromTimer)
    .tz(timezone)
    .startOf('day');
  const momentYesterday = momentToday
    .clone()
    .subtract(1, 'day');
  const dated = momentYesterday
    .format(dateFormats.DATE);
  const office = locals.officeDoc.get('office');
  const dateYesterday = momentYesterday.date();
  const distanceMap = new Map();
  const prevTemplateForPersonMap = new Map();
  const prevDocTimestampMap = new Map();
  const monthYearString = momentYesterday
    .format(dateFormats.MONTH_YEAR);
  const employeePhoneNumbersArray = Object.keys(locals.employeesData);
  const counterObject = {
    totalUsers: employeePhoneNumbersArray.length,
    active: 0,
    notActive: 0,
    notInstalled: 0,
    activitiesCreated: 0,
    /** People on Leave, Weekly Off or Holiday (from branch) */
    onLeaveWeeklyOffHoliday: 0,
  };

  const promises = [
    xlsxPopulate
      .fromBlankAsync(),
    locals
      .officeDoc
      .ref
      .collection('Addendum')
      .where('date', '==', momentYesterday.date())
      .where('month', '==', momentYesterday.month())
      .where('year', '==', momentYesterday.year())
      .orderBy('user')
      .orderBy('timestamp')
      .get()
  ];

  try {
    const [
      workbook,
      addendumDocsQueryResult,
    ] = await Promise.all(promises);

    const footprintsSheet = workbook.addSheet('Footprints');
    /** Default sheet */
    workbook
      .deleteSheet('Sheet1');

    footprintsSheet
      .row(1)
      .style('bold', true);

    [
      'Dated',
      'Employee Name',
      'Employee Contact',
      'Employee Code',
      'Time',
      'Distance Travelled (in KM)',
      'Address',
      'Comment',
      'Department',
      'Base Location'
    ].forEach((field, index) => {
      footprintsSheet
        .cell(`${alphabetsArray[index]}1`)
        .value(field);
    });

    let count = 0;

    addendumDocsQueryResult.forEach(doc => {
      const action = doc.get('action');
      const columnIndex = count + 2;
      const phoneNumber = doc.get('user');
      const employeeObject = employeeInfo(locals.employeesData, phoneNumber);

      const name = (() => {
        if (doc.get('isSupportRequest')) {
          return 'Growthfile Support';
        }

        if (employeeObject.name) {
          return employeeObject.name;
        }

        return doc.get('userDisplayName') || '';
      })();

      const { department, baseLocation, employeeCode } = employeeObject;

      const identifier = getIdentifier(doc);
      const url = getUrl(doc);
      const time = timeStringWithOffset({
        timezone,
        timestampToConvert: doc.get('timestamp'),
      });
      const distanceTravelled = (() => {
        let value = Number(doc.get('distanceTravelled') || 0);

        if (distanceMap.has(phoneNumber)) {
          value += distanceMap.get(phoneNumber);
        } else {
          // Distance starts with 0 for every person each day
          value = 0;
        }

        // Value in the map also needs to be updated otherwise
        // it will always add only the last updated value on each iteration.
        distanceMap
          .set(
            phoneNumber,
            value
          );

        return value
          .toFixed(2);
      })();

      const template = doc.get('activityData.template');
      const prevTemplateForPerson = prevTemplateForPersonMap.get(phoneNumber);
      const prevDocTimestamp = prevDocTimestampMap
        .get(phoneNumber);
      const timestampDiffLessThanFiveMinutes = isDiffLessThanFiveMinutes(
        prevDocTimestamp,
        doc.get('timestamp')
      );
      const distanceFromPrevious = Math
        .floor(
          Number(doc.get('distanceTravelled') || 0)
        );

      if (action == httpsActions.create) {
        counterObject.activitiesCreated++;
      }

      /**
       * Checkins from the same location within 5 minutes are merged into
       * a single line. Only the first occurrence of the event is logged
       * in the excel file. All subsequent items are glossed over.
       */
      if (template === 'check-in'
        && prevTemplateForPerson === 'check-in'
        && timestampDiffLessThanFiveMinutes
        && distanceFromPrevious === 0) {
        return;
      }

      if (doc.get('action')
        === httpsActions.checkIn) {
        return;
      }

      count++;

      prevTemplateForPersonMap
        .set(
          phoneNumber,
          template
        );
      prevDocTimestampMap
        .set(
          phoneNumber,
          doc.get('timestamp')
        );

      footprintsSheet
        .cell(`A${columnIndex}`)
        .value(dated);
      footprintsSheet
        .cell(`B${columnIndex}`)
        .value(name);
      footprintsSheet
        .cell(`C${columnIndex}`)
        .value(phoneNumber);
      footprintsSheet
        .cell(`D${columnIndex}`)
        .value(employeeCode);
      footprintsSheet
        .cell(`E${columnIndex}`)
        .value(time);
      footprintsSheet
        .cell(`F${columnIndex}`)
        .value(distanceTravelled);

      if (identifier && url) {
        footprintsSheet
          .cell(`G${columnIndex}`)
          .value(identifier)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(url);
      } else {
        footprintsSheet
          .cell(`G${columnIndex}`)
          .value('');
      }

      const comment = getComment(doc);

      if (template === 'check-in'
        && doc.get('activityData.attachment.Photo.value').startsWith('http')) {
        footprintsSheet
          .cell(`H${columnIndex}`)
          .value(comment)
          .style({ fontColor: '0563C1', underline: true })
          .hyperlink(doc.get('activityData.attachment.Photo.value'));
      } else {
        footprintsSheet
          .cell(`H${columnIndex}`)
          .value(comment);
      }

      footprintsSheet
        .cell(`I${columnIndex}`)
        .value(department);
      footprintsSheet
        .cell(`J${columnIndex}`)
        .value(baseLocation);
    });

    counterObject
      .active = distanceMap.size;
    counterObject
      .notActive = counterObject.totalUsers - counterObject.active;

    const numberOfDocs = employeePhoneNumbersArray.length;
    const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
    const numberOfBatches = Math
      .round(
        Math
          .ceil(numberOfDocs / MAX_DOCS_ALLOWED_IN_A_BATCH)
      );
    const batchArray = Array
      .from(Array(numberOfBatches)).map(() => db.batch());

    let batchIndex = 0;
    let docsCounter = 0;

    employeePhoneNumbersArray
      .forEach(phoneNumber => {
        const { hasInstalled } = locals.employeesData[phoneNumber];

        if (!hasInstalled) {
          counterObject.notInstalled++;
        }

        const ref = locals
          .officeDoc
          .ref
          .collection('Statuses')
          .doc(monthYearString)
          .collection('Employees')
          .doc(phoneNumber);

        if (docsCounter > 499) {
          docsCounter = 0;
          batchIndex++;
        }

        docsCounter++;

        const update = {
          statusObject: {
            [dateYesterday]: {
              distanceTravelled: distanceMap.get(phoneNumber) || 0,
            },
          },
        };

        batchArray[batchIndex].set(ref, update, {
          merge: true,
        });
      });

    await Promise
      .all(batchArray.map(batch => batch.commit()));

    await handleScheduleReport(locals, workbook);

    locals
      .messageObject
      .attachments
      .push({
        fileName: `Footprints Report_`
          + `${locals.officeDoc.get('office')}`
          + `_${momentToday.format(dateFormats.DATE)}.xlsx`,
        content: await workbook.outputAsync('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

    console.log(JSON.stringify({
      office,
      report: reportNames.FOOTPRINTS,
      to: locals.messageObject.to,
    }, ' ', 2));

    if (!env.isProduction
      /** No activities yesterday */
      || addendumDocsQueryResult.empty) {
      return;
    }

    await locals
      .sgMail
      .sendMultiple(locals.messageObject);

    const todayFromTimer = locals
      .change
      .after
      .get('timestamp');
    const momentFromTimer = momentTz(todayFromTimer)
      .tz(timezone)
      .startOf('day');
    const isDateToday = momentToday
      .startOf('day')
      .valueOf() === momentFromTimer
        .startOf('day')
        .valueOf();

    if (!isDateToday) {
      return;
    }

    const dailyStatusDocsQueryResult = await rootCollections
      .inits
      .where('report', '==', reportNames.DAILY_STATUS_REPORT)
      .where('date', '==', momentYesterday.date())
      .where('month', '==', momentYesterday.month())
      .where('year', '==', momentYesterday.year())
      .limit(1)
      .get();

    const doc = dailyStatusDocsQueryResult.docs[0];
    const oldCountsObject = doc.get('countsObject') || {};
    oldCountsObject[office] = counterObject;

    return doc
      .ref
      .set({
        countsObject: oldCountsObject,
      }, {
        merge: true,
      });
  } catch (error) {
    console.error(error);
  }
};
