'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

const {
  sendGridTemplateIds,
} = require('../../admin/constants');

const getYesterdaysDate = () => {
  const today = new Date();

  return new Date(
    today.setDate(today.getDate() - 1)
  )
    .toDateString();
};

// "=HYPERLINK(""http://www.Google.com"",""Google"")"
const getAddressWithURL = (options) =>
  `=HYPERLINK(${options.locationUrl}, ${options.formattedAddress})`;


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  locals.yesterdaysDate = getYesterdaysDate();
  locals.messageObject.templateId = sendGridTemplateIds.footprints;
  locals.messageObject.csvString =
    ` Dated,`
    + ` Department,`
    + ` Name,`
    + ` Time,`
    + ` Locality,`
    + ` City,`
    + ` Distance Travelled,`
    + ` Address`
    + `\n`;

  const toFetch = [];
  const employeeDataMap = new Map();

  locals.messageObject['dynamic_template_data'] = {
    office,
    subject: `${office} Footprints Report_${locals.yesterdaysDate}`,
    date: locals.yesterdaysDate,
  };

  const officeDocRef = rootCollections
    .offices
    .doc(officeId);

  return officeDocRef
    .collection('Addendum')
    .where('date', '==', locals.yesterdaysDate)
    .orderBy('timestamp', 'desc')
    .get()
    .then((addendumDocs) => {
      if (addendumDocs.size === 0) {
        console.log('no docs found for addendum');

        return Promise.resolve();
      }

      locals.addendumDocs = addendumDocs;

      addendumDocs.forEach((doc) => {
        const phoneNumber = doc.get('user');

        employeeDataMap.set(phoneNumber, {});

        toFetch.push(officeDocRef
          .collection('Activities')
          .where('attachment.Employee Contact.value', '==', phoneNumber)
          .limit(1)
          .get());
      });

      return Promise.all(toFetch);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        const doc = snapShot.docs[0];
        const filters = snapShot._query._fieldFilters;
        const phoneNumber = filters[0]._value;

        let name = '';
        let department = '';

        if (doc) {
          name = doc.get('attachment.Name.value');
          department = doc.get('attachment.Department.value');
        }

        employeeDataMap.get(phoneNumber).name = name;
        employeeDataMap.get(phoneNumber).department = department;
      });

      locals.addendumDocs.forEach((doc) => {
        const dated = getYesterdaysDate();
        const phoneNumber = doc.get('user');
        const department = employeeDataMap.get(phoneNumber).department;
        const name = employeeDataMap.get(phoneNumber).name;
        const time = doc.get('timeString');
        const locality = doc.get('locality');
        const city = doc.get('city');
        const distanceTravelled = doc.get('distanceTravelled');
        const formattedAddress = doc.get('formattedAddress');
        const locationUrl = doc.get('locationUrl');
        const addressWithURL = getAddressWithURL({
          formattedAddress,
          locationUrl,
        });

        locals.messageObject.csvString +=
          ` ${dated},`
          + ` ${department},`
          + ` ${name},`
          + ` ${time},`
          + ` ${locality},`
          + ` ${city},`
          + ` ${distanceTravelled},`
          + ` ${addressWithURL},`
          + `\n`;
      });

      console.log(employeeDataMap);

      locals.messageObject.attachments.push({
        content: new Buffer(locals.messageObject.csvString).toString('base64'),
        fileName: `${office} Footprints Report_${locals.yesterdaysDate}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
