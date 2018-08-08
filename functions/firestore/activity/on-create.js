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
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
  getCanEditValue,
} = require('./helper');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const getDocRef = (template, locals) => {
  if (template === 'office') {
    return rootCollections.offices.doc(locals.activityRef.id);
  }

  return rootCollections
    .offices
    .doc(locals.officeDocRef.id)
    .collection('Activities')
    .doc(locals.activityRef.id);
};


const createAddendum = (conn, locals) => {
  const activityId = locals.activityRef.id;
  let officeDocRef;

  if (locals.hasOwnProperty('officeDocRef')) {
    /** Office doc doesn't exist. The requester template is 'office'. */
    officeDocRef = locals.officeDocRef.ref;
  } else {
    officeDocRef = rootCollections.offices.doc(activityId);
  }

  locals.batch.set(officeDocRef
    .collection('Addendum')
    .doc(), {
      activityId,
      timestamp: serverTimestamp,
      user: conn.requester.phoneNumber,
      // TODO: Fix this `comment` after the final specs are out.
      comment: `${conn.requester.phoneNumber} created: ${activityId}.`,
      location: getGeopointObject(conn.req.body.geopoint),
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
    });

  const message = 'The activity was successfully created.';

  /** ENDS the response. */
  locals.batch.commit()
    .then(() => sendResponse(conn, code.created, message))
    .catch((error) => handleError(conn, error));
};


const createDocsWithBatch = (conn, locals) => {
  locals.batch.set(locals
    .activityRef, {
      venue: conn.req.body.venue,
      schedule: conn.req.body.schedule,
      attachment: conn.req.body.attachment,
      timestamp: serverTimestamp,
      officeId: locals.officeDocRef.id,
      office: conn.req.body.office,
      template: conn.req.body.template,
      activityName: conn.req.body.activityName,
      docRef: getDocRef(conn.req.body.template, locals),
      status: locals.templateDocRef.get('statusOnCreate'),
      canEditRule: locals.templateDocRef.get('canEditRule'),
    });

  Array
    .from(locals.allPhoneNumbers)
    .forEach((phoneNumber) => {
      locals.batch.set(locals
        .activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
          // Storing here to avoid splitting the path
          // For the read logic.
          activityId: locals.activityRef.id,
          canEdit: getCanEditValue(locals, phoneNumber),
        });
    });

  if (conn.req.body.template !== 'admin') {
    createAddendum(conn, locals);

    return;
  }

  // FIX this after the admin template is finalized.
  const phoneNumber = conn.req.body.attachment.phoneNumber.value;

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
  const officeId = locals.officeDocRef.id;
  locals.permissions = {};

  const promises = [];

  Array
    .from(locals.allPhoneNumbers)
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
        }

        locals.permissions[phoneNumber].isEmployee = true;
      });

      createDocsWithBatch(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};



const queryForNameInOffices = (conn, locals, promise) =>
  promise
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



const handleExtra = (conn, locals) => {
  const scheduleNames = locals.templateDocRef.get('schedule');
  const schedulesValid = validateSchedules(conn.req.body, scheduleNames);

  if (!schedulesValid.isValid) {
    sendResponse(conn, code.badRequest, schedulesValid.message);

    return;
  }

  const venueDescriptors = locals.templateDocRef.get('venue');
  const venuesValid = validateVenues(conn.req.body, venueDescriptors);

  if (!venuesValid.isValid) {
    sendResponse(conn, code.badRequest, venuesValid.message);

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

  queryForNameInOffices(conn, locals, attachmentValid.promise);
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

  if (subscriptionQueryResult.empty
    && !conn.requester.isSupportRequest) {
    sendResponse(
      conn,
      code.forbidden,
      `No subscription found for the template: '${conn.req.body.template}'`
      + ` with the office '${conn.req.body.office}'.`
    );

    return;
  }

  if (officeQueryResult.empty && conn.req.body.template !== 'office') {
    sendResponse(
      conn,
      code.badRequest,
      `No office found with the name '${conn.req.body.office}'.`
    );

    return;
  }

  locals.templateDocRef = templateQueryResult.docs[0];
  locals.subscriptionDocRef = subscriptionQueryResult.docs[0];
  locals.officeDocRef = officeQueryResult.docs[0];
  locals.canEditRule = templateQueryResult.docs[0].get('canEditRule');

  if (conn.req.body.template === 'office') {
    if (!locals.officeDocRef) {
      sendResponse(
        conn,
        code.conflict,
        `The office: '${conn.req.body.office}' already exists.`
      );

      return;
    }

    if (conn.req.body.office !== conn.req.body.attachment.Name.value) {
      sendResponse(
        conn,
        code.conflict,
        `The office name in the 'attachment.Name.value' and the`
        + ` 'office' field should be the same.`
      );

      return;
    }

    locals.officeId = locals.activityRef.id;
  }

  locals.officeId = locals.officeDocRef.id;

  if (locals.subscriptionDocRef.get('status') === 'CANCELLED') {
    sendResponse(
      conn,
      code.forbidden,
      `Your subscription to the template '${conn.req.body.template}'`
      + ` is 'CANCELLED'. Cannot create an activity.`
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

  if (conn.req.body.hasOwnProperty('share')) {
    if (conn.req.body.share.length === 0
      && locals.templateDocRef.get('include').length === 0) {
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
   * creates using the subscription mentioned in the reuest body.
   */
  locals.subscriptionDocRef.get('include')
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
    batch: db.batch(),
    allPhoneNumbers: new Set().add(conn.requester.phoneNumber),
  };

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
