'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  isValidDate,
  isValidGeopoint,
  isNonEmptyString,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');

const handleDataArray = require('./create');


const validateRequestBody = (requestBody) => {
  const result = { isValid: true, message: null };

  if (!isValidDate(requestBody.timestamp)) {
    result.isValid = false;
    result.message = `Timestamp in the request body is invalid/missing`;


    return result;
  }

  if (!isValidGeopoint(requestBody.geopoint)) {
    result.isValid = false;
    result.message = `Geopoint in the request body is invalid/missing`;

    return result;
  }

  if (!requestBody.hasOwnProperty('template')
    || !requestBody.template) {
    result.isValid = false;
    result.message = `Template in the request body is invalid/missing`;

    return result;
  }

  if (!requestBody.hasOwnProperty('office')
    || !isNonEmptyString(requestBody.office)) {
    result.isValid = false;
    result.message = `Office in the request body is missing/invalid`;

    return result;
  }

  if (!requestBody.hasOwnProperty('data')
    || !Array.isArray(requestBody.data)
    || requestBody.data.length === 0) {
    result.isValid = false;
    result.message = `Data in the request body is invalid/missing`;

    return result;
  }

  return result;
};


const handleResult = (conn, result) => {
  const [
    officeQueryResult,
    templateQueryResult,
  ] = result;

  if (officeQueryResult.empty
    || templateQueryResult.empty) {
    const missingMessage = (() => {
      const message = ` name is missing/invalid`;

      if (officeQueryResult.empty) {
        return `Office ${message}`;
      }

      return `Template ${message}`;
    })();

    sendResponse(conn, code.badRequest, missingMessage);

    return;
  }

  const locals = {
    officeDoc: officeQueryResult.docs[0],
    templateDoc: templateQueryResult.docs[0],
    responseObject: [],
  };

  if (locals.templateDoc.get('canEditRule') !== 'ADMIN') {
    handleDataArray(conn, locals);

    return;
  }

  rootCollections
    .offices
    .doc(locals.officeDoc.id)
    .collection('Activities')
    .where('template', '==', 'admin')
    .get()
    .then((docs) => {
      locals.adminsSet = new Set();

      docs.forEach((doc) =>
        locals
          .adminsSet
          .add(doc.get('attachment.Admin.value')));

      handleDataArray(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  const validationResult = validateRequestBody(conn.req.body);

  if (!validationResult.isValid) {
    sendResponse(conn, code.badRequest, validationResult.message);

    return;
  }

  Promise
    .all([
      rootCollections
        .offices
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};
