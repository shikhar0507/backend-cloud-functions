'use strict';

const {
  db,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  sendJSON,
  isValidDate,
  isValidGeopoint,
  isNonEmptyString,
  isE164PhoneNumber,
} = require('../../admin/utils');
const {
  validTypes,
  httpsActions,
} = require('../../admin/constants');
const {
  code,
} = require('../../admin/responses');
const {
  filterAttachment,
  validateSchedules,
  validateVenues,
} = require('../activity/helper');

const getCanEditValue = (options) => {
  const {
    phoneNumber,
    locals,
    requesterPhoneNumber,
  } = options;

  const canEditRule = locals.templateDoc.get('canEditRule');

  if (canEditRule === 'NONE') return false;
  if (canEditRule === 'CREATOR') {
    return requesterPhoneNumber === phoneNumber;
  }

  if (canEditRule === 'EMPLOYEE') {
    return locals
      .officeDoc
      .get('employeesData')
      .hasOwnProperty(phoneNumber);
  }

  /** canEditRule is `ALL` */
  return true;
};


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

const handleAttachment = (conn, locals) => {
  const attachmentsObject = locals.dataObject.attachments;

  Object
    .keys(attachmentsObject)
    .forEach((name) => {
      const result = filterAttachment({
        bodyAttachment: attachmentsObject[name],
        templateAttachment: locals.templateDoc.get('template'),
        template: locals.templateDoc.get('name'),
        officeId: locals.officeDoc.id,
        office: locals.officeDoc.get('office'),
      });

      if (result.isValid) return;

      locals.flaggedMap.set(name, result.message);
    });
};

const handleAssignees = (conn, locals) => {
  const assigneesArray = locals.dataObject.assignees;

  Object
    .keys(assigneesArray)
    .forEach((name) => {
      if (assigneesArray[name].each(isE164PhoneNumber)) return;

      locals.flaggedMap.set(
        name,
        `Invalid phone numbers found for the user: ${name}`
      );
    });

  handleAttachment(conn, locals);
};

const handleVenues = (conn, locals) => {
  const venuesObject = locals.dataObject.venues;

  Object
    .keys(venuesObject)
    .forEach((name) => {
      const venuesArray = venuesObject[name];

      const result = validateVenues({
        venue: venuesArray,
      }, locals.templateDoc.get('venue'));

      if (result.isValid) return;

      locals.flaggedMap.set(name, result.message);
    });

  handleAssignees(conn, locals);
};

const handleSchedules = (conn, locals) => {
  const schedulesObject = locals.dataObject.schedules;

  Object
    .keys(schedulesObject)
    .forEach((name) => {
      const scheduleArray = schedulesObject[name];

      const result = validateSchedules({
        schedule: scheduleArray,
      }, locals.templateDoc.get('schedule'));

      if (result.isValid) return;

      locals.flaggedMap.set(name, result.message);
    });

  handleVenues(conn, locals);
};


const handleDataArray = (conn, locals) => {
  const {
    officeDoc,
    templateDoc,
  } = locals;

  locals.flaggedMap = new Map();
  locals.dataMap = new Map();

  const dataObject = {
    attachments: {},
    assignees: {},
    schedules: {},
    venues: {},
  };

  // TODO: Handle the case where the `Name` is invalid or missing
  conn
    .req
    .body
    .data
    .forEach((object) => {
      const attachmentValid = filterAttachment({
        bodyAttachment: object.attachment,
        templateAttachment: templateDoc.get('attachment'),
        template: conn.req.body.template,
        officeId: officeDoc.id,
        office: officeDoc.get('attachment.Name.value'),
      });

      const name = object.attachment.Name.value;

      if (!attachmentValid.isValid) {
        locals.flaggedMap.set(name, attachmentValid.message);

        return;
      }

      object.assignees =
        attachmentValid
          .phoneNumbers
          .concat(object.assignees);

      const scheduleValid = validateSchedules({
        schedule: object.schedule,
      }, templateDoc.get('schedule'));

      if (!scheduleValid.isValid) {
        locals.flaggedMap.set(name, scheduleValid.message);

        return;
      }

      const venueValid = validateVenues({
        venue: object.venue,
      }, templateDoc.get('venue'));

      if (!venueValid.isValid) {
        locals.flaggedMap.set(name, venueValid.message);

        return;
      }

      dataObject.schedules[name] = object.schedule;
      dataObject.venues[name] = object.venue;
      dataObject.assignees[name] = object.assignees;
      dataObject.attachments[name] = object.attachment;
    });

  locals.dataObject = dataObject;

  handleSchedules(conn, locals);
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
  };

  rootCollections
    .offices
    .doc(locals.officeDoc.id)
    .collection('Activities')
    .where('template', '==', 'admin')
    .get()
    .then((docs) => {
      locals.adminSet = new Set();

      docs
        .forEach((doc) =>
          locals.adminSet.add(doc.get('attachment.Admin.value')));

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
