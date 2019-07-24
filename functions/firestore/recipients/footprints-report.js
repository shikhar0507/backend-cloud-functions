'use strict';

const {
  timeStringWithOffset,
  employeeInfo,
  toMapsUrl,
  alphabetsArray,
  weekdaysArray,
} = require('./report-utils');
const {
  httpsActions,
  reportNames,
  dateFormats,
} = require('../../admin/constants');
const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  getRegistrationToken,
} = require('../../admin/utils');
const env = require('../../admin/env');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');

const msToMin = ms => {
  let seconds = Math.floor(ms / 1000);
  let minute = Math.floor(seconds / 60);

  seconds = seconds % 60;
  minute = minute % 60;

  return minute;
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

    return `${numbersString.toUpperCase()} ${doc.get('activityData.template')}`;
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

const getTopHeaders = momentYesterday => {
  const result = [
    'Employee Name',
    'Employee Contact',
    'Department',
    'Base Location',
    'Live Since',
  ];

  const end = momentYesterday.date();

  for (let index = end; index >= 1; index--) {
    const stringValue = momentYesterday
      /**
       * Cloning the object is required since we do not want to modify
       * the existing momentYesterday object in memory.
       */
      .clone()
      .date(index)
      .format(dateFormats.MONTH_DATE);

    result.push(stringValue);
  }

  return result;
};

const getUrl = doc => {
  if (doc.get('venueQuery')
    && doc.get('venueQuery').location) {
    return toMapsUrl(doc.get('venueQuery').geopoint);
  }

  const venue = doc
    .get('activityData.venue');

  if (!venue || !venue[0] || !venue[0].location) {
    return doc
      .get('url');
  }

  return toMapsUrl(venue[0].geopoint);
};


const getIdentifier = doc => {
  if (doc.get('venueQuery')
    && doc.get('venueQuery').location) {
    return doc
      .get('venueQuery')
      .location;
  }

  const venue = doc
    .get('activityData.venue');

  if (!venue || !venue[0] || !venue[0].location) {
    return doc
      .get('identifier');
  }

  return venue[0]
    .location;
};

const getMonthlyDocRef = (phoneNumber, monthlyDocRef) =>
  monthlyDocRef
    .get(phoneNumber);

const getStatusObject = (statusObjectMap, phoneNumber) =>
  statusObjectMap
    .get(phoneNumber) || {};

const handleSheetTwo = locals => {
  const mtdSheet = locals
    .workbook
    .addSheet('Footprints MTD');
  mtdSheet
    .row(0)
    .style('bold', true);

  const employeesData = locals.employeesData;
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const firstActionPromises = [];
  const lastActionPromises = [];
  const yesterdaysDate = locals
    .momentYesterday
    .date();
  const month = locals
    .momentYesterday
    .month();
  const year = locals
    .momentYesterday
    .year();
  const phoneNumbersByQueryIndex = [];
  const topValues = getTopHeaders(locals.momentYesterday);
  const batchesArray = [];
  let currentBatchIndex = 0;
  let numberOfDocsInCurrentBatch = 0;
  batchesArray.push(db.batch());

  topValues
    .forEach((value, index) => {
      mtdSheet.cell(`${alphabetsArray[index]}1`).value(value);
    });

  locals
    .employeePhoneNumbersArray
    .forEach(phoneNumber => {
      const baseQuery = locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('date', '==', yesterdaysDate)
        .where('month', '==', month)
        .where('year', '==', year)
        .where('user', '==', phoneNumber);
      const firstActionPromise = baseQuery
        .orderBy('timestamp', 'asc')
        .limit(1)
        .get();
      const lastActionPromise = baseQuery
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      const statusObject = getStatusObject(
        locals.statusObjectMap,
        phoneNumber
      );
      const baseLocation = employeesData[phoneNumber]['Base Location'];

      if (locals.branchesWithHoliday.has(baseLocation)) {
        statusObject[
          yesterdaysDate
        ].holiday = true;
      }

      locals
        .statusObjectMap
        .set(phoneNumber, statusObject);
      firstActionPromises
        .push(firstActionPromise);
      lastActionPromises
        .push(lastActionPromise);
      phoneNumbersByQueryIndex
        .push(phoneNumber);
    });

  return Promise
    .all(firstActionPromises)
    .then(snapShots => {
      let batch = batchesArray[currentBatchIndex];

      snapShots
        .forEach((snapShot, index) => {
          numberOfDocsInCurrentBatch++;

          if (numberOfDocsInCurrentBatch === 499) {
            currentBatchIndex++;

            batchesArray
              .push(
                db.batch()
              );

            /** Batch reset to a new instance */
            numberOfDocsInCurrentBatch = 0;
            batch = batchesArray[currentBatchIndex];
          }

          const phoneNumber = phoneNumbersByQueryIndex[index];
          const statusObject = getStatusObject(
            locals.statusObjectMap,
            phoneNumber
          );
          const monthlyDocRef = getMonthlyDocRef(
            phoneNumber,
            locals.monthlyDocRefsMap
          );

          if (!statusObject[yesterdaysDate]) {
            statusObject[yesterdaysDate] = {
              firstAction: '',
              lastAction: '',
            };
          }

          if (snapShot.empty) {
            locals
              .statusObjectMap
              .set(phoneNumber, statusObject);

            batch.set(monthlyDocRef, {
              statusObject,
              phoneNumber,
              month,
              year,
            }, {
                merge: true,
              });

            return;
          }

          const doc = snapShot
            .docs[0];
          const timestamp = doc
            .get('timestamp');
          const firstAction = timeStringWithOffset({
            timezone,
            timestampToConvert: timestamp,
            format: dateFormats.TIME,
          });

          statusObject[
            yesterdaysDate
          ].firstAction = firstAction;
          locals
            .statusObjectMap
            .set(
              phoneNumber,
              statusObject
            );

          batch
            .set(monthlyDocRef, {
              statusObject,
              phoneNumber,
              month,
              year,
            }, {
                merge: true,
              });
        });

      return Promise
        .all(lastActionPromises);
    })
    .then(snapShots => {
      numberOfDocsInCurrentBatch = 0;
      currentBatchIndex++;
      batchesArray.push(db.batch());

      let batch = batchesArray[currentBatchIndex];

      snapShots
        .forEach((snapShot, index) => {
          numberOfDocsInCurrentBatch++;

          if (numberOfDocsInCurrentBatch === 499) {
            currentBatchIndex++;

            batchesArray
              .push(
                db.batch()
              );

            /** Batch resetted */
            numberOfDocsInCurrentBatch = 0;
            batch = batchesArray[currentBatchIndex];
          }

          const phoneNumber = phoneNumbersByQueryIndex[index];
          const statusObject = getStatusObject(
            locals.statusObjectMap,
            phoneNumber
          );
          const monthlyDocRef = getMonthlyDocRef(
            phoneNumber,
            locals.monthlyDocRefsMap
          );

          if (!statusObject[yesterdaysDate]) {
            statusObject[yesterdaysDate] = {
              firstAction: '',
              lastAction: '',
            };
          }

          if (snapShot.empty) {
            locals
              .statusObjectMap
              .set(
                phoneNumber,
                statusObject
              );

            batch
              .set(monthlyDocRef, {
                statusObject,
                phoneNumber,
                month,
                year,
              }, {
                  merge: true,
                });

            return;
          }

          const doc = snapShot
            .docs[0];
          const timestamp = doc
            .get('timestamp');
          const lastAction = timeStringWithOffset({
            timezone,
            timestampToConvert: timestamp,
            format: dateFormats.TIME,
          });

          statusObject[
            yesterdaysDate
          ].lastAction = lastAction;
          locals
            .statusObjectMap
            .set(
              phoneNumber,
              statusObject
            );

          batch
            .set(monthlyDocRef, {
              statusObject,
              phoneNumber,
              month,
              year,
            }, {
                merge: true,
              });
        });

      console.log('Writing data');

      return Promise
        .all(batchesArray.map(batch => batch.commit()));
    })
    .then(() => {
      console.log('Writing data complete');

      locals
        .employeePhoneNumbersArray
        .forEach((phoneNumber, outerIndex) => {
          let ALPHABET_INDEX_START = 5;
          const columnIndex = outerIndex + 2;
          const employeeObject = employeeInfo(employeesData, phoneNumber);
          const liveSince = timeStringWithOffset({
            timezone,
            format: dateFormats.DATE,
            timestampToConvert: employeesData[phoneNumber].createTime,
          });

          mtdSheet
            .cell(`A${columnIndex}`)
            .value(employeeObject.name);
          mtdSheet
            .cell(`B${columnIndex}`)
            .value(phoneNumber);
          mtdSheet
            .cell(`C${columnIndex}`)
            .value(employeeObject.department);
          mtdSheet
            .cell(`D${columnIndex}`)
            .value(employeeObject.baseLocation);
          mtdSheet
            .cell(`E${columnIndex}`)
            .value(liveSince);

          for (let date = yesterdaysDate; date >= 1; date--) {
            const statusObject = getStatusObject(
              locals.statusObjectMap,
              phoneNumber
            );

            if (!statusObject[date]) {
              statusObject[date] = {
                firstAction: '',
                lastAction: '',
              };
            }

            const {
              firstAction,
              lastAction,
            } = statusObject[date] || {};
            const statusValueOnDate = (() => {
              if (statusObject[date].onLeave) {
                return 'LEAVE';
              }

              if (statusObject[date].onAr) {
                return 'AR';
              }

              if (statusObject[date].holiday) {
                return 'HOLIDAY';
              }

              if (statusObject[date].weeklyOff) {
                return 'WEEKLY OFF';
              }

              if (statusObject[date].notInstalled) {
                return 'NOT INSTALLED';
              }

              if (firstAction) {
                return `${firstAction}`
                  + ` | ${lastAction || firstAction}`;
              }

              return 'NOT ACTIVE';
            })();

            const alphabet = alphabetsArray[ALPHABET_INDEX_START];
            const cell = `${alphabet}${columnIndex}`;
            mtdSheet
              .cell(cell)
              .value(statusValueOnDate);

            ALPHABET_INDEX_START++;
          }
        });

      return locals
        .workbook
        .outputAsync('base64');
    })
    .catch(console.error);
};

const isDiffLessThanFiveMinutes = (first, second) => {
  return msToMin(Math.abs(first - second)) <= 5;
};

module.exports = locals => {
  let lastIndex = 1;
  let workbook;
  let footprintsSheet;
  let dailyStatusDoc;
  let addendumDocs;
  let monthlyDocs;
  const timezone = locals
    .officeDoc
    .get('attachment.Timezone.value');
  const todayFromTimer = locals
    .change
    .after
    .get('timestamp');
  const momentToday = momentTz()
    .tz(timezone);
  const momentFromTimer = momentTz(todayFromTimer)
    .tz(timezone)
    .startOf('day');
  const momentYesterday = momentTz(todayFromTimer)
    .tz(timezone)
    .subtract(1, 'day')
    .startOf('day');
  /** Today's date */
  const dateString = momentFromTimer
    .format(dateFormats.DATE);
  /** Date shown in the first column (minus 1 day) */
  const dated = momentYesterday
    .format(dateFormats.DATE);
  const yesterdaysDate = momentYesterday
    .date();
  /**
   * Date from the timestamp which was written to the recipient
   * document for triggering the report.
   */
  const isDateToday = momentToday
    .startOf('day')
    .valueOf() === momentFromTimer
      .startOf('day')
      .valueOf();
  const office = locals
    .officeDoc
    .get('office');
  const employeesData = locals.employeesData;
  const employeePhoneNumbersArray = Object
    .keys(employeesData);
  const activeUsersSet = new Set();
  const regTokenFetchPromises = [];
  const installedSet = new Set();
  const signedUpSet = new Set();
  const onLeaveSet = new Set();
  const onArSet = new Set();
  const holidaySet = new Set();
  const weeklyOffSet = new Set();
  /** People who haven't installed the app */
  const notInstalledSet = new Set();
  const monthlyDocRefsMap = new Map();
  const statusObjectMap = new Map();
  const branchesWithHoliday = new Set();
  const counterObject = {
    totalUsers: employeePhoneNumbersArray.length,
    active: 0,
    notActive: 0,
    notInstalled: 0,
    activitiesCreated: 0,
    /** People on Leave, Weekly Off or Holiday (from branch) */
    onLeaveWeeklyOffHoliday: 0,
  };

  const prevTemplateForPersonMap = new Map();
  const prevDocTimestampMap = new Map();

  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('date', '==', momentYesterday.date())
        .where('month', '==', momentYesterday.month())
        .where('year', '==', momentYesterday.year())
        .orderBy('user')
        .orderBy('timestamp')
        .get(),
      locals
        .officeDoc
        .ref
        .collection('Monthly')
        .where('month', '==', momentYesterday.month())
        .where('year', '==', momentYesterday.year())
        .get(),
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'branch')
        .get(),
      rootCollections
        .inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', momentYesterday.date())
        .where('month', '==', momentYesterday.month())
        .where('year', '==', momentYesterday.year())
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then(result => {
      const [
        addendumDocsQuery,
        monthlyDocsQuery,
        branchDocsQuery,
        dailyStatusDocsQuery,
        wb,
      ] = result;

      workbook = wb;
      addendumDocs = addendumDocsQuery;
      monthlyDocs = monthlyDocsQuery;
      dailyStatusDoc = dailyStatusDocsQuery;

      const yesterdayStartTimestamp = momentYesterday
        .startOf('day')
        .valueOf();
      const yesterdayEndTimestamp = momentYesterday
        .endOf('day')
        .valueOf();

      branchDocsQuery
        .forEach(branchDoc => {
          branchDoc
            .get('schedule')
            .forEach(schedule => {
              if (schedule.startTime >= yesterdayStartTimestamp
                && schedule.endTime < yesterdayEndTimestamp) {
                branchesWithHoliday.add(
                  branchDoc.get('attachment.Name.value')
                );
              }
            });
        });

      employeePhoneNumbersArray
        .forEach(phoneNumber => {
          regTokenFetchPromises
            .push(
              getRegistrationToken(phoneNumber)
            );
        });

      return Promise
        .all(regTokenFetchPromises);
    })
    .then(tokensSnapShot => {
      if (!locals.sendMail) {
        return Promise
          .resolve();
      }

      tokensSnapShot
        .forEach(item => {
          const {
            phoneNumber,
            updatesDocExists,
          } = item;

          /** For checking if auth exists */
          if (!updatesDocExists) {
            notInstalledSet
              .add(phoneNumber);
          }
        });

      monthlyDocs
        .forEach(doc => {
          const { phoneNumber, statusObject } = doc.data();

          if (!statusObject[yesterdaysDate]) {
            statusObject[yesterdaysDate] = {
              firstAction: '',
              lastAction: '',
              distanceTravelled: 0,
            };
          }

          if (statusObject[yesterdaysDate].onLeave) {
            onLeaveSet
              .add(phoneNumber);
          }

          if (statusObject[yesterdaysDate].onAr) {
            onArSet
              .add(phoneNumber);
          }

          if (statusObject[yesterdaysDate].holiday) {
            holidaySet
              .add(phoneNumber);
          }

          if (statusObject[yesterdaysDate].weeklyOff) {
            weeklyOffSet
              .add(phoneNumber);
          }

          const yesterdaysDayName = weekdaysArray[momentYesterday.day()];

          /**
           * employeesData[phoneNumber]: This check is required because the monthly
           * doc might exist for someone who is not a employee currently.
           */
          if (employeesData[phoneNumber]
            && employeesData[phoneNumber]['Weekly Off'] === yesterdaysDayName) {
            statusObject[
              yesterdaysDate
            ].weeklyOff = true;
            weeklyOffSet
              .add(phoneNumber);
          }

          monthlyDocRefsMap
            .set(phoneNumber, doc.ref);
          statusObjectMap
            .set(phoneNumber, statusObject);
        });

      if (addendumDocs.empty) {
        locals
          .sendMail = false;
      }

      footprintsSheet = workbook
        .addSheet('Footprints');
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

      /**
       * Not using count param from the `callback` function because
       * skipping supportRequest addendum docs intereferes with
       * the actual count resulting in blank lines.
       */
      let count = 0;
      const distanceMap = new Map();

      addendumDocs
        .forEach(doc => {
          const action = doc.get('action');
          const isSupportRequest = doc.get('isSupportRequest');
          const columnIndex = count + 2;
          const phoneNumber = doc.get('user');

          /** Activities created by the app */
          if (isSupportRequest) {
            return;
          }

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

          count++;

          if (action === httpsActions.create) {
            counterObject.activitiesCreated++;
          }

          activeUsersSet
            .add(phoneNumber);

          if (action === httpsActions.install) {
            installedSet
              .add(phoneNumber);
          }

          if (action === httpsActions.signup) {
            signedUpSet
              .add(phoneNumber);
          }

          const {
            name,
            department,
            baseLocation,
            employeeCode,
          } = employeeInfo(employeesData, phoneNumber);

          const identifier = getIdentifier(doc);
          const url = getUrl(doc);
          const time = timeStringWithOffset({
            timezone,
            timestampToConvert: doc.get('timestamp'),
          });

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

          lastIndex = columnIndex;
        });

      employeePhoneNumbersArray
        .forEach(phoneNumber => {
          const statusObject = getStatusObject(statusObjectMap, phoneNumber);

          statusObject[yesterdaysDate] = statusObject[yesterdaysDate] || {
            firstAction: '',
            lastAction: '',
            distanceTravelled: distanceMap.get(phoneNumber) || 0,
          };

          statusObjectMap
            .set(
              phoneNumber,
              statusObject
            );

          if (!monthlyDocRefsMap.has(phoneNumber)) {
            monthlyDocRefsMap
              .set(
                phoneNumber,
                locals
                  .officeDoc
                  .ref
                  .collection('Monthly')
                  .doc()
              );
          }

          if (activeUsersSet.has(phoneNumber)) {
            return;
          }

          /**
           * Increment before adding more data is required. Not doing that will
           * overwrite the last entry of the sheet that was added in the loop above.
           */
          lastIndex++;

          const comment = (() => {
            if (onLeaveSet.has(phoneNumber)) {
              return 'LEAVE';
            }

            if (onArSet.has(phoneNumber)) {
              return 'AR';
            }

            if (holidaySet.has(phoneNumber)) {
              return 'HOLIDAY';
            }

            if (weeklyOffSet.has(phoneNumber)) {
              return 'WEEKLY OFF';
            }

            if (notInstalledSet.has(phoneNumber)) {
              return 'NOT INSTALLED';
            }

            return 'NOT ACTIVE';
          })();

          if (comment === 'LEAVE') {
            counterObject
              .onLeaveWeeklyOffHoliday++;
            onLeaveSet.add(phoneNumber);
          }

          if (comment === 'ON AR') {
            counterObject
              .onLeaveWeeklyOffHoliday++;
            onArSet.add(phoneNumber);
          }

          if (comment === 'HOLIDAY') {
            counterObject
              .onLeaveWeeklyOffHoliday++;
            holidaySet.add(phoneNumber);
          }

          if (comment === 'WEEKLY OFF') {
            counterObject
              .onLeaveWeeklyOffHoliday++;
            weeklyOffSet.add(phoneNumber);
          }

          if (comment === 'NOT INSTALLED') {
            statusObject[
              yesterdaysDate
            ].notInstalled = true;

            notInstalledSet
              .add(phoneNumber);
          }

          if (comment === 'NOT ACTIVE') {
            counterObject
              .notActive++;
            statusObject[
              yesterdaysDate
            ].notActive = true;
          }

          statusObjectMap
            .set(
              phoneNumber,
              statusObject
            );

          const {
            name,
            employeeCode,
            department,
            baseLocation,
          } = employeeInfo(employeesData, phoneNumber);

          footprintsSheet
            .cell(`A${lastIndex}`)
            .value(dated);
          footprintsSheet
            .cell(`B${lastIndex}`)
            .value(name);
          footprintsSheet
            .cell(`C${lastIndex}`)
            .value(phoneNumber);
          footprintsSheet
            .cell(`D${lastIndex}`)
            .value(employeeCode);
          footprintsSheet
            .cell(`E${lastIndex}`)
            .value('');
          footprintsSheet
            .cell(`F${lastIndex}`)
            .value('');
          footprintsSheet
            .cell(`G${lastIndex}`)
            .value('');
          footprintsSheet
            .cell(`H${lastIndex}`)
            .value(comment);
          footprintsSheet
            .cell(`I${lastIndex}`)
            .value(department);
          footprintsSheet
            .cell(`J${lastIndex}`)
            .value(baseLocation);
        });

      locals
        .onArSet = onArSet;
      locals
        .workbook = workbook;
      locals
        .onLeaveSet = onLeaveSet;
      locals
        .holidaySet = holidaySet;
      locals
        .weeklyOffSet = weeklyOffSet;
      locals
        .momentYesterday = momentYesterday;
      locals
        .statusObjectMap = statusObjectMap;
      locals
        .notInstalledSet = notInstalledSet;
      locals
        .monthlyDocRefsMap = monthlyDocRefsMap;
      locals
        .employeePhoneNumbersArray = employeePhoneNumbersArray;
      locals
        .branchesWithHoliday = branchesWithHoliday;
      counterObject
        .active = activeUsersSet.size;
      counterObject
        .notInstalled = notInstalledSet.size;

      return handleSheetTwo(locals);
    })
    .then(content => {
      if (locals.createOnlyData) {
        locals
          .sendMail = false;
      }

      if (!locals.sendMail) {
        return Promise
          .resolve();
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
          fileName: `Footprints ${office}_Report_${dateString}.xlsx`,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log({
        office,
        report: reportNames.FOOTPRINTS,
        to: locals.messageObject.to,
      });

      return locals
        .sgMail
        .sendMultiple(locals.messageObject);
    })
    .then(() => {
      /** Counter docs doesn't exist in non-production project */
      if (!isDateToday || !env.isProduction) {
        return Promise
          .resolve();
      }

      const doc = dailyStatusDoc
        .docs[0];
      const oldCountsObject = doc
        .get('countsObject') || {};
      oldCountsObject[office] = counterObject;

      return doc
        .ref
        .set({
          countsObject: oldCountsObject,
        }, {
            merge: true,
          });
    })
    .catch(console.error);
};
