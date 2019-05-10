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
  let worksheet;
  let dsrSheet;
  let addendumDocsArray;
  const office = locals.officeDoc.get('office');
  const employeesData = locals.officeDoc.get('employeesData');
  const todayFromTimer = locals.change.after.get('timestamp');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const momentToday = momentTz(todayFromTimer).tz(timezone);
  const yesterdaysStartTime = momentToday.startOf('day').valueOf();
  const yesterdaysEndTime = momentToday.endOf('day').valueOf();
  const visitDate = dateStringWithOffset({
    timezone,
    timestampToConvert: yesterdaysStartTime,
    format: dateFormats.DATE,
  });

  /** Used for fetching customer details. We only have 'name' */
  const customerFetchPromises = [];
  /** Used for getting customer history */
  const customerAddendumPromises = [];
  const productFetchPromises = [];
  const customersSet = new Set();
  const productsSet = new Set();
  const productDetailsMap = new Map();
  const customersDetailsMap = new Map();
  const customersData = {};
  const productsData = {};

  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('activityData.forSalesReport', '==', true)
        .where('timestamp', '>=', yesterdaysStartTime)
        .where('timestamp', '<=', yesterdaysEndTime)
        .orderBy('timestamp', 'asc')
        .orderBy('user')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        addendumDocsQuery,
        workbook,
      ] = result;

      console.log('found addendumDocsQuery:', addendumDocsQuery.size);

      addendumDocsArray = addendumDocsQuery.docs;
      worksheet = workbook;
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
        'Employee Details',
      ]
        .forEach((value, index) => {
          dsrSheet
            .cell(`${alphabetsArray[index]}1`)
            .value(value);
        });

      addendumDocsArray.forEach((doc) => {
        const customerName = doc.get('activityData.attachment.Customer.value');
        const product1 = doc.get('activityData.attachment.Product 1.value');
        const product2 = doc.get('activityData.attachment.Product 2.value');
        const product3 = doc.get('activityData.attachment.Product 3.value');

        if (customerName) customersSet.add(customerName);
        if (product1) productsSet.add(product1);
        if (product2) productsSet.add(product2);
        if (product3) productsSet.add(product3);
      });

      customersSet.forEach((name) => {
        const promise = rootCollections
          .activities
          .where('office', '==', office)
          .where('template', '==', 'customer')
          .where('attachment.Name.value', '==', name)
          .limit(1)
          .get();

        customerFetchPromises.push(promise);
      });

      productsSet.forEach((name) => {
        const promise = rootCollections
          .activities
          .where('office', '==', office)
          .where('template', '==', 'product')
          .where('attachment.Name.value', '==', name)
          .limit(1)
          .get();

        productFetchPromises.push(promise);
      });

      customersSet.forEach((customerName) => {
        // const geopoint = doc.get('location');
        // const adjustedGp = adjustedGeopoint(geopoint);
        const customerAddendumPromise = rootCollections
          .activities
          .where('template', '==', 'customer')
          .where('attachment.Name.value', '==', customerName)
          // .where('adjustedGeopoints', 'array-contains', adjustedGp)
          .limit(1)
          .get();

        customerAddendumPromises.push(customerAddendumPromise);
      });

      return Promise
        .all([
          Promise
            .all(customerFetchPromises),
          Promise
            .all(productFetchPromises),
          Promise
            .all(customerAddendumPromises),
        ]);
    })
    .then((result) => {
      console.log(result);
      const [
        customersQuery,
        productsQuery,
        customerAddendumQuery,
      ] = result;

      customersQuery.forEach((doc) => {
        const name = doc.get('attachment.Name.value');

        customersData[name] = toCustomerObject(doc.data(), doc.createTime);
      });

      productsQuery.forEach((doc) => {
        const name = doc.get('attachment.Name.value');

        productsData[name] = toProductObject(doc.data(), doc.createTime);
      });

      customerAddendumQuery.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        /** Customer activity */
        const name = doc.get('activityData.attachment.Name.value');
        const creator = (() => {
          if (typeof doc.get('activityData.creator') === 'string') {
            return doc.get('activityData.creator');
          }

          return doc.get('activityData.creator').phoneNumber;
        })();
        const visitorName = (() => {
          if (employeesData[doc.get('user')]) {
            return employeesData[doc.get('user')].Name;
          }

          return doc.get('user');
        })();
        const createDateString = dateStringWithOffset({
          timezone,
          timestampToConvert: customersData[name].createTime,
          format: dateFormats.DATE,
        });
        customersData[name].history = customerHistoryCell(
          creator,
          createDateString,
          visitorName
        );
      });


      addendumDocsArray.forEach((doc, index) => {
        const rowIndex = index + 2;
        // const alphabet = alphabetsArray[index];
        dsrSheet
          .cell(`A${rowIndex}`)
          .value(visitDate);
        dsrSheet
          .cell(`B${rowIndex}`)
          .value(`${employeesData[doc.get('user')].Name | doc.get('user')}`);

        const visitLocation = '';

        dsrSheet
          .cell(`C${rowIndex}`)
          .value(`${visitLocation}`);

        dsrSheet
          .cell(``)
          .value(`D${customerDetails}`)
      });

      return Promise.resolve();
    })
    .catch(console.error);
};
