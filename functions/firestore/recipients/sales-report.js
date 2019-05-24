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
const xlsxPopulate = require('xlsx-populate');


const getEmployeeName = (employeesData, phoneNumber) => {
  if (employeesData[phoneNumber]) {
    return employeesData[phoneNumber].Name;
  }

  return phoneNumber;
};

const getVisitLocation = (doc) => {
  const activityData = doc.get('activityData');
  const identifier = doc.get('identifier');
  const url = doc.get('url');

  if (activityData.venue[0] && activityData.venue[0].location) {
    return {
      identifier: activityData.venue[0].location || activityData.venue[0].address,
      url: toMapsUrl({
        latitude: activityData.venue[0].geopoint._latitude,
        longitude: activityData.venue[0].geopoint._longitude,
      }),
    }
  }

  return {
    identifier,
    url,
  };
}

const getEmployeeDetails = (employeesData, phoneNumber) => {
  let result = '';
  let svs = [];
  const employeeData = employeesData[phoneNumber];
  let sv1 = employeeData['First Supervisor'];
  let sv2 = employeeData['Second Supervisor'];
  let sv3 = employeeData['Third Supervisor'];

  if (sv1 && employeesData[sv1]) {
    sv1 = employeesData[sv1].Name;
  }

  if (sv2 && employeesData[sv2]) {
    sv2 = employeesData[sv2].Name;
  }

  if (sv3 && employeesData[sv3]) {
    sv3 = employeesData[sv3].Name;
  }

  svs.push(sv1, sv2, sv3);

  // Removes all empty strings...
  result += `${svs.filter(Boolean)}`;

  if (employeeData.Department) {
    result += ` | ${employeeData.Department}`;
  }

  if (employeeData['Base Location']) {
    result += ` | ${employeeData['Base Location']}`;
  }

  return result;
};

const getFollowUpDate = (doc, timezone) => {
  const template = doc.get('template');
  const schedule = doc.get('activityData.schedule');

  if (template === 'customer') return '';

  if (schedule && schedule[0] && schedule[0].startTime) {
    return momentTz(schedule[0].startTime)
      .tz(timezone)
      .format(dateFormats.DATE);
  }

  return '';
};

const getVisitTime = (doc, timezone) => {
  const timestamp = doc.get('timestamp');
  const momentNow = momentTz(timestamp).tz(timezone);

  return momentNow.format(dateFormats.TIME);
};

const handleFollowUpSheet = (locals) => {
  return locals.worksheet.outputAsync('base64');
};


module.exports = (locals) => {
  const timestampFromTimer = locals.change.after.get('timestamp');
  const todaysMoment = momentTz(timestampFromTimer).startOf('day');
  const yesterdaysMoment = todaysMoment.clone().subtract(1, 'day');
  const employeesData = locals.officeDoc.get('employeesData');
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const visitDate = yesterdaysMoment.format(dateFormats.DATE);
  const office = locals.officeDoc.get('office');
  const dateString = todaysMoment.format(dateFormats.DATE);
  // For dsr updated at time
  // For customer details
  const customerNamesSet = new Set();
  const productNamesSet = new Set();
  const customerActivityPromises = [];
  const customerAddendumPromises = [];

  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Addendum')
        .where('activityData.forSalesReport', '==', true)
        .where('timestamp', '>=', yesterdaysMoment.startOf('day').valueOf())
        .where('timestamp', '<=', yesterdaysMoment.endOf('day').valueOf())
        .orderBy('timestamp')
        .orderBy('user')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [addendumDocs, worksheet] = result;
      const dsrSheet = worksheet.addSheet('DSR');
      locals.worksheet = worksheet;

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
        'Employee Details'
      ].forEach((field, index) => {
        dsrSheet.cell(`${alphabetsArray[index]}1`).value(field);
      });

      addendumDocs.docs.forEach((doc, index) => {
        const rowIndex = index + 2;
        const phoneNumber = doc.get('user');
        const customer = doc.get('customer');
        const product1 = doc.get('activityData.attachment.Product 1.value');
        const product2 = doc.get('activityData.attachment.Product 2.value');
        const product3 = doc.get('activityData.attachment.Product 3.value');
        const employeeName = getEmployeeName(employeesData, phoneNumber);
        const visitLocation = getVisitLocation(doc);
        const visitTime = getVisitTime(doc, timezone);
        // const dsrUpdatedAt = getDsrUpdateTime();
        // const dsrUpdateLocation = getDsrUpdateLocation();
        const followUpDate = getFollowUpDate(doc, timezone);
        const employeeDetails = getEmployeeDetails(employeesData[phoneNumber]);

        dsrSheet.cell(`A${rowIndex}`).value(visitDate);
        dsrSheet.cell(`B${rowIndex}`).value(employeeName);
        dsrSheet.cell(`C${rowIndex}`).value(visitLocation);
        // dsrSheet.cell(`D${rowIndex}`).value(customerHistory);
        // dsrSheet.cell(`E${rowIndex}`).value(customerDetails);
        // dsrSheet.cell(`F${rowIndex}`).value(productDetails);
        dsrSheet.cell(`G${rowIndex}`).value(visitTime);
        // dsrSheet.cell(`H${rowIndex}`).value(dsrUpdatedAt);
        // dsrSheet.cell(`I${rowIndex}`).value(dsrUpdateLocation);
        dsrSheet.cell(`J${rowIndex}`).value(followUpDate);
        dsrSheet.cell(`K${rowIndex}`).value(employeeDetails);

        // Could be empty sring
        if (customer) {
          customerNamesSet.add(customer);
        }

        if (product1) {
          productNamesSet.add(product1);
        }

        if (product2) {
          productNamesSet.add(product2);
        }

        if (product3) {
          productNamesSet.add(product3);
        }
      });

      customerNamesSet.forEach((name) => {
        const customerActivityPromise = locals
          .officeDoc
          .ref
          .collection('Activities')
          .where('template', '==', 'customer')
          .where('attachment.Name.value', '==', name)
          .limit(1)
          .get();

        const customerAddendumPromise = locals
          .officeDoc
          .ref
          .collection('Addendum')
          .where('activityData.template', '==', 'customer')
          .where('activityData.attachment.Name.value', '==', name)
          .where('timestamp', 'desc')
          .limit(1)
          .get();

        customerAddendumPromises.push(customerAddendumPromise);
        customerActivityPromises.push(customerActivityPromise);
      });


      return Promise
        .all([

        ]);
    })
    .then(() => handleFollowUpSheet(locals))
    .then((content) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals
        .messageObject['dynamic_template_data'] = {
          office,
          subject: `Sales Report_${office}_${dateString}`,
          date: dateString,
        };

      locals
        .messageObject
        .attachments
        .push({
          content,
          fileName: `Sales Report ${office}_Report_${dateString}.xlsx`,
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
    .catch(console.error);
};
