/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */


'use strict';


const { code, } = require('../../admin/responses');
const { httpsActions, } = require('../../admin/constants');
const {
  db,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');
const {
  validateVenues,
  getCanEditValue,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
} = require('./helper');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const getActivityName = (conn) => {
  if (conn.req.body.attachment.hasOwnProperty('Name')) {
    return `${conn.req.body.template.toUpperCase()}:`
      + ` ${conn.req.body.attachment.Name.value}`;
  }

  return `${conn.req.body.template.toUpperCase()}:`
    + ` ${conn.requester.displayName || conn.requester.phoneNumber}`;
};


const createDocsWithBatch = (conn, locals) => {
  locals.objects.allPhoneNumbers
    .forEach((phoneNumber) => {
      let addToInclude = true;

      const isRequester = phoneNumber === conn.requester.phoneNumber;

      if (conn.req.body.template === 'subscription' && isRequester) {
        addToInclude = false;
      }

      let canEdit = getCanEditValue(locals, phoneNumber);

      if (conn.req.body.template === 'admin'
        && phoneNumber === conn.req.body.attachment.Admin.value) {
        canEdit = true;
      }

      locals.batch.set(locals.docs.activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
          addToInclude,
          canEdit,
        });
    });

  locals.batch.set(locals.docs.activityRef, {
    /**
     * The `docRef` path can be a doc in two places.
     * If the template in the request body is `office`,
     * the Path will be `Offices/(activityId)`.
     *
     * In all other cases, the path will be
     * `Offices/(officeId)/Activities/(activityId)`
     */
    docRef: locals.docs.docRef,
    venue: locals.objects.venueArray,
    timestamp: serverTimestamp,
    office: conn.req.body.office,
    template: conn.req.body.template,
    schedule: locals.objects.scheduleArray,
    status: locals.static.statusOnCreate,
    attachment: conn.req.body.attachment,
    canEditRule: locals.static.canEditRule,
    activityName: getActivityName(conn),
    officeId: rootCollections.offices.doc(locals.static.officeId).id,
    hidden: locals.static.hidden,
    creator: conn.requester.phoneNumber,
  });

  locals.batch.set(rootCollections
    .offices
    .doc(locals.static.officeId)
    .collection('Addendum')
    .doc(), {
      user: conn.requester.phoneNumber,
      userDisplayName: conn.requester.displayName,
      /**
       * Numbers from `attachment`, and all other places will always
       * be present in the `allPhoneNumbers` set. Using that instead of
       * the request body `share` to avoid some users being missed
       * in the `comment`.
       */
      share: Array.from(locals.objects.allPhoneNumbers),
      action: httpsActions.create,
      template: conn.req.body.template,
      location: getGeopointObject(conn.req.body.geopoint),
      timestamp: serverTimestamp,
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      activityId: locals.static.activityId,
      activityName: getActivityName(conn),
      isSupportRequest: conn.requester.isSupportRequest,
    });

  /** ENDS the response. */
  locals.batch.commit()
    .then(() => sendResponse(
      conn,
      code.created,
      'The activity was successfully created.'
    ))
    .catch((error) => handleError(conn, error));
};


const handleAssignees = (conn, locals) => {
  const promises = [];

  if (locals.objects.allPhoneNumbers.size === 0) {
    sendResponse(
      conn,
      code.badRequest,
      `Cannot create an activity without any assignees. Please`
      + ` add some assignees for this activity using the 'share'`
      + ` array in the request body.`
    );

    return;
  }

  locals
    .objects
    .allPhoneNumbers
    .forEach((phoneNumber) => {
      const isRequester = phoneNumber === conn.requester.phoneNumber;

      locals.objects.permissions[phoneNumber] = {
        isAdmin: false,
        isEmployee: false,
        isCreator: isRequester,
      };

      /**
       * No docs will exist if the template is `office`
       * since this template itself is used to create
       * the office. No use of adding promises to the array.
       */
      if (conn.req.body.template === 'office') return;

      const officeId = locals.static.officeId;

      if (locals.static.canEditRule === 'ADMIN') {
        promises.push(rootCollections
          .offices.doc(officeId)
          .collection('Activities')
          .where('attachment.Admin.value', '==', phoneNumber)
          .where('template', '==', 'admin')
          .limit(1)
          .get()
        );
      }

      if (locals.static.canEditRule === 'EMPLOYEE') {
        promises.push(rootCollections
          .offices.doc(officeId)
          .collection('Activities')
          .where('attachment.Employee Contact.value', '==', phoneNumber)
          .where('template', '==', 'employee')
          .limit(1)
          .get()
        );
      }
    });

  if (promises.length === 0) {
    createDocsWithBatch(conn, locals);

    return;
  }

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        let phoneNumber;
        const doc = snapShot.docs[0];
        const template = doc.get('template');
        const isAdmin = template === 'admin';
        const isEmployee = template === 'employee';

        if (isAdmin) {
          phoneNumber = doc.get('attachment.Admin.value');
          locals.objects.permissions[phoneNumber].isAdmin = isAdmin;
        }

        if (isEmployee) {
          phoneNumber = doc.get('attachment.Employee Contact.value');
          locals.objects.permissions[phoneNumber].isEmployee = isEmployee;
        }
      });

      createDocsWithBatch(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const checkSubscription = (conn, locals) => {
  if (conn.req.body.template !== 'subscription') {
    handleAssignees(conn, locals);

    return;
  }

  const attachment = conn.req.body.attachment;
  const office = conn.req.body.office;
  const template = attachment.Template.value;
  const phoneNumber = attachment.Subscriber.value;

  /**
   * If the `Subscriber` mentioned in the `attachment` already has the
   * subscription to the `template` for the `office`, there's no point in
   * creating **yet** another activity.
   */
  rootCollections
    .profiles
    .doc(phoneNumber)
    .collection('Subscriptions')
    .where('template', '==', template)
    .where('office', '==', office)
    /**
     * Subscriptions are unique combinations of office + template names.
     * More than one cannot exist for a single user.
     */
    .limit(1)
    .get()
    .then((snapShot) => {
      if (!snapShot.empty) {
        sendResponse(
          conn,
          code.conflict,
          `The user: '${phoneNumber}' already has the subscription of `
          + ` '${template}' for the office: '${office}'.`
        );

        return;
      }

      handleAssignees(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const resolveQuerySnapshotShouldNotExistPromises = (conn, locals, result) => {
  const promises = result.querySnapshotShouldNotExist;

  if (promises.length === 0) {
    checkSubscription(conn, locals);

    return;
  }

  Promise
    .all(promises)
    .then((snapShots) => {
      let successful = true;
      let message = null;

      for (const snapShot of snapShots) {
        const filters = snapShot._query._fieldFilters;
        const argOne = filters[0]._value;
        const argTwo = filters[1]._value;

        if (!snapShot.empty) {
          successful = false;
          message = `A document already exists for the office:`
            + ` ${conn.req.body.office} with Name: ${argOne} +`
            + ` template: ${argTwo}.`;
          break;
        }
      }

      if (!successful) {
        sendResponse(conn, code.badRequest, message);

        return;
      }

      checkSubscription(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const resolveQuerySnapshotShouldExistPromises = (conn, locals, result) => {
  const promises = result.querySnapshotShouldExist;

  if (promises.length === 0) {
    resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);

    return;
  }

  Promise
    .all(promises)
    .then((snapShots) => {
      let successful = true;
      let message;

      for (const snapShot of snapShots) {
        const filters = snapShot._query._fieldFilters;
        const argOne = filters[0]._value;
        let argTwo;

        message = `No template found with the name: ${argOne} from`
          + ` the attachment.`;

        if (conn.req.body.template !== 'subscription') {
          argTwo = filters[1]._value;
          message = `The ${argOne} ${argTwo} does not exist in`
            + ` the office: ${conn.req.body.office}.`;
        }

        if (snapShot.empty) {
          successful = false;
          break;
        }
      }

      if (!successful) {
        sendResponse(conn, code.badRequest, message);

        return;
      }

      resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const resolveProfileCheckPromises = (conn, locals, result) => {
  const promises = result.profileDocShouldExist;

  if (promises.length === 0) {
    resolveQuerySnapshotShouldExistPromises(conn, locals, result);

    return;
  }

  Promise
    .all(promises)
    .then((docs) => {
      let successful = true;
      let message = null;

      for (const doc of docs) {
        message = `No user found with the phone number:`
          + ` ${doc.id} from the attachment.`;

        if (!doc.exists) {
          successful = false;
          break;
        }

        if (!doc.get('uid')) {
          successful = false;
          break;
        }
      }

      if (!successful) {
        sendResponse(conn, code.badRequest, message);

        return;
      }

      resolveQuerySnapshotShouldExistPromises(conn, locals, result);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handleAttachment = (conn, locals) => {
  const result = filterAttachment(conn.req.body, locals);

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  /**
   * All phone numbers in the attachment are added to the
   * activity assignees.
   */
  result.phoneNumbers
    .forEach((phoneNumber) => locals.objects.allPhoneNumbers.add(phoneNumber));

  if (result.querySnapshotShouldExist.length === 0
    && result.querySnapshotShouldNotExist.length === 0
    && result.profileDocShouldExist.length === 0) {
    checkSubscription(conn, locals);

    return;
  }

  resolveProfileCheckPromises(conn, locals, result);
};


const handleScheduleAndVenue = (conn, locals) => {
  const scheduleNames = locals.objects.schedule;
  const scheduleValidationResult =
    validateSchedules(conn.req.body, scheduleNames);

  if (!scheduleValidationResult.isValid) {
    sendResponse(conn, code.badRequest, scheduleValidationResult.message);

    return;
  }

  locals.objects.scheduleArray = scheduleValidationResult.schedules;

  const venueDescriptors = locals.objects.venue;
  const venueValidationResult = validateVenues(conn.req.body, venueDescriptors);

  if (!venueValidationResult.isValid) {
    sendResponse(conn, code.badRequest, venueValidationResult.message);

    return;
  }

  /**
   * Can't directly write the `conn.req.body.venue` to the activity root
   * because venue objects contain `Geopoint` object of Firebase.
   * We need to convert that from a normal `JS` Object for each venue.
   */
  locals.objects.venueArray = venueValidationResult.venues;

  handleAttachment(conn, locals);
};


const createLocals = (conn, result) => {
  const activityRef = rootCollections.activities.doc();

  /**
   * Temporary object in memory to store all data during the function
   * instance.
   */
  const locals = {
    batch: db.batch(),
    /**
     * Stores all the static data during the function instance.
     */
    static: {
      /** Storing this here to be consistent with other functions. */
      activityId: activityRef.id,
      /**
       * A fallback case when the template is `office` so the
       * activity is used to create the office. This value will
       * updated accordingly at appropriate time after checking
       * the template name from the request body.
       */
      officeId: activityRef.id,
      /**
       * A fallback in cases when the subscription doc is not found
       * during the `support` requests.
       */
      include: [],
      /**
       * Used by the `filterAttachment` function to check the duplication
       * of entities inside the `Offices/(officeId)/Activities` collection.
       * Eg., When the template is `employee`, the `req.body.attachment.Name`
       * + `locals.static.template` will be used to query for the employee.
       * If their doc already exists, reject the request.
       */
      template: conn.req.body.template,
    },
    /**
     * For storing all object types (e.g, schedule, venue, attachment)
     *  for the function instance.
     */
    objects: {
      /**
       * Using a `Set()` to avoid duplication of phone numbers.
       */
      allPhoneNumbers: new Set(),
      /**
       * Stores the phoneNumber and it's permission to see
       * if it is an `admin` of the office, or an `employee`.
       */
      permissions: {},
      schedule: [],
      venue: [],
      attachment: {},
    },
    /**
     * Stores all the document references for the function instance.
     */
    docs: {
      activityRef,
      /**
       * Points to the document which this activity was used to create.
       * This either points to an `office` doc, or an activity doc
       * which is a child to that `office`.
       *
       * @description The `docRef` is the same as the `activityId`
       * for the case when the template name is `office`. For any
       * other case, like (e.g., template name === 'employee'), this
       * value will be updated to point to a document inside
       * a sub-collection in the path
       * `Offices/(officeId)/Activities/(activityId)`.
       */
      docRef: rootCollections.offices.doc(activityRef.id),
    },
  };

  const [
    subscriptionQueryResult,
    officeQueryResult,
  ] = result;

  if (officeQueryResult.empty && conn.req.body.template !== 'office') {
    sendResponse(
      conn,
      code.forbidden,
      `No office found with the name: '${conn.req.body.office}'.`
    );

    return;
  }

  if (subscriptionQueryResult.empty && !conn.requester.isSupportRequest) {
    sendResponse(
      conn,
      code.forbidden,
      `No subscription found for the template: '${conn.req.body.template}'`
      + ` with the office '${conn.req.body.office}'.`
    );

    return;
  }

  if (!subscriptionQueryResult.empty) {
    if (subscriptionQueryResult.docs[0].get('status') === 'CANCELLED') {
      sendResponse(
        conn,
        code.forbidden,
        `Your subscription to the template '${conn.req.body.template}'`
        + ` is 'CANCELLED'. Cannot create an activity.`
      );

      return;
    }

    /**
     * Default assignees for all the activities that the user
     * creates using the subscription mentioned in the request body.
     */
    subscriptionQueryResult
      .docs[0]
      .get('include')
      .forEach(
        (phoneNumber) => locals.objects.allPhoneNumbers.add(phoneNumber)
      );
  }

  if (!officeQueryResult.empty) {
    if (conn.req.body.template === 'office') {
      sendResponse(
        conn,
        code.conflict,
        `The office '${conn.req.body.office}' already exists.`
      );

      return;
    }

    if (officeQueryResult.docs[0].get('status') === 'CANCELLED') {
      sendResponse(
        conn,
        code.forbidden,
        `The office status is 'CANCELLED'. Cannot create an activity.`
      );

      return;
    }

    const officeId = officeQueryResult.docs[0].id;

    locals.static.officeId = officeId;
    locals.docs.docRef =
      rootCollections
        .offices
        .doc(officeId)
        .collection('Activities')
        .doc(locals.static.activityId);
  }

  conn.req.body.share.forEach((phoneNumber) =>
    locals.objects.allPhoneNumbers.add(phoneNumber));

  if (!conn.requester.isSupportRequest) {
    locals.objects.schedule = subscriptionQueryResult.docs[0].get('schedule');
    locals.objects.venue = subscriptionQueryResult.docs[0].get('venue');
    locals.objects.attachment = subscriptionQueryResult.docs[0].get('attachment');
    locals.static.canEditRule = subscriptionQueryResult.docs[0].get('canEditRule');
    locals.static.statusOnCreate = subscriptionQueryResult.docs[0].get('statusOnCreate');
    locals.static.hidden = subscriptionQueryResult.docs[0].get('hidden');
  } else {
    const templateQueryResult = result[2];

    if (templateQueryResult.empty) {
      sendResponse(
        conn,
        code.badRequest,
        `No template found with the name: ${conn.req.body.template}`
      );

      return;
    }

    locals.objects.schedule = templateQueryResult.docs[0].get('schedule');
    locals.objects.venue = templateQueryResult.docs[0].get('venue');
    locals.objects.attachment = templateQueryResult.docs[0].get('attachment');
    locals.static.canEditRule = templateQueryResult.docs[0].get('canEditRule');
    locals.static.statusOnCreate = templateQueryResult.docs[0].get('statusOnCreate');
    locals.static.hidden = templateQueryResult.docs[0].get('hidden');
  }

  handleScheduleAndVenue(conn, locals);
};


const fetchDocs = (conn) => {
  const promises = [
    rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Subscriptions')
      .where('office', '==', conn.req.body.office)
      .where('template', '==', conn.req.body.template)
      .limit(1)
      .get(),
    rootCollections
      .offices
      .where('attachment.Name.value', '==', conn.req.body.office)
      .limit(1)
      .get(),
  ];

  /**
   * Bringing in the template doc when the request is of type
   * support since the requester may or may not have the subscription
   * to the template they want to use.
   */
  if (conn.requester.isSupportRequest) {
    promises
      .push(rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get()
      );
  }

  Promise
    .all(promises)
    .then((result) => createLocals(conn, result))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  const bodyResult = isValidRequestBody(conn.req.body, 'create');

  if (!bodyResult.isValid) {
    sendResponse(conn, code.badRequest, bodyResult.message);

    return;
  }

  fetchDocs(conn);
};
