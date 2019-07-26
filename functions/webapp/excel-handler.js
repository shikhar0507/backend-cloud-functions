'use strict';

const {
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');
const xlsxPopulate = require('xlsx-populate');
const {
  alphabetsArray,
} = require('../firestore/recipients/report-utils');
const {
  isNonEmptyString,
} = require('../admin/utils');


module.exports = async conn => {
  const fileName = `${conn.req.query.templateName}.xlsx`;
  const filePath = `/tmp/${fileName}`;

  console.log('In excel handler'.repeat(10));

  if (!isNonEmptyString(conn.req.query.templateName)) {
    return {
      success: false,
      message: `Query param 'templateName' is required`,
      code: code.badRequest,
    };
  }

  try {
    const [
      templateQueryResult,
      workbook
    ] = await Promise
      .all([
        rootCollections
          .activityTemplates
          .where('name', '==', conn.req.query.templateName)
          .limit(1)
          .get(),
        xlsxPopulate
          .fromBlankAsync()
      ]);

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

    if (conn.req.query.templateName === 'customer'
      || conn.req.query.templateName === 'branch') {
      ['location', 'address']
        .forEach((field, index) => {
          sheet.cell(`${alphabetsArray[index]}1`).value(field);
        });
    } else {
      let allFields = []
        .concat(attachmentFields, scheduleFields, venueFields);

      allFields.forEach((field, index) => {
        sheet.cell(`${alphabetsArray[index]}1`).value(field);
      });
    }

    conn.res.setHeader('Content-disposition', `attachment; filename=${fileName}`);
    conn.res.setHeader('Content-type', xlsxPopulate.MIME_TYPE);

    console.log('WRITING FILE...');

    return await workbook.toFileAsync('/tmp/sample.xlsx');
  } catch (error) {
    console.error(error);

    return '';
  }
};
