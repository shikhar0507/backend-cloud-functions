'use strict';

const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  sendJSON,
  isE164PhoneNumber,
} = require('../../admin/utils');
const {
  httpsActions,
} = require('../../admin/constants');
const {
  code,
} = require('../../admin/responses');
const {
  activityName,
  filterAttachment,
  validateSchedules,
  validateVenues,
  getCanEditValue,
} = require('../activity/helper');


const executeSequentially = (promiseFactories) => {
  let result = Promise.resolve();

  promiseFactories.forEach((promiseFactory, index) => {
    result = result
      .then(promiseFactory)
      .then(() => console.log('committed index', index));
  });

  return result;
};


const handleBatch = (conn, locals) => {
  const hasName =
    locals.templateDoc.get('attachment').hasOwnProperty('Name');
  const namesMap = locals.officeDoc.get(`namesMap`) || {};
  const subscriptionsMap = locals.officeDoc.get('subscriptionsMap') || {};
  const newSubscriptionsMap = subscriptionsMap;
  const batchesArray = [];

  conn
    .req.body.data.forEach((object, index) => {
      const {
        attachment,
        schedule,
        venue,
        share,
        activityId,
      } = object;

      if (conn.req.body.template === 'subscription') {
        const employeeData = locals
          .officeDoc
          .get('employeesData')[attachment.Subscriber.value];
        const firstSV = employeeData['First Supervisor'];
        const secondSV = employeeData['Second Supervisor'];

        console.log({ firstSV, secondSV });

        if (firstSV) share.push(firstSV);
        if (secondSV) share.push(secondSV);

        if (newSubscriptionsMap[attachment.Subscriber.value]) {
          newSubscriptionsMap[attachment.Subscriber.value][attachment.Template.value] = null;
        } else {
          newSubscriptionsMap[attachment.Subscriber.value] = {
            [attachment.Template.value]: null,
          };
        }
      }

      console.log('ALLOWED', index);

      const validateAttachment = filterAttachment({
        bodyAttachment: attachment,
        templateAttachment: locals.templateDoc.get('attachment'),
        template: conn.req.body.template,
        officeId: locals.officeDoc.id,
        office: conn.req.body.office,
      });

      const validSchedule = validateSchedules({
        schedule,
      }, locals.templateDoc.get('schedule'));
      const validVenue = validateVenues({
        venue,
      }, locals.templateDoc.get('venue'));

      validateAttachment
        .phoneNumbers
        .forEach((phoneNumber) => share.push(phoneNumber));

      if (!conn.requester.isSupportRequest) {
        share.push(conn.requester.phoneNumber);
      }

      const batch = db.batch();
      const activityRef = rootCollections.activities.doc(activityId);

      const addendumDocRef =
        rootCollections
          .offices
          .doc(locals.officeDoc.id)
          .collection('Addendum')
          .doc();
      const activityNameString = activityName({
        attachmentObject: attachment,
        templateName: conn.req.body.template,
        requester: conn.requester,
      });

      validateAttachment
        .phoneNumbers
        .forEach((phoneNumber) => share.push(phoneNumber));

      if (!conn.requester.isSupportRequest) {
        share.push(conn.requester.phoneNumber);
      }

      const now = new Date();

      const activityData = {
        addendumDocRef,
        attachment,
        activityName: activityNameString,
        venue: validVenue.venues,
        timestamp: now.getTime(),
        date: now.getDate(),
        month: now.getMonth(),
        year: now.getFullYear(),
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
      };

      batch.set(activityRef, activityData, { merge: true });
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

      const batchFactory = () => batch.commit();

      batchesArray.push(batchFactory);
    });

  executeSequentially(batchesArray)
    .then(() => {
      if (conn.req.body.template !== 'subscription') {
        console.log('Not subscription. Subscription map not updated');

        return null;
      }

      console.log('Updating subscriptions Map', newSubscriptionsMap);

      return locals
        .officeDoc
        .ref
        .set({
          subscriptionsMap: newSubscriptionsMap,
        }, {
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
    .catch(console.error);
};


module.exports = (conn, locals) => {
  const activityPromises = [];

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
  const subscriptionsMap = locals.officeDoc.get('subscriptionsMap') || {};
  const newSubscriptionsMap = subscriptionsMap;
  const activityIdsSet = new Set();

  conn
    .req
    .body
    .data
    .forEach((object, index) => {
      const {
        attachment,
        schedule,
        venue,
        share,
        activityId,
      } = object;

      if (!object.hasOwnProperty('activityId')
        || !object.hasOwnProperty('attachment')
        || !object.hasOwnProperty('share')
        || !object.hasOwnProperty('venue')
        || !object.hasOwnProperty('schedule')) {
        const missingFieldName = (() => {
          if (!object.hasOwnProperty('activityId')) return 'activityId';
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

      if (activityIdsSet.has(activityId)) {
        locals.responseObject.push(objectWithError({
          object,
          reason: `Duplicate activity id ${activityId} found`,
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

      if (!share.every(isE164PhoneNumber)) {
        locals.responseObject.push(objectWithError({
          object,
          reason: `Invalid phone numbers found for in the 'share' array`,
        }));

        return;
      }

      if (conn.req.body.template === 'subscription') {
        const phoneNumber = attachment.Subscriber.value;
        const templateName = attachment.Template.value;

        if (subscriptionsMap[phoneNumber]
          && subscriptionsMap[phoneNumber]
            .hasOwnProperty(templateName)) {
          locals.responseObject.push(objectWithError({
            object,
            reason: `'${attachment.Subscriber.value}' already has the`
              + ` subscription to '${attachment.Template.value}'`,
          }));

          return;
        }

        const employeeData = locals
          .officeDoc
          .get('employeesData')[attachment.Subscriber.value];
        const firstSV = employeeData['First Supervisor'];
        const secondSV = employeeData['Second Supervisor'];

        console.log({ firstSV, secondSV });

        if (firstSV) share.push(firstSV);
        if (secondSV) share.push(secondSV);

        if (newSubscriptionsMap[attachment.Subscriber.value]) {
          newSubscriptionsMap[attachment.Subscriber.value][attachment.Template.value] = null;
        } else {
          newSubscriptionsMap[attachment.Subscriber.value] = {
            [attachment.Template.value]: null,
          };
        }
      }

      console.log('ALLOWED', index);

      validateAttachment
        .phoneNumbers
        .forEach((phoneNumber) => share.push(phoneNumber));

      if (!conn.requester.isSupportRequest) {
        share.push(conn.requester.phoneNumber);
      }

      activityPromises
        .push(rootCollections
          .offices
          .doc(locals.officeDoc.id)
          .collection('Activities')
          .doc(activityId)
          .get()
        );

      activityIdsSet.add(activityId);
    });

  if (locals.responseObject.length > 0) {
    sendJSON(conn, locals.responseObject);

    return;
  }

  Promise
    .all(activityPromises)
    .then((docs) => {
      docs.forEach((doc) => {
        if (!doc.exists) {
          locals
            .responseObject
            .push(objectWithError({
              object: {},
              reason: `No doc found with the ID: ${doc.id}`,
            }));

          return;
        }

        if (doc.get('template') !== code.req.body.template) {
          locals
            .responseObject
            .push(objectWithError({
              object: {},
              reason: `Cannot update template. ${doc.id}`,
            }));

          return;
        }
      });

      if (locals.responseObject.length > 0) {
        sendJSON(conn, locals.responseObject);

        return;
      }

      handleBatch(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};
