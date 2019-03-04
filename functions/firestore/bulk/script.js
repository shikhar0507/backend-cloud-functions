'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  hasAdminClaims,
  hasSuperUserClaims,
  sendResponse,
  handleError,
  sendJSON,
  isNonEmptyString,
  isValidGeopoint,
  isValidDate,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const fs = require('fs');
const path = require('path');
const fileLocation = path.join('/', 'data.csv');


const handleValidation = (body) => {
  const result = { success: true, message: null };

  const messageString = (field) =>
    `Invalid/Missing field '${field}' from the request body`;

  if (!isNonEmptyString(body.office)
    || !body.hasOwnProperty('office')) {
    return {
      success: false,
      message: messageString('office'),
    };
  }

  if (!isNonEmptyString(body.template)
    || !body.hasOwnProperty('template')) {
    return {
      success: false,
      message: messageString('template'),
    };
  }

  if (!isValidDate(body.timestamp)
    || !body.hasOwnProperty('timestamp')) {
    return {
      success: false,
      message: messageString('timestamp'),
    };
  }

  if (!isValidGeopoint(body.location)
    || !body.hasOwnProperty('location')) {
    return {
      success: false,
      message: messageString('location'),
    };
  }

  if (!Array.isArray(body.data)
    || !body.hasOwnProperty('data')) {
    return {
      success: false,
      message: messageString('location'),
    };
  }

  for (let iter = 0; iter < body.data.length; iter++) {
    const item = body.data[iter];

    if (typeof item === 'object') {
      continue;
    }

    return {
      success: false,
      message: `In field 'data', object at position: ${iter} is invalid`,
    };
  }

  return result;
};

const getActivityName = (params) => {
  const {
    template,
    subscriber,
    admin,
    name,
    number,
    displayName,
    phoneNumber,
  } = params;

  let result = `${template}: `;

  if (name) {
    result += `${name}`;
  } else if (number) {
    result += `${number}`;
  } else if (template === 'admin') {
    result += `${admin}`;
  } else if (template === 'subscription') {
    result += `${subscriber}`;
  } else {
    result += `${displayName || phoneNumber}`;
  }

  if (template === 'recipient') {
    result += ` report`;
  }

  return result.toUpperCase();
};


const validateData = (conn, locals) => {
  const attachmentFieldsSet = new Set(Object.keys(locals.templateDoc.get('attachment')));
  const scheduleFieldsSet = new Set(Object.keys(locals.templateDoc.get('attachment')));
  const venueFieldsSet = new Set(Object.keys(locals.templateDoc.get('venue')));
  const timestamp = Date.now();

  conn.req.body.data.forEach((item, index) => {
    const params = {
      subscriber: item.Subscriber,
      admin: item.Admin,
      name: item.Name,
      number: item.Number,
      template: conn.req.body.template,
      displayName: conn.requester.displayName,
      phoneNumber: conn.requester.phoneNumber,
    };

    const actitivityObject = {
      timestamp,
      canEditRule: locals.templateDoc.get('canEditRule'),
      timezone: locals.officeDoc.get('attachment.Timezone.value'),
      creator: conn.requester.phoneNumber,
      hidden: conn.templateDoc.get('hidden'),
      office: locals.officeDoc.get('attachment.Name.value'),
      officeId: locals.officeDoc.id,
      status: locals.templateDoc.get('statusOnCreate'),
      template: locals.templateDoc.get('name'),
      activityName: getActivityName(params),
      schedule: [],
      venue: [],
    };

    const objectFields = Object.keys(item);

    objectFields.forEach((field) => {
      const isFromAttachment = attachmentFieldsSet.has(field);
      const isFromSchedule = attachmentFieldsSet.has(field);
      const isFromVenue = attachmentFieldsSet.has(field);

      if (isFromAttachment) {
        actitivityObject.attachment = {
          [field]: {
            value: '',
            type: '',
          },
        };
      }

      if (isFromSchedule) {
        actitivityObject.schedule = {
          [field]: {
            value: '',
            type: '',
          },
        };
      }

      if (isFromVenue) {

      }
    });
  });


  sendResponse(conn, code.ok, 'testing');
};


module.exports = (conn) => {
  /**
   * Request body
   * office: string
   * timestamp: number
   * template: string
   * encoded: csvString
   * location: object(latitude, longitude)
   */
  if (!conn.requester.isSupportRequest) {
    const isAdmin = conn.requester.customClaims.admin
      && conn.requester.customClaims.admin.includes(conn.req.body.office);
    const canAccess = hasAdminClaims(conn.requester.customClaims);

    if (!isAdmin || !canAccess) {
      return sendResponse(
        conn,
        code.unauthorized,
        `You are not allowed to access this resource`
      );
    }
  }

  const result = handleValidation(conn.req.body);

  if (!result.success) {
    return sendResponse(conn, code.badRequest, result.message);
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
    .then((result) => {
      const [
        officeDocsQuery,
        templateDocsQuery,
      ] = result;

      if (officeDocsQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Office ${conn.req.body.office} doesn't exist`
        );
      }

      if (templateDocsQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Template ${conn.req.body.template} doesn't exist`
        );
      }

      const locals = {
        officeDoc: officeDocsQuery.docs[0],
        templateDoc: templateDocsQuery.docs[0],
      };

      return validateData(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};
