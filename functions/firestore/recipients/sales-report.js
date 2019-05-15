'use strict';

const momentTz = require('moment-timezone');
const {
  dateStringWithOffset,
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
  // getRegistrationToken,
  adjustedGeopoint,
} = require('../../admin/utils');
const {
  toCustomerObject,
  toProductObject,
} = require('../activity/helper');
const env = require('../../admin/env');
const admin = require('firebase-admin');
const xlsxPopulate = require('xlsx-populate');

const customerHistoryCell = (creatorsNameOrNumber, createDateString, visitorName, lastVisitDateString) => {
  return `Creator: ${creatorsNameOrNumber} | Created On: ${createDateString}`
    + `, Last Visited By: ${visitorName},`
    + ` Last Visited On: ${lastVisitDateString}`;
};

const employeeDetailsCell = (employeeData) => {
  const supervisorsArray = [
    employeeData['First Supervisor'],
    employeeData['Second Supervisor'],
  ];

  return `Name: ${supervisorsArray.filter(Boolean)}`
    + ` | Department: ${employeeData.Department}`
    + ` | Base Location: ${employeeData['Base Location']}`;
};

const customerDetailsCell = (customerDoc, employeesData) => {
  const firstContact = customerDoc.get('attachment.First Contact.value');
  const secondContact = customerDoc.get('attachment.Second Contact.value');

  const Contacts = (() => {
    let string = '';
    const values = [];

    if (firstContact && employeesData[firstContact]) {
      values.push(employeesData[firstContact].Name);
    }

    if (firstContact && !employeesData[firstContact]) {
      values.push(firstContact);
    }

    if (secondContact && employeesData[secondContact]) {
      values.push(employeesData[secondContact].Name);
    }

    if (secondContact && !employeesData[secondContact]) {
      values.push(secondContact);
    }

    if (values.length === 1) {
      string += values;
    }

    if (values.length === 2) {
      string += `${values[0]} & ${values[1]}`;
    }

    return string;
  })();

  return {
    Name: customerDoc.get('attachment.Name.value'),
    Contacts,
  };
};

const productDetailsCell = (productsArray, comment) => {
  /** Some products could be left empty by the creator */
  return `Products: ${productsArray.filter(Boolean)} | Comment: ${comment}`;
};


module.exports = (locals) => {
  const timestampFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentToday = momentTz(timestampFromTimer).tz(timezone);
  const momentYesterday = momentToday.clone().subtract(1, 'day');
  const yesterdayStart = momentYesterday.startOf('day');
  const yesterdayEnd = momentYesterday.endOf('day');
  const visitDate = dateStringWithOffset({
    timestampToConvert: yesterdayStart.valueOf(),
    timezone,
  });

  let worksheet;
  let addendumDocs;


  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('activityData.forSalesReport', '==', true)
        .where('timestamp', '>=', yesterdayStart.valueOf())
        .where('timestamp', '<=', yesterdayEnd.valueOf())
        .orderBy('timestamp')
        .orderBy('user')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        docs,
        workbook,
      ] = result;

      worksheet = workbook;
      addendumDocs = docs;

      console.log('addendumDocs', addendumDocs.size);

      addendumDocs.forEach((doc) => {
        const template = doc.get('activityData.template');
        const geopoint = doc.get('location');
        const customerName = doc.get('activityData.attachment.Customer.value');
        const productOne = doc.get('activityData.attachment.Product 1.value');
        const productTwo = doc.get('activityData.attachment.Product 2.value');
        const productThree = doc.get('activityData.attachment.Product 3.value');
        const phoneNumber = doc.get('user');
        const timestamp = doc.get('timestamp');
        const followUpTimestamp = (() => {
          if (template === 'dsr') {
            return doc.get('activityData.schedule')[0].startTime;
          }

          return '';
        })();

        const followUpDate = dateStringWithOffset({
          timestampToConvert: followUpTimestamp,
          timezone,
        });
      });


      return Promise.all([]);
    })
    .catch(console.error);
};
