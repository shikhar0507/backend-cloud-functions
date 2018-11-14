'use strict';

const {
  validateSchedules,
  validateVenues,
  filterAttachment,
} = require('../activity/helper');
const {
  isE164PhoneNumber,
  sendJSON,
  sendResponse,
  handleError,
} = require('../../admin/utils');
const {
  db,
  // serverTimestamp,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  templatesSet,
  httpsActions,
} = require('../../admin/constants');
const {
  code,
} = require('../../admin/responses');

const moment = require('moment');
// const serverTimestamp = Date.now();
const timestamp = Number(moment().utc().format('x'));

const getCanEditValue = (options) => {
  const {
    phoneNumber,
    canEditRule,
    employeesData,
    requesterPhoneNumber,
    adminsSet,
  } = options;

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


module.exports = (conn, locals) => {
  const objectWithError = (options) => {
    const {
      object,
      reason,
    } = options;

    object.success = false;
    object.reason = reason;

    return object;
  };

  const hasName =
    locals
      .templateDoc
      .get('attachment')
      .hasOwnProperty('Name');
  const namesMap = locals.officeDoc.get(`namesMap`) || {};
  const namesSet = new Set();
  let duplicatedEntriesFound = false;

  console.log('conn.req.body.data', conn.req.body.data.length);

  const activityObjects = [];

  conn.req.body.data.forEach((object, index) => {
    const attachment = object.attachment;
    const share = object.share;
    const venue = object.venue;
    const schedule = object.schedule;

    if (hasName
      && namesSet.has(attachment.Name.value)) {
      duplicatedEntriesFound = true;

      return;
    }

    if (!object.hasOwnProperty('attachment')
      || !object.hasOwnProperty('share')
      || !object.hasOwnProperty('venue')
      || !object.hasOwnProperty('schedule')) {
      const missingFieldName = (() => {
        if (!object.hasOwnProperty('share')) return 'share';
        if (!object.hasOwnProperty('venue')) return 'venue';
        if (!object.hasOwnProperty('schedule')) return 'schedule';

        return 'attachment';
      })();

      locals.responseObject.push(objectWithError({
        object,
        reason: `Missing the field: '${missingFieldName}'`,
      }));

      return;
    }

    const validSchedule = validateSchedules({
      schedule,
    }, locals.templateDoc.get('schedule'));

    if (!validSchedule.isValid) {
      locals.responseObject.push(objectWithError({
        object,
        reason: validSchedule.message,
      }));

      return;
    }

    const validVenue = validateVenues({
      venue,
    }, locals.templateDoc.get('venue'));

    if (!validVenue.isValid) {
      locals.responseObject.push(objectWithError({
        object,
        reason: validVenue.message,
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
        reason: validateAttachment.message,
      }));

      return;
    }

    validateAttachment.nameChecks.forEach((item) => {
      const type = item.type;
      const value = item.value;

      if (namesMap
        && namesMap.hasOwnProperty(type)
        && !namesMap[type].hasOwnProperty(value)) {
        locals.responseObject.push(objectWithError({
          object,
          reason: `The type '${type}' '${value}' doesn't exist`,
        }));

        return;
      }
    });

    if (hasName
      && namesMap.hasOwnProperty(conn.req.body.template)
      && namesMap[conn.req.body.template]
        .hasOwnProperty(attachment.Name.value)) {
      locals.responseObject.push(objectWithError({
        object,
        reason: `${conn.req.body.template.toUpperCase()} with the`
          + ` name '${attachment.Name.value}' already exists`,
      }));

      return;
    }

    if (conn.req.body.template === 'subscription'
      && !templatesSet.has(attachment.Template.value)) {
      locals.responseObject.push(objectWithError({
        object,
        reason: `Template: '${attachment.Template.value}' doesn't exist`,
      }));

      return;
    }

    if (!share.every(isE164PhoneNumber)) {
      locals.responseObject.push(objectWithError({
        object,
        reason: `Invalid phone numbers found for in the 'share' array`,
      }));

      return;
    }

    console.log('ALLOWED', index);

    validateAttachment
      .phoneNumbers
      .forEach((phoneNumber) => share.push(phoneNumber));

    if (!conn.requester.isSupportRequest) {
      share.push(conn.requester.phoneNumber);
    }

    if (conn.req.body.template === 'subscription'
      && locals.officeDoc.get('employeesData')
      && locals.officeDoc.get('employeesData')[attachment.Subscriber.value]) {
      const employeeData =
        locals.officeDoc.get('employeesData')[attachment.Subscriber.value];
      const firstSV = employeeData['First Supervisor'];
      const secondSV = employeeData['Second Supervisor'];

      // Both of these values can be empty strings
      if (firstSV) share.push(firstSV);
      if (secondSV) share.push(secondSV);

      if (employeeData
        .hasOwnProperty('subscriptions')
        && employeeData
          .subscriptions
          .includes(attachment.Template.value)) {
        locals.responseObject.push(objectWithError({
          object,
          reason: `'${attachment.Subscriber.value}' already has the`
            + ` subscription to '${attachment.Template.value}'`,
        }));

        return;
      }
    }

    // const activityName = (() => {
    //   if (hasName) {
    //     return `${conn.req.body.template.toUpperCase()}:`
    //       + ` ${attachment.Name.value}`;
    //   }

    //   return `${conn.req.body.template.toUpperCase()}:`
    //     + ` ${conn.requester.displayName || conn.requester.phoneNumber}`;
    // })();

    if (!conn.requester.isSupportRequest) {
      share.push(conn.requester.phoneNumber);
    }

    const activityObject = {
      activityId: rootCollections.activities.doc(),
      // addendumDocRef,
      venue: validVenue.venues,
      // timestamp,
      // office: conn.req.body.office,
      // template: conn.req.body.template,
      schedule: validSchedule.schedules,
      // status: locals.templateDoc.get('statusOnCreate'),
      attachment,
      // canEditRule: locals.templateDoc.get('canEditRule'),
      // activityName,
      // officeId: locals.officeDoc.id,
      // hidden: locals.templateDoc.get('hidden'),
      // creator: conn.requester.phoneNumber,
    };

    const assigneesArray = [];

    new Set(share)
      .forEach((phoneNumber) => {
        console.log('phoneNumber', phoneNumber);

        const addToInclude = (() => {
          if (conn.req.body.template !== 'subscription') return true;

          return phoneNumber !== attachment.Subscriber.value;
        })();

        assigneesArray.push({
          phoneNumber,
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

    if (hasName) {
      namesSet.add(attachment.Name.value);
    }

    activityObjects.push({ activityObject, assigneesArray });
  });

  const rejectedObjects = (() => {
    if (locals.responseObject.length === 0) {
      return null;
    }

    return locals.responseObject;
  })();

  const batch = db.batch();

  if (duplicatedEntriesFound) {
    sendResponse(conn, code.badRequest, 'Duplicate entries found');

    return;
  }

  batch
    .set(rootCollections
      .bulkActivities
      .doc(), {
        activityObjects,
        action: httpsActions.create,
        office: conn.req.body.office,
        officeId: locals.officeDoc.id,
        template: conn.req.body.template,
        timestamp: conn.req.body.timestamp,
        geopoint: getGeopointObject(conn.req.body.geopoint),
        creator: conn.requester.phoneNumber,
        userDisplayName: conn.requester.displayName,
        isSupportRequest: conn.requester.isSupportRequest,
        userDeviceTimestamp: conn.req.body.timestamp,
      });

  console.log(activityObjects);

  sendJSON(conn, { rejectedObjects });

  // batch
  //   .commit()
  //   .then(() => sendJSON(conn, { rejectedObjects }))
  //   .catch((error) => handleError(conn, error));
};
