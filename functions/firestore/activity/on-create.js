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


const {
  db,
  users,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');

const { code, } = require('../../admin/responses');

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


const createAddendum = (conn, locals) => {
  locals.batch.set(rootCollections
    .offices
    .doc(locals.officeId)
    .collection('Addendum')
    .doc(), {
      activityId: locals.activityRef.id,
      user: conn.requester.phoneNumber,
      location: getGeopointObject(conn.req.body.geopoint),
      /**
       * Sent to the user with the field `timestamp` in the
       * read response to the `/read`.
       */
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      timestamp: serverTimestamp,
      action: 'create',
      template: conn.req.body.template,
      share: conn.req.body.share || [],
      remove: null,
      updatedPhoneNumber: null,
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


const createDocsWithBatch = (conn, locals) => {
  locals
    .allPhoneNumbers
    .forEach((phoneNumber) => {
      const isRequester = phoneNumber === conn.requester.phoneNumber;

      /**
       * Support requests won't add the creator to the
       * activity assignee list.
       */
      if (isRequester && conn.requester.isSupportRequest) return;
      locals.batch.set(locals
        .activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
          activityId: locals.activityRef.id,
          canEdit: getCanEditValue(locals, phoneNumber),
        });
    });


  locals.batch.set(locals
    .activityRef, {
      venue: conn.req.body.venue,
      schedule: conn.req.body.schedule,
      attachment: conn.req.body.attachment,
      timestamp: serverTimestamp,
      officeId: rootCollections.offices.doc(locals.static.officeId).id,
      office: conn.req.body.office,
      template: conn.req.body.template,
      activityName: conn.req.body.activityName,
      docRef: locals.docRef,
      status: locals.static.statusOnCreate,
      canEditRule: locals.static.canEditRule,
    });

  if (conn.req.body.template !== 'admin') {
    createAddendum(conn, locals);

    return;
  }

  /**
   * Phone number of the user who's being given the `admin` custom
   * claims with the `admin` template.
   */
  const phoneNumber = conn.req.body.attachment['Phone Number'].value;

  users
    .getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      const phoneNumber = Object.keys(userRecord)[0];
      const record = userRecord[`${phoneNumber}`];

      if (!record.hasOwnProperty('uid')) {
        sendResponse(
          conn,
          code.forbidden,
          `Cannot grant admin rights to a user who has not signed up.`
        );

        return;
      }

      createAddendum(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handleAssignees = (conn, locals) => {
  locals.permissions = {};

  const promises = [];

  locals
    .allPhoneNumbers
    .forEach((phoneNumber) => {
      const isRequester = phoneNumber === conn.requester.phoneNumber;

      /**
       * Support requests won't add the creator to the
       * activity assignee list.
       */
      if (isRequester && conn.requester.isSupportRequest) return;

      locals.permissions[phoneNumber] = {
        isAdmin: false,
        isEmployee: false,
        isCreator: false,
      };

      if (isRequester) locals.permissions[phoneNumber].isCreator = true;

      /**
       * No docs will exist if the template is `office`
       * since this template itself is used to create
       * the office. No use of adding promises to the array.
       */
      if (conn.req.body.template === 'office') return;

      const officeId = locals.static.officeId;

      promises.push(rootCollections
        .offices.doc(officeId)
        .collection('Activities')
        .where('phoneNumber', '==', phoneNumber)
        .where('template', '==', 'admin')
        .limit(1)
        .get()
      );

      promises.push(rootCollections
        .offices.doc(officeId)
        .collection('Activities')
        .where('phoneNumber', '==', phoneNumber)
        .where('template', '==', 'employee')
        .limit(1)
        .get()
      );
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

        const doc = snapShot.docs[0];
        const template = doc.get('template');
        const phoneNumber = doc.get('phoneNumber');

        /** The person can either be an employee or an admin. */
        if (template === 'admin') {
          locals.permissions[phoneNumber].isAdmin = true;

          return;
        }

        locals.permissions[phoneNumber].isEmployee = true;
      });

      createDocsWithBatch(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handleExtra = (conn, locals) => {
  const scheduleNames = locals.static.schedule;
  const scheduleValid = validateSchedules(conn.req.body, scheduleNames);

  if (!scheduleValid.isValid) {
    sendResponse(conn, code.badRequest, scheduleValid.message);

    return;
  }

  const venueDescriptors = locals.static.venue;
  const venueValid = validateVenues(conn.req.body, venueDescriptors);

  if (!venueValid.isValid) {
    sendResponse(conn, code.badRequest, venueValid.message);

    return;
  }

  const attachmentValid = filterAttachment(conn.req.body, locals);

  if (!attachmentValid.isValid) {
    sendResponse(conn, code.badRequest, attachmentValid.message);

    return;
  }

  attachmentValid
    .phoneNumbers
    .forEach((phoneNumber) => locals.allPhoneNumbers.add(phoneNumber));

  if (!attachmentValid.promise) {
    handleAssignees(conn, locals);

    return;
  }

  attachmentValid
    .promise
    .then((snapShot) => {
      if (!snapShot.empty) {
        const value = conn.req.body.attachment.Name.value;
        const type = conn.req.body.attachment.Name.type;
        const message = `'${value}' already exists in the office`
          + ` '${conn.req.body.office}' with the template '${type}'.`;

        sendResponse(conn, code.conflict, message);

        return;
      }

      handleAssignees(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const createLocals = (conn, locals, result) => {
  const [
    templateQueryResult,
    subscriptionQueryResult,
    officeQueryResult,
  ] = result;

  if (templateQueryResult.empty) {
    sendResponse(
      conn,
      code.badRequest,
      `Template '${conn.req.body.template}' not found.`
    );

    return;
  }

  locals.static.schedule = templateQueryResult.docs[0].get('schedule');
  locals.static.venue = templateQueryResult.docs[0].get('venue');
  locals.static.attachment = templateQueryResult.docs[0].get('attachment');
  locals.static.canEditRule = templateQueryResult.docs[0].get('canEditRule');
  locals.static.statusOnCreate = templateQueryResult.docs[0].get('statusOnCreate');
  locals.status.officeId = locals.activityRef.id;
  locals.static.include = [];

  if (!subscriptionQueryResult.empty) {
    if (!conn.requester.isSupportRequest) {
      sendResponse(
        conn,
        code.forbidden,
        `No subscription found for the template: '${conn.req.body.template}'`
        + ` with the office '${conn.req.body.office}'.`
      );

      return;
    }

    locals.static.include = subscriptionQueryResult.docs[0].get('include');
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

    if (locals.officeDocRef.get('status') === 'CANCELLED') {
      sendResponse(
        conn,
        code.forbidden,
        `The office status is 'CANCELLED'. Cannot create an activity.`
      );

      return;
    }

    const officeId = officeQueryResult.docs[0].id;

    locals.static.officeId = officeId;
    locals.docRef = rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .doc(locals.activityRef.id);
  }

  if (officeQueryResult.empty) {
    if (conn.req.body.office !== conn.req.body.attachment.Name.value) {
      sendResponse(
        conn,
        code.conflict,
        `The office name in the 'attachment.Name.value' and the`
        + ` 'office' field should be the same.`
      );

      return;
    }

    const officeId = locals.activityRef.id;
    locals.static.officeId = officeId;
    locals.docRef = rootCollections.offices(officeId);
  }

  if (!conn.requester.isSupportRequest) {
    if (subscriptionQueryResult.docs[0].get('status') === 'CANCELLED') {
      sendResponse(
        conn,
        code.forbidden,
        `Your subscription to the template '${conn.req.body.template}'`
        + ` is 'CANCELLED'. Cannot create an activity.`
      );

      return;
    }
  }

  if (conn.req.body.hasOwnProperty('share')) {
    if (conn.req.body.share.length === 0
      && locals.static.include.length === 0) {
      sendResponse(
        conn,
        code.conflict,
        `Cannot create an activity without any assignees.`
      );

      return;
    }

    conn.req.body.share
      .forEach((phoneNumber) => locals.allPhoneNumbers.add(phoneNumber));
  }

  /**
   * Default assignees for all the activities that the user
   * creates using the subscription mentioned in the request body.
   */
  locals.static.include
    .forEach((phoneNumber) => locals.allPhoneNumbers.add(phoneNumber));

  handleExtra(conn, locals);
};


module.exports = (conn) => {
  const bodyResult = isValidRequestBody(conn.req.body, 'create');

  if (!bodyResult.isValid) {
    sendResponse(conn, code.badRequest, bodyResult.message);

    return;
  }

  const locals = {
    activityRef: rootCollections.activities.doc(),
    docRef: null,
    batch: db.batch(),
    /**
     * Using a `Set()` to avoid duplication of phone numbers.
     */
    allPhoneNumbers: new Set(),
    /**
     * Stores all the data which will not change during the instance.
     */
    static: {},
  };

  if (!conn.requester.isSupportRequest) {
    locals.allPhoneNumbers.add(conn.requester.phoneNumber);
  }

  Promise
    .all([
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
        .where('template', '==', conn.req.body.template)
        .limit(1)
        .get(),
      rootCollections
        .offices
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
    ])
    .then((result) => createLocals(conn, locals, result))
    .catch((error) => handleError(conn, error));
};
