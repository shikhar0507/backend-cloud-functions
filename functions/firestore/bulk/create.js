'use strict';

const {
  validateSchedules,
  validateVenues,
  filterAttachment,
  activityName,
} = require('../activity/helper');
const {
  isE164PhoneNumber,
  sendJSON,
  handleError,
} = require('../../admin/utils');
const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  templatesSet,
  httpsActions,
} = require('../../admin/constants');

const toAttachmentValues = (activityId, attachment) => {
  const object = {
    activityId,
    createTime: Date.now(),
  };

  const fields = Object.keys(attachment);

  fields
    .forEach((field) => {
      object[field] = attachment[field].value;
    });

  return object;
};


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


const objectWithError = (options) => {
  const {
    object,
    reason,
  } = options;

  object.success = false;
  object.reason = reason;

  return object;
};


module.exports = (conn, locals) => {
  const batchesArray = [];
  const namesMap = locals.officeDoc.get(`namesMap`) || {};
  const newEmployeesData = locals.officeDoc.get('employeesData') || {};
  const subscriptionsMap = locals.officeDoc.get('subscriptionsMap') || {};
  const newSubscriptionsMap = subscriptionsMap;
  const templateHasName =
    locals
      .templateDoc
      .get('attachment')
      .hasOwnProperty('Name');

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

      locals
        .responseObject
        .push(objectWithError({
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

      if (namesMap[type]
        && !namesMap[type].hasOwnProperty(value)) {
        locals.responseObject.push(objectWithError({
          object,
          reason: `The type '${type}' '${value}' doesn't exist`,
        }));

        return;
      }
    });

    if (templateHasName
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

    if (templateHasName) {
      if (!namesMap[conn.req.body.template]) {
        namesMap[conn.req.body.template] = {};
      }

      namesMap[conn.req.body.template][attachment.Name.value] = true;
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

    if (conn.req.body.template === 'employee'
      && newEmployeesData.hasOwnProperty(attachment['Employee Contact'].value)) {

      locals.responseObject.push(objectWithError({
        object,
        reason: `${attachment['Employee Contact'].value} is already an employee`,
      }));

      return;
    }

    if (conn.req.body.template === 'subscription') {
      if (subscriptionsMap[attachment.Subscriber.value]
        && subscriptionsMap[attachment.Subscriber.value]
          .hasOwnProperty(attachment.Template.value)) {
        locals.responseObject.push(objectWithError({
          object,
          reason: `'${attachment.Subscriber.value}' already has the`
            + ` subscription to '${attachment.Template.value}'`,
        }));

        return;
      }

      const employeeData = locals.officeDoc.get('employeesData')[attachment.Subscriber.value];
      console.log({ ph: attachment.Subscriber.value, employeeData });

      if (employeeData) {
        const firstSV = employeeData['First Supervisor'];
        const secondSV = employeeData['Second Supervisor'];

        console.log({ firstSV, secondSV });

        if (firstSV) share.push(firstSV);
        if (secondSV) share.push(secondSV);
      }

      if (newSubscriptionsMap[attachment.Subscriber.value]) {
        newSubscriptionsMap[attachment.Subscriber.value][attachment.Template.value] = null;
      } else {
        newSubscriptionsMap[attachment.Subscriber.value] = {
          [attachment.Template.value]: null,
        };
      }
    }

    console.log('ALLOWED@index', index);

    validateAttachment
      .phoneNumbers
      .forEach((phoneNumber) => share.push(phoneNumber));

    if (!conn.requester.isSupportRequest) {
      share.push(conn.requester.phoneNumber);
    }

    const batch = db.batch();
    const activityRef = rootCollections.activities.doc();
    const addendumDocRef =
      rootCollections
        .offices
        .doc(locals.officeDoc.id)
        .collection('Addendum')
        .doc();

    if (!conn.requester.isSupportRequest) {
      share.push(conn.requester.phoneNumber);
    }

    console.log('activityId', activityRef.id);

    if (conn.req.body.template === 'employee') {
      newEmployeesData[attachment['Employee Contact'].value] =
        toAttachmentValues(activityRef.id, attachment);
    }

    const now = new Date();
    const activityNameString = activityName({
      attachmentObject: attachment,
      templateName: conn.req.body.template,
      requester: conn.requester,
    });

    const activityData = {
      addendumDocRef,
      attachment,
      activityName: activityNameString,
      venue: validVenue.venues,
      timestamp: now.getTime(),
      office: conn.req.body.office,
      template: conn.req.body.template,
      schedule: validSchedule.schedules,
      status: locals.templateDoc.get('statusOnCreate'),
      canEditRule: locals.templateDoc.get('canEditRule'),
      officeId: locals.officeDoc.id,
      hidden: locals.templateDoc.get('hidden'),
      creator: conn.requester.phoneNumber,
    };

    const addendumDoc = {
      share,
      activityData,
      activityName: activityNameString,
      date: now.getDate(),
      month: now.getMonth(),
      year: now.getFullYear(),
      user: conn.requester.phoneNumber,
      userDisplayName: conn.requester.displayName,
      action: httpsActions.create,
      template: conn.req.body.template,
      location: getGeopointObject(conn.req.body.geopoint),
      timestamp: Date.now(),
      userDeviceTimestamp: conn.req.body.timestamp,
      activityId: activityRef.id,
      isSupportRequest: conn.requester.isSupportRequest,
      // Only admins or support can create in bulk
      isAdminRequest: true,
    };

    batch.set(activityRef, activityData);
    batch.set(addendumDocRef, addendumDoc);

    new Set(share)
      .forEach((phoneNumber) => {
        console.log('phoneNumber', phoneNumber);

        const addToInclude = (() => {
          if (conn.req.body.template !== 'subscription') {
            return true;
          }

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

    const batchFactory = () => batch.commit();

    batchesArray.push(batchFactory);
  });

  const executeSequentially = (promiseFactories) => {
    let result = Promise.resolve();

    promiseFactories.forEach((promiseFactory, index) => {
      result = result
        .then(promiseFactory)
        .then(() => console.log('committed index', index));
    });

    return result;
  };

  executeSequentially(batchesArray)
    .then(() => {
      if (!new Set()
        .add('employee')
        .add('subscription')
        .has(conn.req.body.template)
        && !templateHasName) {
        return null;
      }

      const data = {};

      if (conn.req.body.template === 'subscription') {
        data.subscriptionsMap = newSubscriptionsMap;
      }

      if (conn.req.body.template === 'employee') {
        data.employeesData = newEmployeesData;
      }

      if (templateHasName) {
        data.namesMap = namesMap;
      }

      return locals
        .officeDoc
        .ref
        .set(data, {
          merge: true,
        });
    })
    .then((result) => console.log({ result }))
    .then(() => {
      console.log('docs created:', batchesArray.length);

      const rejectedObjects = (() => {
        if (locals.responseObject.length === 0) {
          return null;
        }

        return locals.responseObject;
      })();

      return sendJSON(conn, { rejectedObjects });
    })
    .catch((error) => handleError(conn, error));
};
