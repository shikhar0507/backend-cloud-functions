'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

const {
  sendGridTemplateIds,
} = require('../../admin/constants');

const {
  getYesterdaysDateString,
} = require('./report-utils');

const getUrlString = (options) =>
  `=HYPERLINK(${options.url, options.identifier})`;


module.exports = (locals) => {
  const {
    office,
    officeId,
  } = locals.change.after.data();

  locals.yesterdaysDate = getYesterdaysDateString();
  locals.messageObject.templateId = sendGridTemplateIds.footprints;
  locals.csvString =
    ` Dated,`
    + ` Department,`
    + ` Base Location,`
    + ` Name,`
    + ` Time,`
    + ` Distance Travelled,`
    + ` Address,`
    + `\n`;

  locals.messageObject['dynamic_template_data'] = {
    office,
    subject: `${office} Footprints Report_${locals.yesterdaysDate}`,
    date: locals.yesterdaysDate,
  };

  const officeDocRef = rootCollections
    .offices
    .doc(officeId);

  return Promise
    .all([
      officeDocRef
        .get(),
      officeDocRef
        .collection('Addendum')
        .where('date', '==', locals.yesterdaysDate)
        .orderBy('user')
        .orderBy('timestamp', 'asc')
        .get(),
    ])
    .then((result) => {
      const [
        officeDoc,
        addendumDocs,
      ] = result;

      if (addendumDocs.empty) {
        console.log('No docs found in Addendum');

        return Promise.resolve();
      }

      const employeesData = officeDoc.get('employeesData');

      addendumDocs.forEach((doc) => {
        const dated = locals.yesterdaysDate;
        const phoneNumber = doc.get('user');
        const timeString = doc.get('timeString');
        const url = doc.get('url');
        const identifier = doc.get('identifier');
        const accumulatedDistance = doc.get('accumulatedDistance') || '';
        const department = employeesData[phoneNumber].Department;
        const name = employeesData[phoneNumber].Name;
        const baseLocation = employeesData[phoneNumber]['Base Location'];
        const urlString = getUrlString({
          url,
          identifier,
        });

        locals.csvString +=
          ` ${dated},`
          + ` ${department},`
          + ` ${baseLocation},`
          + ` ${name},`
          + ` ${timeString},`
          + ` ${accumulatedDistance},`
          + ` ${urlString},`
          + `\n`;
      });

      locals.messageObject.attachments.push({
        content: new Buffer(locals.csvString).toString('base64'),
        fileName: `${office} Footprints Report_${locals.yesterdaysDate}.csv`,
        type: 'text/csv',
        disposition: 'attachment',
      });

      return locals.sgMail.sendMultiple(locals.messageObject);
    })
    .catch(console.error);
};
