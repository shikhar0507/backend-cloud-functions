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
} = require('../../admin/utils');
const {
  db,
  serverTimestamp,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  templatesSet,
  httpsActions,
} = require('../../admin/constants');

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
  const batchesArray = [];

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
    locals.templateDoc.get('attachment').hasOwnProperty('Name');
  const namesMap = locals.officeDoc.get(`namesMap`) || {};

  console.log('conn.req.body.data', conn.req.body.data.length);

  conn.req.body.data.forEach((object, index) => {
    const attachment = object.attachment;
    const share = object.share;
    const venue = object.venue;
    const schedule = object.schedule;

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

      // TODO: Remove this after `activityOnWrite` creates the namesMap.
      /** `namesMap[type]` */
      if (namesMap[type]
        && !namesMap[type].hasOwnProperty(value)) {
        locals.responseObject.push(objectWithError({
          object,
          reason: `The type '${type}' '${value}' doesn't exist`,
        }));

        return;
      }
    });

    if (hasName
      && namesMap[conn.req.body.template]
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
      const employeeData = locals.officeDoc.get('employeesData')[attachment.Subscriber.value];

      const firstSV = employeeData['First Supervisor'];
      const secondSV = employeeData['Second Supervisor'];

      console.log({ firstSV, secondSV });

      if (firstSV) share.push(firstSV);
      if (secondSV) share.push(secondSV);

      if (employeeData.hasOwnProperty('subscriptions')
        && employeeData.subscriptions.includes(attachment.Template.value)) {
        locals.responseObject.push(objectWithError({
          object,
          reason: `'${attachment.Subscriber.value}' already has the`
            + ` subscription to '${attachment.Template.value}'`,
        }));

        return;
      }
    }

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
        console.log('phoneNumber', phoneNumber);
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

    batchesArray.push(batch);
  });

  // FIXME: Temporary solution.
  // Will fix this using Generators
  batchesArray.forEach((batch) => {
    batch.commit();

    setTimeout(() => {
      console.log('committing');
    }, 500);
  });

  console.log('docs created:', batchesArray.length);

  const rejectedObjects = (() => {
    if (locals.responseObject.length === 0) {
      return null;
    }

    return locals.responseObject;
  })();

  sendJSON(conn, { rejectedObjects });
};
