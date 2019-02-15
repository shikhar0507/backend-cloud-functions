'use strict';


const {
  filterAttachment,
  validateSchedules,
  validateVenues,
  activityName,
} = require('../activity/helper');
const {
  rootCollections,
  db,
  getGeopointObject,
} = require('../../admin/admin');
const {
  code,
} = require('../../admin/responses');
const {
  handleError,
  sendResponse,
  hasSupportClaims,
} = require('../../admin/utils');
const {
  httpsActions,
} = require('../../admin/constants');

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


const createDocs = (conn, locals) => {
  locals.activityObject.activityName = activityName({
    attachmentObject: conn.req.body.attachment,
    templateName: conn.req.body.template,
    requester: conn.requester,
  });

  locals.allPhoneNumbers.forEach((phoneNumber) => {
    const isRequester = phoneNumber === conn.requester.phoneNumber;
    const isSubscription = conn.req.body.template === 'subscription';

    const addToInclude = (() => {
      if (isSubscription && isRequester) {
        return false;
      }

      return true;
    })();

    /** The `canEditRule` for `Office` is `NONE` */
    const canEdit = (() => {
      if (conn.req.body.template === 'office') {
        const firstContact = conn.req.body.attachment['First Contact'].value;
        const secondContact = conn.req.body.attachment['Second Contact'].value;

        return new Set([firstContact, secondContact]).has(phoneNumber);
      }

      const canEditRule = locals.activityObject.canEditRule;

      if (canEditRule === 'ALL') return true;

      if (canEditRule === 'ADMIN') {
        return locals.permissions[phoneNumber].isAdmin;
      }

      if (canEdit === 'EMPLOYEE') {
        return locals.permissions[phoneNumber].isEmployee;
      }

      if (canEditRule === 'CREATOR') {
        return phoneNumber === conn.requester.phoneNumber;
      }

      // canEditRule === 'NONE'
      return false;
    })();

    console.log(canEdit, phoneNumber);

    // Assignees subcollection below the office activity if template is office
    locals.batch.set(locals.activityRef.collection('Assignees').doc(phoneNumber), {
      addToInclude,
      canEdit,
    });
  });

  locals.activityObject.addendumDocRef = rootCollections
    .offices
    .doc(locals.activityObject.officeId)
    .collection('Addendum')
    .doc();

  // Activity

  console.log('main activity set');
  locals.batch.set(locals.activityRef, locals.activityObject);

  console.log('main addendum set');
  // Addendum
  locals.batch.set(locals.activityObject.addendumDocRef, {
    timestamp: Date.now(),
    activityData: locals.activityObject,
    user: conn.requester.phoneNumber,
    userDisplayName: conn.requester.displayName,
    share: [...locals.allPhoneNumbers],
    action: httpsActions.create,
    template: conn.req.body.template,
    location: getGeopointObject(conn.req.body.geopoint),
    userDeviceTimestamp: conn.req.body.timestamp,
    activityId: locals.activityRef.id,
    activityName: activityName({
      attachmentObject: conn.req.body.attachment,
      templateName: conn.req.body.template,
      requester: conn.requester,
    }),
    isSupportRequest: conn.requester.isSupportRequest,
  });

  if (conn.req.body.template !== 'office'
    && conn.req.body.attachment.hasOwnProperty('Name')) {
    const namesMap = locals.officeDoc.get('namesMap') || {};
    const name = conn.req.body.attachment.Name.value;

    if (!namesMap[conn.req.body.template]) {
      namesMap[conn.req.body.template] = {};
    }

    namesMap[conn.req.body.template][name] = true;

    locals
      .batch
      .set(locals.officeDoc.ref, {
        namesMap,
      }, {
          merge: true,
        });
  }

  locals
    .batch
    .commit()
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

  locals.allPhoneNumbers.forEach((phoneNumber) => {
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
        .doc(locals.activityObject.officeId)
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
        .doc(locals.activityObject.officeId)
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
        && locals.permissions.hasOwnProperty(conn.req.body.attachment.Admin.value)) {
        locals.permissions[conn.req.body.attachment.Admin.value].isAdmin = true;
      }

      createDocs(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
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

      locals.phoneNumbersArray =
        Object
          .keys(conn.req.body.attachment).filter((key) => {
            const value = conn.req.body.attachment[key].value;
            const type = conn.req.body.attachment[key].type;

            return type === 'phoneNumber' && value !== '';
          })
          .map((field) => conn.req.body.attachment[field].value);


      console.log('phoneNumbersArray', locals.phoneNumbersArray);

      /** Avoid duplicate phone numbers */
      new Set(locals.phoneNumbersArray)
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

          const office = conn.req.body.office;
          const officeId = locals.activityRef.id;

          console.log({
            officeId,
            adminActivityRef: adminActivityRef.id,
            subscriptionActivityRef: subscriptionActivityRef.id,
          });

          const adminAttachmentObject = getAttachmentObject({
            phoneNumber,
            templateObject: adminTemplate.data(),
          });
          const adminActivityName = activityName({
            attachmentObject: adminAttachmentObject,
            templateName: 'admin',
            requester: conn.requester,
          });
          const subscriptionAttachmentObject = getAttachmentObject({
            phoneNumber,
            templateObject: subscriptionTemplate.data(),
          });
          const subscriptionActivityName = activityName({
            attachmentObject: subscriptionAttachmentObject,
            templateName: 'subscription',
            requester: conn.requester,
          });

          const adminActivityObject = {
            timestamp: Date.now(),
            office,
            officeId,
            activityName: adminActivityName,
            addendumDocRef: adminAddendumDocRef,
            attachment: adminAttachmentObject,
            canEditRule: adminTemplate.get('canEditRule'),
            creator: conn.requester.phoneNumber,
            hidden: adminTemplate.get('hidden'),
            schedule: [],
            venue: [],
            status: adminTemplate.get('statusOnCreate'),
            template: 'admin',
          };
          const subscriptionActivityObject = {
            office,
            officeId,
            timestamp: Date.now(),
            activityName: subscriptionActivityName,
            addendumDocRef: subscriptionAddendumDocRef,
            attachment: subscriptionAttachmentObject,
            canEditRule: subscriptionTemplate.get('canEditRule'),
            creator: conn.requester.phoneNumber,
            hidden: subscriptionTemplate.get('hidden'),
            schedule: [],
            venue: [],
            status: subscriptionTemplate.get('statusOnCreate'),
            template: 'subscription',
          };
          const adminAddendumObject = {
            timestamp: Date.now(),
            activityData: adminActivityObject,
            user: conn.requester.phoneNumber,
            userDisplayName: conn.requester.displayName,
            share: Array.from(locals.allPhoneNumbers),
            action: httpsActions.create,
            template: 'admin',
            location: getGeopointObject(conn.req.body.geopoint),
            userDeviceTimestamp: conn.req.body.timestamp,
            activityId: adminActivityRef.id,
            activityName: adminActivityName,
            isSupportRequest: conn.requester.isSupportRequest,
            isAutoGenerated: true,
          };
          const subscriptionAddendumObject = {
            timestamp: Date.now(),
            activityData: subscriptionActivityObject,
            user: conn.requester.phoneNumber,
            userDisplayName: conn.requester.displayName,
            share: Array.from(locals.allPhoneNumbers),
            action: httpsActions.create,
            template: 'subscription',
            location: getGeopointObject(conn.req.body.geopoint),
            userDeviceTimestamp: conn.req.body.timestamp,
            activityId: subscriptionActivityRef.id,
            activityName: subscriptionActivityName,
            isSupportRequest: conn.requester.isSupportRequest,
            isAutoGenerated: true,
          };

          // activity
          locals
            .batch
            .set(adminActivityRef, adminActivityObject);

          // addendum
          locals
            .batch
            .set(adminAddendumDocRef, adminAddendumObject);

          // activity
          locals
            .batch
            .set(subscriptionActivityRef, subscriptionActivityObject);

          // addendum
          locals
            .batch
            .set(subscriptionAddendumDocRef, subscriptionAddendumObject);

          locals
            .allPhoneNumbers
            .forEach((phoneNumber) => {
              /** 
               * Isn't really useful here since `addToInclude` is only useful for
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

              const addToInclude =
                subscriptionActivityObject.attachment.Subscriber.value
                !== phoneNumber;

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
                    canEdit: true,
                    addToInclude,
                  });
            });
        });

      handleAssignees(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handleName = (conn, locals) => {
  if (!conn.req.body.attachment.hasOwnProperty('Name')
    && conn.req.body.template !== 'office') {
    console.log('inside hasownproperty name');

    handleAssignees(conn, locals);

    return;
  }

  if (conn.req.body.template === 'office') {
    console.log('in handle offices');

    handleOffice(conn, locals);

    return;
  }

  const namesMap = locals.officeDoc.get('namesMap') || {};
  const name = conn.req.body.attachment.Name.value;
  const template = conn.req.body.template;

  if (namesMap[template] && namesMap[template][name]) {
    sendResponse(
      conn,
      code.conflict,
      `${template} with the name: '${name} already exists'`);

    return;
  }

  console.log('outside handle offices');

  handleAssignees(conn, locals);
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

  if (!officeQueryResult.empty
    && conn.req.body.template === 'office') {
    sendResponse(
      conn,
      code.conflict,
      `Office '${conn.req.body.office}' already exists.`
    );

    return;
  }

  if (officeQueryResult.empty
    && conn.req.body.template !== 'office') {
    sendResponse(
      conn,
      code.conflict,
      `No office found with the name '${conn.req.body.office}'`
    );

    return;
  }

  if (templateQueryResult.empty) {
    sendResponse(
      conn,
      code.badRequest,
      `No template found with the name:` + ` '${conn.req.body.template}'`
    );

    return;
  }

  /**
   * Person with the `subscription` template can use all templates regardless
   * of their subscription.
   */
  if (subscriptionQueryResult.empty
    && templateSubscriptionQueryResult.empty
    && !hasSupportClaims(conn.requester.customClaims)) {
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
    allPhoneNumbers: new Set(conn.req.body.share),
    templateObject: templateQueryResult.docs[0].data(),
    activityObject: {
      /**
       * Missing addendumDocRef, venue, schedule, attachment, activityName,
       */
      officeId,
      timestamp: Date.now(),
      office: conn.req.body.office,
      template: conn.req.body.template,
      creator: conn.requester.phoneNumber,
      status: templateQueryResult.docs[0].get('statusOnCreate'),
      canEditRule: templateQueryResult.docs[0].get('canEditRule'),
      hidden: templateQueryResult.docs[0].get('hidden'),
    },
  };

  if (conn.req.body.template !== 'office') {
    locals.officeDoc = officeQueryResult.docs[0];
  }

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

  if (!attachmentValid.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      attachmentValid.message
    );

    return;
  }

  locals.activityObject.attachment = conn.req.body.attachment;

  /** Office needs to have at least one contact */
  if (attachmentValid.phoneNumbers.length === 0
    && conn.req.body.template === 'office') {
    sendResponse(conn,
      code.badRequest,
      `Cannot create an office with both First and Second`
      + ` contacts empty`
    );

    return;
  }

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

  console.log('before handle name');

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
        .where('office', '==', conn.req.body.office)
        .where('template', '==', 'subscription')
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .collection('Subscription')
        .where('office', '==', conn.req.body.office)
        .where('template', '==', conn.req.body.template)
        .limit(1)
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
