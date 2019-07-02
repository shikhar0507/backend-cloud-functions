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
  sendSMS,
  getRegistrationToken,
} = require('../../admin/utils');
const env = require('../../admin/env');
const admin = require('firebase-admin');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');

const getComment = (doc) => {
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

  if (action === httpsActions.create) {
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

const handleNotifications = (locals) => {
  if (!locals.sendNotifications) {
    return Promise.resolve();
  }

  const yesterdaysDate = locals.momentYesterday.date();
  const promises = [];
  const body = `You were inactive on`
    + ` ${locals.momentYesterday.format(dateFormats.DATE)}`
    + ` Please mark On Duty or a Leave`;
  const startTime = momentTz().startOf('day').valueOf();
  const officeName = locals.officeDoc.get('office');
  const employeesData = locals.employeesData;
  const payrollObject = {
    data: [{
      office: officeName,
      template: 'leave',
      schedule: [{
        name: 'Leave Dates',
        startTime,
        endTime: startTime,
      }],
      attachment: {
        'Number Of Days': {
          value: 1,
          type: 'number',
        },
      },
    }, {
      office: officeName,
      template: 'on duty',
      schedule: [{
        name: 'Duty Date',
        startTime,
        endTime: startTime,
      }],
    }],
    title: 'Alert',
    body,
  };

  locals
    .regTokenMap
    .forEach((token, phoneNumber) => {
      const statusObject = locals.statusObjectMap.get(phoneNumber);

      // if (statusObject[yesterdaysDate].onDuty
      if (statusObject[yesterdaysDate].onAr
        || statusObject[yesterdaysDate].onLeave
        || statusObject[yesterdaysDate].holiday
        || statusObject[yesterdaysDate].weeklyOff
        || statusObject[yesterdaysDate].firstAction
        || statusObject[yesterdaysDate].lastAction
        /** Should be an employee. Non-employees should not get notifications */
        || !employeesData[phoneNumber]
        /**
         * Tokens are not set for people who have done something during the day
         * OR they have not installed the app
         * OR they have not used the app for quite a while (i.e., they last used the app
         * before we implemented notifications)
         */
        || !token) {
        return;
      }

      const promise = admin
        .messaging()
        .sendToDevice(token, {
          data: {
            payroll: JSON.stringify(payrollObject),
          },
          notification: {
            body,
            title: 'Growthfile',
          },
        });

      promises.push(promise);
    });

  return Promise.all(promises);
};

const getSMSText = (numberOfDays = 1) => {
  if (numberOfDays === 1) {
    return `You did not mark your attendance yesterday. Join now`
      + ` to avoid loss of pay ${env.downloadUrl}`;
  }

  return `You have not marked your attendance for ${numberOfDays}`
    + ` days. Join now to avoid loss of pay ${env.downloadUrl}`;
};

const getNumberOfDays = (statusObject, yesterdaysDate) => {
  let result = 0;

  for (let date = 1; date <= yesterdaysDate; date++) {
    if (!statusObject[date] || !statusObject[date].notInstalled) {
      continue;
    }

    result++;
  }

  return result;
};

const handleSms = (locals) => {
  if (!locals.sendSMS) {
    return Promise.resolve();
  }

  const promises = [];
  const yesterdaysDate = locals.momentYesterday.date();
  const employeesData = locals.employeesData;

  locals
    .notInstalledSet
    .forEach((phoneNumber) => {
      /** Only employees receive sms */
      if (!employeesData[phoneNumber]) {
        return;
      }

      const statusObject = locals.statusObjectMap.get(phoneNumber);
      const numberOfDays = getNumberOfDays(statusObject, yesterdaysDate);
      const smsText = getSMSText(numberOfDays);
      const promise = sendSMS(phoneNumber, smsText);

      promises.push(promise);
    });

  return Promise.all(promises);
};

const getTopHeaders = (momentYesterday) => {
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

const getMonthlyDocRef = (phoneNumber, monthlyDocRef) =>
  monthlyDocRef.get(phoneNumber);

const getStatusObject = (statusObjectMap, phoneNumber) =>
  statusObjectMap.get(phoneNumber) || {};

const commitMultipleBatches = batchesArray => {
  let result = Promise.resolve();

  batchesArray.forEach((batch, index) => {
    result = batch
      .commit()
      .then(() => console.log(`Commited: ${index}`))
      .catch((error) => console.error('BatchError:', error));
  });

  return result;
};

const handleSheetTwo = locals => {
  const mtdSheet = locals.worksheet.addSheet('Footprints MTD');
  mtdSheet.row(0).style('bold', true);

  const employeesData = locals.employeesData;
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const firstActionPromises = [];
  const lastActionPromises = [];
  const yesterdaysDate = locals.momentYesterday.date();
  const month = locals.momentYesterday.month();
  const year = locals.momentYesterday.year();
  const phoneNumbersByQueryIndex = [];
  const topValues = getTopHeaders(locals.momentYesterday);
  const batchesArray = [];
  let currentBatchIndex = 0;
  let numberOfDocsInCurrentBatch = 0;
  batchesArray.push(db.batch());

  topValues.forEach((value, index) => {
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
        statusObject[yesterdaysDate].holiday = true;
      }

      locals.statusObjectMap.set(phoneNumber, statusObject);
      firstActionPromises.push(firstActionPromise);
      lastActionPromises.push(lastActionPromise);
      phoneNumbersByQueryIndex.push(phoneNumber);
    });

  return Promise
    .all(firstActionPromises)
    .then(snapShots => {
      let batch = batchesArray[currentBatchIndex];

      snapShots.forEach((snapShot, index) => {
        numberOfDocsInCurrentBatch++;

        if (numberOfDocsInCurrentBatch === 499) {
          currentBatchIndex++;

          batchesArray.push(db.batch());

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
          locals.statusObjectMap.set(phoneNumber, statusObject);

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

        const doc = snapShot.docs[0];
        const timestamp = doc.get('timestamp');
        const firstAction = timeStringWithOffset({
          timezone,
          timestampToConvert: timestamp,
          format: dateFormats.TIME,
        });

        statusObject[yesterdaysDate].firstAction = firstAction;
        locals.statusObjectMap.set(phoneNumber, statusObject);

        batch.set(monthlyDocRef, {
          statusObject,
          phoneNumber,
          month,
          year,
        }, {
            merge: true,
          });
      });

      return Promise.all(lastActionPromises);
    })
    .then(snapShots => {
      numberOfDocsInCurrentBatch = 0;
      currentBatchIndex++;
      batchesArray.push(db.batch());

      let batch = batchesArray[currentBatchIndex];

      snapShots.forEach((snapShot, index) => {
        numberOfDocsInCurrentBatch++;

        if (numberOfDocsInCurrentBatch === 499) {
          currentBatchIndex++;

          batchesArray.push(db.batch());

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
          locals.statusObjectMap.set(phoneNumber, statusObject);

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

        const doc = snapShot.docs[0];
        const timestamp = doc.get('timestamp');
        const lastAction = timeStringWithOffset({
          timezone,
          timestampToConvert: timestamp,
          format: dateFormats.TIME,
        });

        statusObject[yesterdaysDate].lastAction = lastAction;
        locals.statusObjectMap.set(phoneNumber, statusObject);

        batch.set(monthlyDocRef, {
          statusObject,
          phoneNumber,
          month,
          year,
        }, {
            merge: true,
          });
      });

      return commitMultipleBatches(batchesArray);
      // return Promise
      //   .all(batchesArray.map(batch => batch.commit()));
    })
    .then(() => {
      locals
        .employeePhoneNumbersArray
        .forEach((phoneNumber, outerIndex) => {
          const columnIndex = outerIndex + 2;
          let ALPHABET_INDEX_START = 5;
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

            const { firstAction, lastAction } = statusObject[date] || {};
            const statusValueOnDate = (() => {
              if (date === yesterdaysDate) {
                if (locals.onLeaveSet.has(phoneNumber)) {
                  return 'LEAVE';
                }

                if (locals.onArSet.has(phoneNumber)) {
                  return 'ON DUTY';
                }

                if (locals.holidaySet.has(phoneNumber)) {
                  return 'HOLIDAY';
                }

                if (locals.weeklyOffSet.has(phoneNumber)) {
                  return 'WEEKLY OFF';
                }

                if (locals.holidaySet.has(phoneNumber)) {
                  return 'HOLIDAY';
                }

                if (firstAction) {
                  return `${firstAction} | ${lastAction || firstAction}`;
                }

                if (locals.notInstalledSet.has(phoneNumber)) {
                  return 'NOT INSTALLED';
                }

                return 'NOT ACTIVE';
              }

              if (statusObject[date].onLeave) {
                return 'LEAVE';
              }

              if (statusObject[date].onAr) {
                return 'ON DUTY';
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
                return `${firstAction} | ${lastAction || firstAction}`;
              }

              return 'NOT ACTIVE';
            })();

            const alphabet = alphabetsArray[ALPHABET_INDEX_START];
            const cell = `${alphabet}${columnIndex}`;
            mtdSheet.cell(cell).value(statusValueOnDate);

            ALPHABET_INDEX_START++;
          }
        });

      return locals.worksheet.outputAsync('base64');
    })
    .catch(console.error);
};


module.exports = (locals) => {
  let lastIndex = 1;
  let worksheet;
  let footprintsSheet;
  let dailyStatusDoc;
  let addendumDocs;
  let monthlyDocs;
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const todayFromTimer = locals.change.after.get('timestamp');
  const momentToday = momentTz().tz(timezone);
  const momentFromTimer = momentTz(todayFromTimer)
    .tz(timezone)
    .startOf('day');
  const momentYesterday = momentTz(todayFromTimer)
    .tz(timezone)
    .subtract(1, 'day')
    .startOf('day');
  /** Today's date */
  const dateString = momentFromTimer.format(dateFormats.DATE);
  /** Date shown in the first column (minus 1 day) */
  const dated = momentYesterday.format(dateFormats.DATE);
  const yesterdaysDate = momentYesterday.date();
  /**
   * Date from the timestamp which was written to the recipient
   * document for triggering the report.
   */
  const isDateToday = momentToday
    .startOf('day')
    .valueOf() === momentFromTimer
      .startOf('day')
      .valueOf();
  const office = locals.officeDoc.get('office');
  const employeesData = locals.employeesData;
  const employeePhoneNumbersArray = Object.keys(employeesData);
  const activeUsersSet = new Set();
  const regTokenFetchPromises = [];
  const regTokenMap = new Map();
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
        workbook,
      ] = result;

      worksheet = workbook;
      addendumDocs = addendumDocsQuery;
      monthlyDocs = monthlyDocsQuery;
      dailyStatusDoc = dailyStatusDocsQuery;

      const yesterdayStartTimestamp = momentYesterday.startOf('day').valueOf();
      const yesterdayEndTimestamp = momentYesterday.endOf('day').valueOf();

      branchDocsQuery.forEach(branchDoc => {
        branchDoc.get('schedule').forEach((schedule) => {
          if (schedule.startTime >= yesterdayStartTimestamp
            && schedule.endTime < yesterdayEndTimestamp) {
            branchesWithHoliday.add(branchDoc.get('attachment.Name.value'));
          }
        });
      });

      employeePhoneNumbersArray.forEach((phoneNumber) => {
        regTokenFetchPromises.push(
          getRegistrationToken(phoneNumber)
        );
      });

      return Promise.all(regTokenFetchPromises);
    })
    .then((tokensSnapShot) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      tokensSnapShot.forEach((item) => {
        const { phoneNumber, registrationToken, updatesDocExists } = item;

        regTokenMap.set(phoneNumber, registrationToken);

        /** For checking if auth exists */
        if (!updatesDocExists) {
          notInstalledSet.add(phoneNumber);
        }
      });

      monthlyDocs.forEach((doc) => {
        const { phoneNumber, statusObject } = doc.data();

        if (!statusObject[yesterdaysDate]) {
          statusObject[yesterdaysDate] = {
            firstAction: '',
            lastAction: '',
          };
        }

        if (statusObject[yesterdaysDate].onLeave) {
          onLeaveSet.add(phoneNumber);
        }

        if (statusObject[yesterdaysDate].onAr) {
          onArSet.add(phoneNumber);
        }

        if (statusObject[yesterdaysDate].holiday) {
          holidaySet.add(phoneNumber);
        }

        if (statusObject[yesterdaysDate].weeklyOff) {
          weeklyOffSet.add(phoneNumber);
        }

        const yesterdaysDayName = weekdaysArray[momentYesterday.day()];

        /**
         * employeesData[phoneNumber]: This check is required because the monthly
         * doc might exist for someone who is not a employee.
         */
        if (employeesData[phoneNumber]
          && employeesData[phoneNumber]['Weekly Off'] === yesterdaysDayName) {
          statusObject[yesterdaysDate].weeklyOff = true;
          weeklyOffSet.add(phoneNumber);
        }

        monthlyDocRefsMap.set(phoneNumber, doc.ref);
        statusObjectMap.set(phoneNumber, statusObject);
      });

      if (addendumDocs.empty) {
        locals.sendMail = false;
      }

      footprintsSheet = worksheet.addSheet('Footprints');
      /** Default sheet */
      worksheet.deleteSheet('Sheet1');

      footprintsSheet.row(1).style('bold', true);
      footprintsSheet.cell(`A1`).value('Dated');
      footprintsSheet.cell('B1').value('Employee Name');
      footprintsSheet.cell('C1').value('Employee Contact');
      footprintsSheet.cell('D1').value('Employee Code');
      footprintsSheet.cell('E1').value('Time');
      footprintsSheet.cell('F1').value('Distance Travelled');
      footprintsSheet.cell('G1').value('Address');
      footprintsSheet.cell('H1').value('Comment');
      footprintsSheet.cell('I1').value('Department');
      footprintsSheet.cell('J1').value('Base Location');

      /**
       * Not using count param from the `callback` function because
       * skipping supportRequest addendum docs intereferes with
       * the actual count resulting in blank lines.
       */
      let count = 0;
      const distanceMap = new Map();

      addendumDocs.forEach(doc => {
        const template = doc.get('activityData.template');
        const action = doc.get('action');
        const isSupportRequest = doc.get('isSupportRequest');
        const columnIndex = count + 2;

        /** Activities created by the app */
        if (isSupportRequest) {
          return;
        }

        if (action === httpsActions.create) {
          counterObject.activitiesCreated++;
        }

        count++;

        const phoneNumber = doc.get('user');

        activeUsersSet.add(phoneNumber);

        if (action === httpsActions.install) {
          installedSet.add(phoneNumber);
        }

        if (action === httpsActions.signup) {
          signedUpSet.add(phoneNumber);
        }

        const employeeObject = employeeInfo(employeesData, phoneNumber);
        const name = employeeObject.name;
        const department = employeeObject.department;
        const baseLocation = employeeObject.baseLocation;
        const url = (() => {
          if (template !== 'check-in' || action !== httpsActions.create) {
            return doc.get('url');
          }

          const venue = doc.get('activityData.venue')[0];

          if (!venue.location) {
            return doc.get('url');
          }

          return toMapsUrl(venue.geopoint);
        })();
        const identifier = (() => {
          if (template !== 'check-in' || action !== httpsActions.create) {
            return doc.get('identifier');
          }

          const venue = doc.get('activityData.venue')[0];

          if (!venue.location) {
            return doc.get('identifier');
          }

          return venue.location;
        })();
        const time = timeStringWithOffset({
          timezone,
          timestampToConvert: doc.get('timestamp'),
        });
        const employeeCode = employeeObject.employeeCode;
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
          distanceMap.set(phoneNumber, value);

          return value.toFixed(2);
        })();

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

      employeePhoneNumbersArray.forEach((phoneNumber) => {
        if (!monthlyDocRefsMap.has(phoneNumber)) {
          monthlyDocRefsMap
            .set(
              phoneNumber,
              locals.officeDoc.ref.collection('Monthly').doc()
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
            return 'ON DUTY';
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

        const statusObject = getStatusObject(statusObjectMap, phoneNumber);

        if (!statusObject[yesterdaysDate]) {
          statusObject[yesterdaysDate] = {
            firstAction: '',
            lastAction: '',
          };
        }

        if (comment === 'LEAVE') {
          counterObject.onLeaveWeeklyOffHoliday++;
          onLeaveSet.add(phoneNumber);
        }

        if (comment === 'ON DUTY') {
          counterObject.onLeaveWeeklyOffHoliday++;
          onArSet.add(phoneNumber);
        }

        if (comment === 'HOLIDAY') {
          counterObject.onLeaveWeeklyOffHoliday++;
          holidaySet.add(phoneNumber);
        }

        if (comment === 'WEEKLY OFF') {
          counterObject.onLeaveWeeklyOffHoliday++;
          weeklyOffSet.add(phoneNumber);
        }

        if (comment === 'NOT INSTALLED') {
          statusObject[yesterdaysDate].notInstalled = true;
          notInstalledSet.add(phoneNumber);
        }

        if (comment === 'NOT ACTIVE') {
          counterObject.notActive++;
          statusObject[yesterdaysDate].notActive = true;
        }

        statusObjectMap.set(phoneNumber, statusObject);

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

      locals.onArSet = onArSet;
      locals.worksheet = worksheet;
      locals.onLeaveSet = onLeaveSet;
      locals.holidaySet = holidaySet;
      locals.weeklyOffSet = weeklyOffSet;
      locals.momentYesterday = momentYesterday;
      locals.statusObjectMap = statusObjectMap;
      locals.notInstalledSet = notInstalledSet;
      locals.monthlyDocRefsMap = monthlyDocRefsMap;
      locals.employeePhoneNumbersArray = employeePhoneNumbersArray;
      locals.branchesWithHoliday = branchesWithHoliday;
      locals.regTokenMap = regTokenMap;
      counterObject.active = activeUsersSet.size;
      counterObject.notInstalled = notInstalledSet.size;

      return handleSheetTwo(locals);
    })
    .then(content => {
      if (locals.createOnlyData) {
        locals.sendMail = false;
      }

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
        return Promise.resolve();
      }

      const doc = dailyStatusDoc.docs[0];
      const oldCountsObject = doc.get('countsObject') || {};
      oldCountsObject[office] = counterObject;

      return doc
        .ref
        .set({
          countsObject: oldCountsObject,
        }, {
            merge: true,
          });
    })
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      /** SMS and Notifications shouldn't be sent from non-production. */
      if (!isDateToday || !env.isProduction) {
        return Promise.resolve();
      }

      return Promise
        .all([
          handleNotifications(locals),
          handleSms(locals),
        ]);
    })
    .catch(console.error);
};
