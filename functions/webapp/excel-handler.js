'use strict';

const {
  rootCollections,
} = require('../admin/admin');
const xlsxPopulate = require('xlsx-populate');

module.exports = (conn, templateName) => {
  const fileName = `${templateName}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  return Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', templateName)
        .limit(1)
        .get(),
      xlsxPopulate
        .fromBlankAsync()
    ])
    .then(result => {
      const [templateQueryResult, workbook] = result;

      const sheet = workbook.sheet('Sheet1');
      const templateDoc = templateQueryResult.docs[0];
      const attachmentFields = Object.keys(templateDoc.get('attachment'));
      const scheduleFields = templateDoc.get('schedule');
      const venueFields = (() => {
        const venue = templateDoc.get('venue');

        if (venue.length === 0) return [];

        return [
          'placeId',
          'location',
          'address',
          'latitude',
          'longitude'
        ];
      })();

      const {
        alphabetsArray,
      } = require('../firestore/recipients/report-utils');

      []
        .concat(attachmentFields, scheduleFields, venueFields)
        .forEach((field, index) => {
          sheet.cell(`${alphabetsArray[index]}1`).value(field);
        });

      sheet.row(1).style('bold', true);

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      conn.res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
      conn.res.setHeader('Content-type', xlsxPopulate.MIME_TYPE);

      return conn.res.sendFile(filePath);
    })
    .catch(console.error);
};
