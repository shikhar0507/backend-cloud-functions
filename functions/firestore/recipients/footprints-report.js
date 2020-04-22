/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const { rootCollections } = require('../../admin/admin');
const env = require('../../admin/env');
const {
  reportNames,
  httpsActions,
  dateFormats,
  subcollectionNames,
} = require('../../admin/constants');
const {
  getName,
  alphabetsArray,
  getUrl,
  getIdentifier,
} = require('./report-utils');

const isDiffLessThanFiveMinutes = (first, second) => {
  if (!first || !second) {
    return false;
  }

  return Math.abs(momentTz(second).diff(first, 'minute')) < 5;
};

const getComment = doc => {
  if (doc.get('activityData.attachment.Comment.value')) {
    return doc.get('activityData.attachment.Comment.value');
  }

  const { potentialSameDevices = [], action } = doc.data();

  if (action === httpsActions.signup) {
    return `Signed up on Growthfile`;
  }

  if (
    action === httpsActions.install &&
    potentialSameDevices &&
    potentialSameDevices.length > 0
  ) {
    return (
      `Installed Growthfile.` +
      ` Users using the same phones: ${potentialSameDevices}`
    );
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
      return (
        `${doc.get('activityData.attachment.Product.value')}` +
        ` ${doc.get('activityData.attachment.Enquiry.value')}`
      );
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

    return (
      `${numbersString.toUpperCase()}` + ` ${doc.get('activityData.template')}`
    );
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
  const timestampFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentFromTimer = momentTz(timestampFromTimer).tz(timezone);
  const timestampMinus24Hours = momentFromTimer
    .clone()
    .startOf('day')
    .subtract(24, 'hours');
  const timestampPlus24Hours = momentFromTimer
    .clone()
    .endOf('day')
    .add(24, 'hours');
  const monthYearString = momentFromTimer.format(dateFormats.MONTH_YEAR);

  const activities = await locals.officeDoc.ref
    .collection('Activities')
    .where('relevantTime', '>=', timestampMinus24Hours.valueOf())
    .where('relevantTime', '<=', timestampPlus24Hours.valueOf())
    .orderBy('relevantTime', 'desc')
    .get();

  if (activities.empty) {
    return;
  }

  const worksheet = workbook.addSheet(`Schedule ${monthYearString}`);

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
    'Check-In Times',
  ].forEach((field, index) => {
    worksheet.cell(`${alphabetsArray[index]}1`).value(field);
  });

  let index = 0;

  activities.forEach(doc => {
    if (doc.get('template') !== 'duty') {
      return;
    }

    const columnIndex = index + 2;
    const activityName = doc.get('activityName');
    // This is duty type
    const activityType = doc.get('attachment.Duty Type.value');
    const [schedule] = doc.get('schedule');
    const status = doc.get('status');
    const startTime = momentTz(schedule.startTime)
      .tz(timezone)
      .format(dateFormats.DATE_TIME);
    const endTime = momentTz(schedule.endTime)
      .tz(timezone)
      .format(dateFormats.DATE_TIME);
    const createdBy =
      doc.get('creator.displayName') || doc.get('creator.phoneNumber');
    const lastUpdatedOn = momentTz(doc.get('timestamp'))
      .tz(timezone)
      .format(dateFormats.DATE_TIME);
    const checkIns = doc.get('checkIns') || {};
    let checkInTimes = '';

    Object.keys(checkIns).forEach(phoneNumber => {
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

      checkInTimes +=
        `${name} (${firstCheckInFormatted}` +
        ` to ${lastCheckInFormatted}, ${timestamps.length})`;

      checkInTimes += '\n';
    });

    const customerName = doc.get('customerObject.Name');
    const customerCode = doc.get('customerObject.Customer Code');
    const customerAddress = doc.get('customerObject.address');
    const supervisor = getName(
      locals.employeesData,
      doc.get('attachment.Supervisor.value'),
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
      worksheet.cell(`${alphabetsArray[i]}${columnIndex}`).value(value);
    });

    index++;
  });

  if (index === 0) {
    workbook.deleteSheet(`Schedule ${monthYearString}`);
  }

  return;
};

const getValueFromRole = (doc, field) => {
  const { roleDoc, isSupportRequest, userDisplayName = '' } = doc.data();

  if (
    roleDoc &&
    roleDoc.attachment &&
    roleDoc.attachment[field] &&
    roleDoc.attachment[field].value
  ) {
    return roleDoc.attachment[field].value;
  }

  if (field === 'Name') {
    if (isSupportRequest) {
      return 'Growthfile Support';
    }

    return userDisplayName;
  }

  return '';
};

module.exports = async locals => {
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const timestampFromTimer = locals.change.after.get('timestamp');
  const momentToday = momentTz(timestampFromTimer).tz(timezone).startOf('day');
  const momentYesterday = momentToday.clone().subtract(1, 'day');
  const dated = momentYesterday.format(dateFormats.DATE);
  const office = locals.officeDoc.get('office');
  const distanceMap = new Map();
  const prevTemplateForPersonMap = new Map();
  const prevDocTimestampMap = new Map();
  const counterObject = {
    totalUsers: 0,
    active: 0,
    notActive: 0,
    notInstalled: 0,
    activitiesCreated: 0,
    /** People on Leave, Weekly Off or Holiday (from branch) */
    onLeaveWeeklyOffHoliday: 0,
  };

  const allCountsData = {
    office,
    /** Count of addendum */
    totalActions: 0,
    /** Count of phone numbers */
    totalUsers: 0,
    /** docs with isSupportRequest === true */
    totalSupport: 0,
    /** {[httpsAction]: [count]} */
    apiActions: {},
    /** {[template]: [count]} */
    templates: {},
    report: reportNames.FOOTPRINTS,
    timestamp: Date.now(),
    officeId: locals.officeDoc.id,
    date: momentYesterday.date(),
    month: momentYesterday.month(),
    year: momentYesterday.year(),
  };

  try {
    const [workbook, addendumDocsQueryResult] = await Promise.all([
      xlsxPopulate.fromBlankAsync(),
      locals.officeDoc.ref
        .collection(subcollectionNames.ADDENDUM)
        .where('date', '==', momentYesterday.date())
        .where('month', '==', momentYesterday.month())
        .where('year', '==', momentYesterday.year())
        .orderBy('user')
        .orderBy('timestamp')
        .get(),
    ]);

    if (addendumDocsQueryResult.empty) {
      return;
    }

    const footprintsSheet = workbook.addSheet('Footprints');
    /** Default sheet */
    workbook.deleteSheet('Sheet1');

    footprintsSheet.row(1).style('bold', true);

    [
      'Dated',
      'Employee Name',
      'Employee Contact',
      'Employee Code',
      'Designation',
      'Time',
      'Distance Travelled (in KM)',
      'Address',
      'Comment',
      'Department',
      'Base Location',
    ].forEach((field, index) => {
      footprintsSheet.cell(`${alphabetsArray[index]}1`).value(field);
    });

    let count = 0;

    allCountsData.totalActions = addendumDocsQueryResult.size;

    addendumDocsQueryResult.forEach(doc => {
      const action = doc.get('action');
      const template = doc.get('activityData.template');
      const isSupportRequest = doc.get('isSupportRequest');

      allCountsData.apiActions[action] = allCountsData.apiActions[action] || 0;
      allCountsData.apiActions[action]++;

      if (template) {
        allCountsData.templates[template] =
          allCountsData.templates[template] || 0;
        allCountsData.templates[template]++;
      }

      const columnIndex = count + 2;
      const phoneNumber = doc.get('user');
      const department = getValueFromRole(doc, 'Department');
      const baseLocation = getValueFromRole(doc, 'Base Location');
      const employeeCode = getValueFromRole(doc, 'Employee Code');

      if (isSupportRequest) {
        allCountsData.totalSupport++;
      }

      const name = getValueFromRole(doc, 'Name');
      const identifier = getIdentifier(doc);
      const url = getUrl(doc);
      const time = momentTz(doc.get('timestamp'))
        .tz(timezone)
        .format(dateFormats.TIME);
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

      const prevTemplateForPerson = prevTemplateForPersonMap.get(phoneNumber);
      const prevDocTimestamp = prevDocTimestampMap.get(phoneNumber);
      const timestampDiffLessThanFiveMinutes = isDiffLessThanFiveMinutes(
        prevDocTimestamp,
        doc.get('timestamp'),
      );
      const distanceFromPrevious = Math.floor(
        Number(doc.get('distanceTravelled') || 0),
      );

      if (action == httpsActions.create) {
        counterObject.activitiesCreated++;
      }

      /**
       * Checkins from the same location within 5 minutes are merged into
       * a single line. Only the first occurrence of the event is logged
       * in the excel file. All subsequent items are glossed over.
       */
      if (
        template === 'check-in' &&
        prevTemplateForPerson === 'check-in' &&
        timestampDiffLessThanFiveMinutes &&
        distanceFromPrevious === 0
      ) {
        return;
      }

      if (doc.get('action') === httpsActions.checkIn) {
        return;
      }

      count++;

      prevTemplateForPersonMap.set(phoneNumber, template);
      prevDocTimestampMap.set(phoneNumber, doc.get('timestamp'));

      footprintsSheet.cell(`A${columnIndex}`).value(dated);
      footprintsSheet.cell(`B${columnIndex}`).value(name);
      footprintsSheet.cell(`C${columnIndex}`).value(phoneNumber);
      footprintsSheet.cell(`D${columnIndex}`).value(employeeCode);

      footprintsSheet
        .cell(`E${columnIndex}`)
        .value(getValueFromRole(doc, 'Designation'));
      footprintsSheet.cell(`F${columnIndex}`).value(time);
      // distanceTravelled
      footprintsSheet.cell(`G${columnIndex}`).value(distanceTravelled);

      if (identifier && url) {
        footprintsSheet
          .cell(`H${columnIndex}`)
          .value(identifier)
          .style({
            fontColor: '0563C1',
            underline: true,
          })
          .hyperlink(url);
      } else {
        footprintsSheet.cell(`H${columnIndex}`).value('');
      }

      const comment = getComment(doc);

      if (
        template === 'check-in' &&
        doc.get('activityData.attachment.Photo.value').startsWith('http')
      ) {
        footprintsSheet
          .cell(`I${columnIndex}`)
          .value(comment)
          .style({
            fontColor: '0563C1',
            underline: true,
          })
          .hyperlink(doc.get('activityData.attachment.Photo.value'));
      } else {
        footprintsSheet.cell(`I${columnIndex}`).value(comment);
      }

      footprintsSheet.cell(`J${columnIndex}`).value(department);
      footprintsSheet.cell(`K${columnIndex}`).value(baseLocation);
    });

    allCountsData.totalUsers = distanceMap.size;
    counterObject.totalUsers = allCountsData.totalUsers;
    counterObject.active = distanceMap.size;
    counterObject.notActive = counterObject.totalUsers - counterObject.active;

    await handleScheduleReport(locals, workbook);

    locals.messageObject.attachments.push({
      fileName:
        `Footprints Report_` +
        `${locals.officeDoc.get('office')}` +
        `_${momentToday.format(dateFormats.DATE)}.xlsx`,
      content: await workbook.outputAsync('base64'),
      type: 'text/csv',
      disposition: 'attachment',
    });

    console.log(
      JSON.stringify(
        {
          office,
          report: reportNames.FOOTPRINTS,
          to: locals.messageObject.to,
        },
        ' ',
        2,
      ),
    );

    if (
      /** Not sending emails from non-production environment */
      !env.isProduction ||
      /** No activities yesterday */
      addendumDocsQueryResult.empty
    ) {
      return;
    }

    await locals.sgMail.sendMultiple(locals.messageObject);

    const momentFromTimer = momentTz(timestampFromTimer)
      .tz(timezone)
      .startOf('day');
    const isDateToday =
      momentToday.startOf('day').valueOf() ===
      momentFromTimer.startOf('day').valueOf();

    if (!isDateToday) {
      return;
    }

    const dailyStatusDocsQueryResult = await rootCollections.inits
      .where('report', '==', reportNames.DAILY_STATUS_REPORT)
      .where('date', '==', momentYesterday.date())
      .where('month', '==', momentYesterday.month())
      .where('year', '==', momentYesterday.year())
      .limit(1)
      .get();

    const [doc] = dailyStatusDocsQueryResult.docs;
    const oldCountsObject = doc.get('countsObject') || {};

    oldCountsObject[office] = counterObject;

    console.log(JSON.stringify(allCountsData, ' ', 2));

    await rootCollections.inits.doc().set(allCountsData);

    return doc.ref.set(
      {
        countsObject: oldCountsObject,
      },
      {
        merge: true,
      },
    );
  } catch (error) {
    console.error(error);
  }
};
