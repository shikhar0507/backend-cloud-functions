'use strict';

const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  reportNames,
  httpsActions,
  dateFormats,
} = require('../../admin/constants');
const {
  toMapsUrl,
  alphabetsArray,
  employeeInfo,
  timeStringWithOffset,
} = require('./report-utils');

const msToMin = ms => {
  let seconds = Math.floor(ms / 1000);
  let minute = Math.floor(seconds / 60);

  seconds = seconds % 60;
  minute = minute % 60;

  return minute;
};

const isDiffLessThanFiveMinutes = (first, second) => {
  return msToMin(Math.abs(first - second)) <= 5;
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
    return ``;
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

  if (doc.get('template') === 'enquiry') {
    return `${doc.get('user')} submitted an enquiry for the product:`
      + ` ${doc.get('activityData.attachment.Product.value')}`;
  }

  // action is 'comment'
  return doc.get('comment');
};

const getUrl = doc => {
  const venue = doc
    .get('activityData.venue');

  if (venue && venue[0] && venue[0].location) {
    return toMapsUrl(venue[0].geopoint);
  }

  if (doc.get('venueQuery')
    && doc.get('venueQuery').location) {
    return toMapsUrl(doc.get('venueQuery').geopoint);
  }

  return doc.get('url') || '';
};

const getIdentifier = doc => {
  const venue = doc
    .get('activityData.venue');

  if (venue && venue[0] && venue[0].location) {
    return venue[0].location;
  }

  if (doc.get('venueQuery')
    && doc.get('venueQuery').location) {
    return doc
      .get('venueQuery')
      .location;
  }

  return doc.get('identifier');
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
      'Distance Travelled',
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
      const {
        name,
        department,
        baseLocation,
        employeeCode,
      } = employeeInfo(locals.employeesData, phoneNumber);
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

      footprintsSheet
        .cell(`H${columnIndex}`)
        .value(getComment(doc));
      footprintsSheet
        .cell(`I${columnIndex}`)
        .value(department);
      footprintsSheet
        .cell(`J${columnIndex}`)
        .value(baseLocation);
    });

    counterObject.active = distanceMap.size;
    counterObject.notActive = counterObject.totalUsers - counterObject.active;

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

    await Promise
      .all(batchArray.map(batch => batch.commit()));

    console.log(JSON.stringify({
      office,
      report: reportNames.FOOTPRINTS,
      to: locals.messageObject.to,
    }, ' ', 2));

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
    const isDateToday = momentToday.startOf('day').valueOf() === momentFromTimer.startOf('day').valueOf();

    console.log('isDateToday:', isDateToday);

    if (!isDateToday) {
      return Promise
        .resolve();
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
