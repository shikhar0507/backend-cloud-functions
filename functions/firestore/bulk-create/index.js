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
  templatesSet,
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
    canEditRule,
    employeesData,
    requesterPhoneNumber,
    adminsSet,
  } = options;

  // const canEditRule = locals.templateDoc.get('canEditRule');

  if (canEditRule === 'NONE') return false;
  if (canEditRule === 'CREATOR') {
    return requesterPhoneNumber === phoneNumber;
  }

  if (canEditRule === 'EMPLOYEE') {
    return employeesData
      .hasOwnProperty(phoneNumber);
  }

  if (canEditRule === 'ADMIN') {
    return adminsSet.has(phoneNumber);
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


const handleDataArray = (conn, locals) => {
  const batchesArray = [];

  const objectWithError = (options) => {
    const {
      object,
      message,
    } = options;

    object.success = false;
    object.message = message;

    return object;
  };

  const hasName =
    locals.templateDoc.get('attachment').hasOwnProperty('Name');
  const namesMap = locals.officeDoc.get(`namesMap`) || {};

  conn.req.body.data.forEach((object) => {
    const attachment = object.attachment;
    const share = object.share;
    const venue = object.venue;
    const schedule = object.schedule;

    // console.log('scheduleNames', locals.templateDoc.get('schedule'));

    const validSchedule = validateSchedules({
      schedule,
    }, locals.templateDoc.get('schedule'));

    if (!validSchedule.isValid) {
      locals.responseObject.push(objectWithError({
        object,
        message: validSchedule.message,
      }));

      return;
    }

    const validVenue = validateVenues({
      venue,
    }, locals.templateDoc.get('venue'));

    if (!validVenue.isValid) {
      locals.responseObject.push(objectWithError({
        object,
        message: validVenue.message,
      }));

      return;
    }

    const validateAttachment = filterAttachment({
      bodyAttachment: attachment,
      templateAttachment: locals.templateDoc.get('attachment'),
      template: conn.req.body.template,
      officeId: locals.officeDoc.id,
      office: conn.req.body.office,
    });

    if (!validateAttachment.isValid) {
      locals.responseObject.push(objectWithError({
        object,
        message: validateAttachment.message,
      }));

      return;
    }

    validateAttachment.nameChecks.forEach((item) => {
      const type = item.type;
      const value = item.value;

      // TODO: Remove this after `activityOnWrite` creates the namesMap.
      /** `namesMap[type]` */
      if (namesMap[type]
        && !namesMap[type][value]) {
        locals.responseObject.push(objectWithError({
          object,
          message: `The type '${type}' ${value} doesn't exist`,
        }));

        return;
      }
    });

    if (hasName
      && namesMap[conn.req.body.template]
      && namesMap[conn.req.body.template][attachment.Name.value]) {
      locals.responseObject.push(objectWithError({
        object,
        message: `${conn.req.body.template.toUpperCase()} with the`
          + ` name '${attachment.Name.value}' already exists`,
      }));

      return;
    }

    if (conn.req.body.template === 'subscription'
      && !templatesSet.has(attachment.Template.value)) {
      locals.responseObject.push(objectWithError({
        object,
        message: `Template: '${attachment.Template.value}' doesn't exist`
      }));

      return;
    }

    validateAttachment
      .phoneNumbers
      .forEach((phoneNumber) => share.push(phoneNumber));

    const batch = db.batch();
    const activityRef = rootCollections.activities.doc();
    const addendumDocRef =
      rootCollections.offices.doc(locals.officeDoc.id)
        .collection('Addendum').doc();

    const activityName = (() => {
      if (hasName) {
        return `${conn.req.body.template.toUpperCase()}:`
          + ` ${attachment.Name.value}`;
      }

      return `${conn.req.body.template.toUpperCase()}:`
        + ` ${conn.requester.displayName || conn.requester.phoneNumber}`;
    })();

    if (conn.requester.isSupportRequest) {
      share.push(conn.requester.phoneNumber);
    }

    console.log('activityId', activityRef.id);

    const activityData = {
      addendumDocRef,
      venue: validVenue.venues,
      timestamp: serverTimestamp,
      office: conn.req.body.office,
      template: conn.req.body.template,
      schedule: validSchedule.schedules,
      status: locals.templateDoc.get('statusOnCreate'),
      attachment,
      canEditRule: locals.templateDoc.get('canEditRule'),
      activityName,
      officeId: locals.officeDoc.id,
      hidden: locals.templateDoc.get('hidden'),
      creator: conn.requester.phoneNumber,
    };
    const addendumDoc = {
      activityData,
      user: conn.requester.phoneNumber,
      userDisplayName: conn.requester.displayName,
      share,
      action: httpsActions.create,
      template: conn.req.body.template,
      location: getGeopointObject(conn.req.body.geopoint),
      timestamp: serverTimestamp,
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      activityId: activityRef.id,
      activityName,
      isSupportRequest: conn.requester.isSupportRequest,
    };

    batch.set(activityRef, activityData);
    batch.set(addendumDocRef, addendumDoc);

    new Set(share)
      .forEach((phoneNumber) => {

        const addToInclude = (() => {
          if (conn.req.body.template !== 'subscription') return true;

          return phoneNumber !== attachment.Subscriber.value;
        })();

        batch.set(activityRef
          .collection('Assignees')
          .doc(phoneNumber), {
            canEdit: getCanEditValue({
              phoneNumber,
              canEditRule: locals.templateDoc.get('canEditRule'),
              employeesData: locals.officeDoc.get('employeesData'),
              requesterPhoneNumber: conn.requester.phoneNumber,
              adminsSet: locals.adminsSet,
            }),
            addToInclude,
          });
      });

    console.log('batch:', batch);

    batchesArray.push(batch);
  });

  // console.log('responseObject:', locals.responseObject);

  const promises = [];

  batchesArray.forEach((batch) => promises.push(batch.commit()));


  // sendResponse(conn, code.ok, 'testing stuff');

  sendJSON(conn, locals.responseObject);
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
