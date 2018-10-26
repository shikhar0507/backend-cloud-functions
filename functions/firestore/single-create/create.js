'use strict';


const {
  filterAttachment,
  // getCanEditValue,
  validateSchedules,
  validateVenues,
} = require('../activity/helper');
const {
  rootCollections,
  db,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');
const {
  code,
} = require('../../admin/responses');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');
const {
  httpsActions,
} = require('../../admin/constants');


const getActivityName = (options) => {
  const {
    bodyAttachment,
    templateName,
    requester,
  } = options;

  if (bodyAttachment.Name) {
    return `${templateName.toUpperCase()}: ${bodyAttachment.Name.value}`;
  }

  return `${templateName.toUpperCase()}:`
    + ` ${requester.displayName || requester.phoneNumber}`;
};

const getCanEditValue = (options) => {
  const {
    canEditRule,
    phoneNumber,
    permissions,
  } = options;

  if (canEditRule === 'NONE') return false;

  if (canEditRule === 'CREATOR') {
    return permissions[phoneNumber].isCreator;
  }

  if (canEditRule === 'ADMIN') {
    return permissions[phoneNumber].isAdmin;
  }

  if (canEditRule === 'EMPLOYEE') {
    return permissions[phoneNumber].isEmployee;
  }

  return true;
};


const createDocs = (conn, locals) => {
  locals
    .activityObject
    .activityName = getActivityName({
      bodyAttachment: conn.req.body.attachment,
      templateName: conn.req.body.template,
      requester: conn.requester,
    });

  locals
    .allPhoneNumbers.forEach((phoneNumber) => {
      const isRequester = phoneNumber === conn.requester.phoneNumber;
      const isSubscription = conn.req.body.template === 'subscription';

      const addToInclude = (() => {
        if (isSubscription && isRequester) {
          return false;
        }

        return true;
      })();

      const canEdit = getCanEditValue({
        phoneNumber,
        permissions: locals.permissions,
        canEditRule: locals.activityObject.canEditRule,
      });

      locals
        .batch
        .set(locals
          .activityRef
          .collection('Assignees')
          .doc(phoneNumber), {
            addToInclude,
            canEdit,
          });
    });

  locals
    .activityObject
    .addendumDocRef = rootCollections
      .offices
      .doc(locals.activityObject.officeId)
      .collection('Addendum')
      .doc();

  locals
    .batch
    .set(locals.activityRef, locals.activityObject);

  locals
    .batch
    .set(locals
      .activityObject
      .addendumDocRef, {
        timestamp: serverTimestamp,
        activityData: locals.activityObject,
        user: conn.requester.phoneNumber,
        userDisplayName: conn.requester.displayName,
        share: [...locals.allPhoneNumbers],
        action: httpsActions.create,
        template: conn.req.body.template,
        location: getGeopointObject(conn.req.body.geopoint),
        userDeviceTimestamp: new Date(conn.req.body.timestamp),
        activityId: locals.activityRef.id,
        activityName: getActivityName({
          bodyAttachment: conn.req.body.attachment,
          templateName: conn.req.body.template,
          requester: conn.requester,
        }),
        isSupportRequest: conn.requester.isSupportRequest,
      });

  console.log('batch', locals.batch);

  locals
    .batch.commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};

const handleAssignees = (conn, locals) => {
  if (locals.allPhoneNumbers.size === 0) {
    sendResponse(
      conn,
      code.conflict,
      `Cannot create an activity with zero assignees`
    );

    return;
  }

  const promises = [];

  locals
    .allPhoneNumbers
    .forEach((phoneNumber) => {
      const isRequester = phoneNumber === conn.requester.phoneNumber;

      locals.permissions[phoneNumber] = {
        isAdmin: false,
        isEmployee: false,
        isCreator: isRequester,
      };

      if (conn.req.body.template === 'office') return;

      if (locals.activityObject.canEditRule === 'ADMIN') {
        const promise = rootCollections
          .offices
          .doc()
          .collection('Activities')
          .where('attachment.Admin.value', '==', phoneNumber)
          .where('template', '==', 'admin')
          .limit(1)
          .get();

        promises.push(promise);
      }

      if (locals.activityObject.canEditRule === 'EMPLOYEE') {
        const promise = rootCollections
          .offices
          .doc()
          .collection('Activities')
          .where('attachment.Employee Contact.value', '==', phoneNumber)
          .where('template', '==', 'employee')
          .limit(1)
          .get();

        promises.push(promise);
      }
    });

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const template = doc.get('template');
        const isAdmin = template === 'admin';
        const isEmployee = template === 'employee';

        if (isAdmin) {
          const phoneNumber = doc.get('attachment.Admin.value');
          locals.permissions[phoneNumber].isAdmin = isAdmin;
        }

        if (isEmployee) {
          const phoneNumber = doc.get('attachment.Employee Contact.value');
          locals.permissions[phoneNumber].isEmployee = isEmployee;
        }
      });

      /** Person being added as an admin gets edit rights straight away */
      if (conn.req.body.template === 'admin'
        && locals
          .permissions
          .hasOwnProperty(conn.req.body.attachment.Admin.value)) {
        locals.permissions[conn.req.body.attachment.Admin.value].isAdmin = true;
      }

      createDocs(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const getAttachmentObject = (options) => {
  const {
    templateObject,
    phoneNumber,
  } = options;

  if (templateObject.name === 'admin') {
    templateObject.attachment.Admin.value = phoneNumber;
  }

  if (templateObject.name === 'subscription') {
    templateObject.attachment.Subscriber.value = phoneNumber;
    templateObject.attachment.Template.value = templateObject.name;
  }

  return templateObject.attachment;
};


const handleOffice = (conn, locals) => {
  Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', 'admin')
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', 'subscription')
        .limit(1)
        .get(),
    ])
    .then((snapShots) => {
      const adminTemplate = snapShots[0].docs[0];
      const subscriptionTemplate = snapShots[1].docs[0];

      const phoneNumbersArray =
        Object
          .keys(conn.req.body.attachment)
          .filter((key) => {
            const value = conn.req.body.attachment[key].value;
            const type = conn.req.body.attachment[key].type;

            return type === 'phoneNumber' && value !== '';
          })
          .map((field) => conn.req.body.attachment[field].value);


      console.log('phoneNumbersArray', phoneNumbersArray);

      /** Avoid duplicate phone numbers which will increase */
      new Set(phoneNumbersArray)
        .forEach((phoneNumber) => {
          const adminActivityRef = rootCollections
            .activities
            .doc();
          const subscriptionActivityRef = rootCollections
            .activities
            .doc();
          /**
           * The `activityRef` is the reference to the Office doc when the
           * template is `office`.
           */
          const adminAddendumDocRef = rootCollections
            .offices
            .doc(locals.activityRef.id)
            .collection('Addendum')
            .doc();
          const subscriptionAddendumDocRef = rootCollections
            .offices
            .doc(locals.activityRef.id)
            .collection('Addendum')
            .doc();

          const timestamp = serverTimestamp;
          const office = conn.req.body.office;
          const officeId = locals.activityRef.id;

          const adminActivityObject = {
            timestamp,
            office,
            officeId,
            activityName: `ADMIN: ${phoneNumber}`,
            addendumDocRef: adminAddendumDocRef,
            attachment: getAttachmentObject({
              phoneNumber,
              templateObject: adminTemplate.data(),
            }),
            canEditRule: adminTemplate.get('canEditRule'),
            creator: conn.requester.phoneNumber,
            hidden: adminTemplate.get('hidden'),
            schedule: [],
            venue: [],
            status: adminTemplate.get('statusOnCreate'),
            template: 'admin',
          };
          const subscriptionActivityObject = {
            timestamp,
            office,
            officeId,
            activityName: `SUBSCRIPTION: ${phoneNumber}`,
            addendumDocRef: subscriptionAddendumDocRef,
            attachment: getAttachmentObject({
              phoneNumber,
              templateObject: subscriptionTemplate.data(),
            }),
            canEditRule: subscriptionTemplate.get('canEditRule'),
            creator: conn.requester.phoneNumber,
            hidden: subscriptionTemplate.get('hidden'),
            schedule: [],
            venue: [],
            status: subscriptionTemplate.get('statusOnCreate'),
            template: 'subscription',
          };
          const adminAddendumObject = {
            timestamp,
            activityData: adminActivityObject,
            user: conn.requester.phoneNumber,
            userDisplayName: conn.requester.displayName,
            share: Array.from(locals.allPhoneNumbers),
            action: httpsActions.create,
            template: 'admin',
            location: getGeopointObject(conn.req.body.geopoint),
            userDeviceTimestamp: new Date(conn.req.body.timestamp),
            activityId: adminActivityRef.id,
            activityName: `ADMIN: ${phoneNumber}`,
            isSupportRequest: conn.requester.isSupportRequest,
          };
          const subscriptionAddendumObject = {
            timestamp,
            activityData: subscriptionActivityObject,
            user: conn.requester.phoneNumber,
            userDisplayName: conn.requester.displayName,
            share: Array.from(locals.allPhoneNumbers),
            action: httpsActions.create,
            template: 'subscription',
            location: getGeopointObject(conn.req.body.geopoint),
            userDeviceTimestamp: new Date(conn.req.body.timestamp),
            activityId: subscriptionActivityRef.id,
            activityName: `SUBSCRIPTION: ${phoneNumber}`,
            isSupportRequest: conn.requester.isSupportRequest,
          };

          locals
            .batch
            .set(adminActivityRef, adminActivityObject);
          locals
            .batch
            .set(adminAddendumDocRef, adminAddendumObject);
          locals
            .batch
            .set(subscriptionActivityRef, subscriptionActivityObject);
          locals
            .batch
            .set(subscriptionAddendumDocRef, subscriptionAddendumObject);

          locals
            .allPhoneNumbers
            .forEach((phoneNumber) => {
              /** Isn't really useful here since addToInclude is only useful for
               * subscription template.
               */
              locals
                .batch
                .set(adminActivityRef
                  .collection('Assignees')
                  .doc(phoneNumber), {
                    canEdit: true,
                    addToInclude: true,
                  });

              locals
                .batch
                .set(subscriptionActivityRef
                  .collection('Assignees')
                  .doc(phoneNumber), {
                    /**
                 * Person getting the subscription doesn't need to be
                 * included in the default assignees list since they themselves
                 * become an assignee of the activity created by them.
                 */
                    canEdit: false,
                    addToInclude: false,
                  });
            });
        });

      handleAssignees(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};

const handleName = (conn, locals) => {
  if (!conn.req.body.attachment.hasOwnProperty('Name')) {
    handleAssignees(conn, locals);

    return;
  }

  const query = (() => {
    if (conn.req.body.template === 'office') {
      return rootCollections
        .offices
        /** Template is always `office` at this PATH. No need to add another
         * `where` clause.
         */
        .where('attachment.Name.value', '==', conn.req.body.attachment.Name.value)
        .limit(1);
    }

    const officeId = locals.activityObject.officeId;

    return rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('template', '==', conn.req.body.template)
      .where('attachment.Name.value', '==', conn.req.body.attachment.Name.value)
      .limit(1);
  })();

  query
    .get()
    .then((snapShot) => {
      if (!snapShot.empty) {
        const message = (() => {
          if (conn.req.body.template === 'office') {
            return `An office with the name`
              + ` ${conn.req.body.attachment.Name.value}`
              + ` already exists.`;
          }

          return `${conn.req.body.template} already exists in`
            + ` the office: ${conn.req.body.office}`;
        })();

        sendResponse(conn, code.conflict, message);

        return;
      }

      if (conn.req.body.template !== 'office') {
        handleAssignees(conn, locals);

        return;
      }

      handleOffice(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};

const handleResult = (conn, result) => {
  const [
    officeQueryResult,
    templateQueryResult,
    subscriptionQueryResult,
    templateSubscriptionQueryResult,
  ] = result;

  if (!officeQueryResult.empty
    && officeQueryResult.docs[0].get('status') === 'CANCELLED') {
    sendResponse(
      conn,
      code.conflict,
      `This office has been deleted. Cannot create an activity`
    );

    return;
  }

  if (templateQueryResult.empty) {
    sendResponse(
      conn,
      code.badRequest,
      `No template found with the name: '${conn.req.body.template}'`
    );

    return;
  }

  /**
   * Person with the `subscription` template can use all templates regardless
   * of their subscription.
   */
  if (subscriptionQueryResult.empty
    && templateSubscriptionQueryResult.empty) {
    sendResponse(
      conn,
      code.forbidden,
      `You do not have the permission to use '${conn.req.body.template}'`
    );

    return;
  }

  const activityRef = rootCollections.activities.doc();

  const officeId = (() => {
    if (conn.req.body.template !== 'office') {
      return officeQueryResult.docs[0].id;
    }

    return activityRef.id;
  })();

  const locals = {
    activityRef,
    batch: db.batch(),
    permissions: {},
    /** Share array */
    allPhoneNumbers: new Set(),
    templateObject: templateQueryResult.docs[0].data(),
    activityObject: {
      /** Missing addendumDocRef, venue, schedule, attachment, activityName, */
      officeId,
      timestamp: serverTimestamp,
      office: conn.req.body.office,
      template: conn.req.body.template,
      creator: conn.requester.phoneNumber,
      status: templateQueryResult.docs[0].get('statusOnCreate'),
      canEditRule: templateQueryResult.docs[0].get('canEditRule'),
      hidden: templateQueryResult.docs[0].get('hidden'),
    },
  };

  {
    const result =
      validateSchedules(
        conn.req.body,
        templateQueryResult.docs[0].get('schedule')
      );

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    locals.activityObject.schedule = result.schedules;
  }

  {
    const result =
      validateVenues(
        conn.req.body,
        templateQueryResult.docs[0].get('venue')
      );

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    locals.activityObject.venue = result.venues;
  }

  const attachmentValid = filterAttachment({
    officeId,
    bodyAttachment: conn.req.body.attachment,
    templateAttachment: templateQueryResult.docs[0].get('attachment'),
    template: conn.req.body.template,
    office: conn.req.body.office,
  });

  console.log('attachmentValid', attachmentValid);

  if (!attachmentValid.isValid) {
    sendResponse(conn, code.badRequest, attachmentValid.message);

    return;
  }

  locals.activityObject.attachment = conn.req.body.attachment;
  attachmentValid
    .phoneNumbers
    .forEach((phoneNumber) => locals.allPhoneNumbers.add(phoneNumber));

  /**
   * Unless explicitly stated, the Support person's number will not
   * be added to the activity
   */
  if (!conn.requester.isSupportRequest) {
    locals.allPhoneNumbers.add(conn.requester.phoneNumber);
  }

  handleName(conn, locals);
};


module.exports = (conn) =>
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
        .where('template', '==', 'subscription')
        .where('attachment.Template.value', '==', 'subscription')
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .doc()
        .collection('Subscription')
        .where('template', '==', conn.req.body.template)
        .where('attachment.Template.value', '==', conn.req.body.template)
        .limit(1)
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
