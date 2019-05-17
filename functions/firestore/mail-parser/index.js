'use strict';

const {
  users,
} = require('../../admin/admin');
const {
  sendJSON,
  multipartParser,
} = require('../../admin/utils');
const XLSX = require('xlsx');


const getEmail = (from) => {
  // TODO: Replace this with the following:
  // Foo Bar <foo.bar@gmail.com>'.split(/[<>]/);
  const emailFromSendgrid = Buffer.from(from).toString();
  const emailParts = /<(.*?)>/.exec(emailFromSendgrid);

  return emailParts[1];
};

/**
 * Checks custom claims and returns a boolean depending
 * on the custom claims of the user.
 *
 * @param {object} customClaims Custom claims object
 * @param {string} officeName Name of the office
 * @returns {boolean} if the user is support or has admin claims
 * with the specified office
 */
const toAllowRequest = (customClaims, officeName) => {
  if (customClaims) {
    /** Not admin and not support */
    if (!customClaims.admin
      && !customClaims.support) {
      return false;
    }

    /** Is admin but not an admin of the specified office */
    if (customClaims.admin
      && !customClaims.admin.includes(officeName)) {
      return false;
    }

    return true;
  }

  return false;
};


module.exports = (conn) => {
  // body is of type buffer
  const body = conn.req.body;
  const headers = conn.req.headers;
  const contentType = headers['content-type'];
  const parsedData = multipartParser(body, contentType);
  const attachmentInfo = Buffer.from(parsedData['attachment-info']).toString();
  const fullFileName = JSON.parse(attachmentInfo).attachment1.filename;
  const excelFile = parsedData[fullFileName];
  const xlsxFile = Buffer.from(excelFile);
  const workbook = XLSX.read(xlsxFile);
  const sheet1 = workbook.SheetNames[0];
  const theSheet = workbook.Sheets[sheet1];
  const arrayOfObjects = XLSX
    .utils
    .sheet_to_json(theSheet, {
      blankrows: true,
      defval: '',
      raw: false,
    });

  arrayOfObjects
    .forEach((_, index) => arrayOfObjects[index].share = []);

  // Reset the body and creating custom object for consumption
  // by the bulk creation function
  conn.req.body = {};
  conn.req.body.data = arrayOfObjects;
  conn.req.body.timestamp = Date.now();
  conn.req.body.senderEmail = getEmail(parsedData.from);
  conn.req.body.createNotExistingDocs = true;
  const attachmentNameParts = fullFileName.split('--');

  conn.req.body.template = attachmentNameParts[0]
    .trim()
    .toLowerCase();
  conn.req.body.office = attachmentNameParts[1]
    .split('.xlsx')[0]
    .trim();

  return users
    .getUserByEmail(conn.req.body.senderEmail)
    .then((userRecord) => {
      const customClaims = userRecord[conn.req.body.senderEmail].customClaims;

      if (!toAllowRequest(customClaims, conn.req.body.office)) {
        return sendJSON(conn, {});
      }

      conn
        .requester = {
          isSupportRequest: false,
          email: conn.req.body.senderEmail || '',
          uid: userRecord[conn.req.body.senderEmail].uid,
          phoneNumber: userRecord[conn.req.body.senderEmail].phoneNumber,
          displayName: userRecord[conn.req.body.senderEmail].displayName || '',
          customClaims: userRecord[conn.req.body.senderEmail].customClaims,
        };

      // FIX: This is just a placeholder
      conn.req.body.geopoint = {
        latitude: 12.12121,
        longitude: 12.1212,
      };

      return require('../firestore/bulk/script')(conn);
    })
    .catch((error) => {
      console.error(error);

      return sendJSON(conn, 200);
    });
};
