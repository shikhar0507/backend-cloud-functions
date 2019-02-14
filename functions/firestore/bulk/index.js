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
  hasAdminClaims,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');

const fs = require('fs');
const csvtojsonV2 = require('csvtojson/v2');
const filePath = `/tmp/data.csv`;


const validateRequestBody = (requestBody) => {
  const result = {
    isValid: true,
    message: null,
  };

  const missing = [];
  const baseMessage = `Missing/invalid field(s)`;

  if (!isValidDate(requestBody.timestamp)) {
    result.isValid = false;
    missing.push('timestamp');
  }

  if (!isValidGeopoint(requestBody.geopoint)) {
    result.isValid = false;
    missing.push('geopoint');
  }

  if (!requestBody.hasOwnProperty('template')
    || !isNonEmptyString(requestBody.template)) {
    result.isValid = false;
    missing.push('template');
  }

  if (!requestBody.hasOwnProperty('office')
    || !isNonEmptyString(requestBody.office)) {
    result.isValid = false;
    missing.push('office');
  }

  if (!requestBody.hasOwnProperty('encodedCsv')
    || !isNonEmptyString(requestBody.encodedCsv)) {
    result.isValid = false;
    missing.push('encodedCsv');
  }

  if (missing.length === 0) return { result };

  let str = '';

  missing.forEach((field, index) => {
    str += field;

    if (index === missing.length - 1) {
      return;
    }

    str += ', ';
  });

  result.message = `${baseMessage}: ${str}`;

  return result;
};


const handleBulkRequest = (conn, locals) => {
  const myObject = {
    office: conn.req.body.office,
    geopoint: {
      latitude: conn.req.body.geopoint.latitude,
      longitude: conn.req.body.geopoint.longitude,
    },
    timestamp: conn.req.body.timestamp,
    template: conn.req.body.template,
    data: [],
  };

  Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get(),
      csvtojsonV2()
        .fromFile(filePath),
    ])
    .then((result) => {
      const [
        templateQuery,
        arrayOfObjects,
      ] = result;

      const templateObject =
        templateQuery
          .docs[0]
          .data();

      const attachmentFieldsSet =
        new Set(Object.keys(templateObject.attachment));
      const scheduleFieldsSet = new Set();
      const venueFieldsSet = new Set();

      templateObject
        .schedule
        .forEach((field) => scheduleFieldsSet.add(field));

      templateObject
        .venue
        .forEach((field) => venueFieldsSet.add(field));

      arrayOfObjects
        .forEach((object, index) => {
          const fields = Object.keys(object);
          const activityObject = {
            attachment: {},
            schedule: [],
            venue: [],
            share: [],
          };

          if (venueFieldsSet.size > 0) {
            const venueObject = {
              geopoint: {
                latitude: Number(arrayOfObjects[index].Latitude),
                longitude: Number(arrayOfObjects[index].Longitude),
              },
              location: arrayOfObjects[index].Location,
              address: arrayOfObjects[index].Address,
              venueDescriptor: '',
            };

            activityObject.venue.push(venueObject);
          }

          fields.forEach((field) => {
            if (attachmentFieldsSet.has(field)) {
              activityObject.attachment[field] = {
                type: templateObject.attachment[field].type,
                value: arrayOfObjects[index][field],
              };
            }

            if (scheduleFieldsSet.has(field)) {
              const ts = (() => {
                const date = arrayOfObjects[index][field];

                if (!date) return '';

                return new Date(date).getTime();
              })();

              activityObject.schedule.push({
                startTime: ts,
                name: field,
                endTime: ts,
              });
            }
          });

          myObject.data.push(activityObject);
        });

      conn.req.body = myObject;

      console.log(JSON.stringify(myObject, ' ', 2));

      require('./create')(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};

const validateData = (conn, locals) => {
  const encodedCsv = conn.req.body.encodedCsv;

  fs.writeFileSync(filePath, encodedCsv, {
    encoding: 'base64',
  });

  if (locals.templateDoc.get('canEditRule') !== 'ADMIN') {
    handleBulkRequest(conn, locals);

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

      docs.forEach((doc) => {
        locals
          .adminsSet
          .add(doc.get('attachment.Admin.value'));
      });

      handleBulkRequest(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
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
      const message = `name is missing/invalid`;

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

  validateData(conn, locals);
};


module.exports = (conn) => {
  const validationResult = validateRequestBody(conn.req.body);

  if (!validationResult.isValid) {
    sendResponse(conn, code.badRequest, validationResult.message);

    return;
  }

  if (!hasSupportClaims(conn.requester.customClaims)
    && !hasAdminClaims(conn.requester.customClaims)) {
    sendResponse(conn, code.forbidden, `You cannot access this resource`);

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
