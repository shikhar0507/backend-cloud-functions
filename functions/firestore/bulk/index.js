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
  hasSupportClaims,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');


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
    subscriptionTemplateQuery,
    bodyTemplateSubscriptionQuery,
  ] = result;

  // Offices are not created by Bulk
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

  if (subscriptionTemplateQuery.empty
    && bodyTemplateSubscriptionQuery.empty
    && !conn.requester.isSupportRequest) {
    sendResponse(
      conn,
      code.forbidden,
      `You are not allowed to access this resource`
    );

    return;
  }

  const locals = {
    officeDoc: officeQueryResult.docs[0],
    templateDoc: templateQueryResult.docs[0],
    responseObject: [],
  };

  const handleDataArray = (() => {
    if (conn.req.body.update) {
      return require('./update');
    }

    return require('./create');
  })();

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
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .where('office', '==', conn.req.body.office)
        .where('template', '==', 'subscription')
        .where('attachment.Template.value', '==', 'subscription')
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscriptions')
        .where('office', '==', conn.req.body.office)
        .where('template', '==', 'subscription')
        .where('attachment.Template.value', '==', conn.req.body.template)
        .limit(1)
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};
