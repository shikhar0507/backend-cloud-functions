'use strict';

const momentTz = require('moment-timezone');
const {
  timeStringWithOffset,
  dateStringWithOffset,
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
const {
  toCustomerObject,
} = require('../activity/helper');
const env = require('../../admin/env');
const admin = require('firebase-admin');
const xlsxPopulate = require('xlsx-populate');



module.exports = (locals) => {
  let worksheet;
  let dsrSheet;
  let activityDocsArray;
  const office = locals.officeDoc.get('office');
  const employeesData = locals.officeDoc.get('employeesData');
  const todayFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentToday = momentTz(todayFromTimer).tz(timezone);
  const yesterdaysStartTime = momentToday.startOf('day').valueOf();
  const yesterdaysEndTime = momentToday.endOf('day').valueOf();
  const customerPromises = [];
  const customerDetailsMap = new Map();
  const customerAddendumPromises = [];
  const customersData = {};
  const visitDateMap = new Map();

  return Promise
    .all([
      rootCollections
        .activities
        .where('office', '==', office)
        .where('template', '==', reportNames.DSR)
        .where('createTimestamp', '>=', yesterdaysStartTime)
        .where('createTimestamp', '<=', yesterdaysEndTime)
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        activityDocsQuery,
        workbook,
      ] = result;

      activityDocsArray = activityDocsQuery.docs;
      worksheet = workbook;

      activityDocsArray.forEach((doc) => {
        const customerName = doc.get('attachment.Customer.value');
        const visitDateString = dateStringWithOffset({
          timezone,
          timestamp: doc.createTime.toDate().getTime(),
          format: dateFormats.TIME,
        });

        visitDateMap.set(doc.id, visitDateString);

        if (!customerName) return;

        const customerPromise = rootCollections
          .activities
          .where('office', '==', office)
          .where('attachment.Name.value', '==', customerName)
          .limit(1)
          .get();

        const addendumPromise = locals
          .officeDoc
          .ref
          .collection('Addendum')
          .orderBy('timestamp', 'desc')
          .where('activityId', '==', doc.id)
          .get();

        customerAddendumPromises.push(addendumPromise);

        customerPromises.push(customerPromise);
      });

      dsrSheet = worksheet.addSheet('DSR Sheet');
      dsrSheet.row(0).style('bold', true);

      [
        'Visit Date',
        'Employee',
        'Visit Location',
        'Customer Details',
        'Customer History',
        'Product Details',
        'Visit Time',
        'DSR Updated At',
        'DSR Updated From',
        'Follow Up Date',
        'State',
        'City',
        'Locality',
        'Employee Details',
      ].forEach((value, index) => {
        dsrSheet.cell(`${alphabetsArray[index]}1`).value(value);
      });

      return Promise.all(customerPromises);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        const doc = snapShot.docs[0];
        const name = doc.get('attachment.Name.value');

        customersData[name] = toCustomerObject(doc.data(), doc.createTime);
      });

      return Promise.all(customerAddendumPromises);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          const activityId = doc.get('activityId');
          const action = doc.get('action');

          if (action === httpsActions.create) return;

          const locationIdentifier = doc.get('identifier');
          const locationUrl = doc.get('url');

        });
      });

      return Promise.resolve();
    })
    .catch(console.error);
};
