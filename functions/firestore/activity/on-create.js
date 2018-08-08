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
} = require('./helper');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const getCanEditValue = (locals, phoneNumber) => {
  const canEditRule = locals.templateDocRef.get('canEditRule');

  if (canEditRule === 'ALL') return true;
  if (canEditRule === 'NONE') return true;

  if (canEditRule === 'CREATOR') {
    return locals.permissions[phoneNumber].isCreator;
  }

  if (canEditRule === 'ADMIN') {
    return locals.permissions[phoneNumber].isAdmin;
  }

  if (canEditRule === 'EMPLOYEE') {
    return locals.permissions[phoneNumber].isEmployee;
  }

  return false;
};

const getEmptySchedule = (scheduleNames) => {
  const scheduleArray = [];

  scheduleNames.forEach((name) => {
    scheduleArray.push({
      name,
      startTime: '',
      endTime: '',
    });
  });

  return scheduleArray;
};

const getEmptyVenue = (venueDescriptors) => {
  const venueArray = [];

  venueDescriptors.forEach((venueDescriptor) => {
    venueArray.push({
      venueDescriptor,
      geopoint: '',
      address: '',
      location: '',
    });
  });

  return venueArray;
};

const getDocRef = (conn, locals, activityRef) => {
  if (conn.req.body.template === 'office') {
    return rootCollections.offices.doc(activityRef.id);
  }

  return rootCollections
    .offices
    .doc(locals.office.id)
    .collection('Activities')
    .doc(activityRef.id);
};

const getAddendumDocRef = (officeDocRef) =>
  officeDocRef.collection('Addendum').doc();


const createAddendum = (conn, locals, activityRef) => {
  const activityId = activityRef.id;

  locals.batch.set(getAddendumDocRef(locals.officeDocRef), {
    activityId,
    timestamp: serverTimestamp,
    user: conn.requester.phoneNumber,
    comment: `${conn.requester.phoneNumber} created ${activityId}.`,
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
  const activityRef = rootCollections.activities.doc();
  locals.batch = db.batch();

  const schedule = conn.req.body.schedule
    || getEmptySchedule(locals.templateDocRef.get('schedule'));

  const venue = conn.req.body.venue
    || getEmptyVenue(locals.templateDocRef.get('venue'));

  const attachment = conn.req.body.attachment
    || locals.templateDocRef.get('attachment');

  locals.batch.set(activityRef, {
    venue,
    schedule,
    attachment,
    timestamp: serverTimestamp,
    officeId: locals.office.id,
    office: conn.req.body.office,
    template: conn.req.body.template,
    activityName: conn.req.body.activityName,
    docRef: getDocRef(conn, locals, activityRef),
    status: locals.templateDocRef.get('statusOnCreate'),
    canEditRule: locals.templateDocRef.get('canEditRule'),
  });

  Array.from(locals.allPhoneNumbers).forEach((phoneNumber) => {
    const assigneeDocRef = activityRef.collection('Assignees').doc(phoneNumber);

    locals.batch.set(assigneeDocRef, {
      // Storing here to avoid splitting the path
      // For the read logic.
      activityId: activityRef.id,
      canEdit: getCanEditValue(phoneNumber),
    });
  });

  if (conn.req.body.template !== 'admin') {
    createAddendum(conn, locals);

    return;
  }

  // This probably needs to be fixed...
  const phoneNumber = conn.req.body.attachment.phoneNumber.value;

  users.getUserByPhoneNumber(phoneNumber).then((userRecord) => {
    const phoneNumber = Object.keys(userRecord)[0];
    const record = userRecord[`${phoneNumber}`];

    if (!record.uid) {
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
  const officeId = locals.officeRef.id;
  locals.permissions = {};

  const promises = [];

  Array.from(locals.allPhoneNumbers).forEach((phoneNumber) => {
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

  Promise.all(promises).then((snapShots) => {
    snapShots.forEach((snapShot) => {
      const employeeQuerySnapshot = snapShot[0];
      const adminQuerySnapshot = snapShot[1];

      if (!employeeQuerySnapshot.empty) {
        const phoneNumber = employeeQuerySnapshot.docs[0].get('phoneNumber');
        locals.permissions[phoneNumber].isEmployee = true;
      }

      if (!adminQuerySnapshot.empty) {
        const phoneNumber = adminQuerySnapshot.docs[0].get('phoneNumber');
        locals.permissions[phoneNumber].isEmployee = true;
      }
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
  const schedules = conn.req.body.schedule;
  const scheduleNames = locals.templateDocRef.get('schedule');
  const schedulesValid = validateSchedules(schedules, scheduleNames);

  if (!schedulesValid.isValid) {
    sendResponse(conn, code.badRequest, schedulesValid.message);

    return;
  }

  const venues = conn.req.body.venue;
  const venueDescriptors = locals.templateDocRef.get('venue');
  const venuesValid = validateVenues(venues, venueDescriptors);

  if (!venuesValid.isValid) {
    sendResponse(conn, code.badRequest, venuesValid.message);

    return;
  }

  const attachment = conn.req.body.attachment;
  const attachmentValid = filterAttachment(attachment, locals);

  if (!attachmentValid.isValid) {
    sendResponse(conn, code.badRequest, attachmentValid.message);

    return;
  }

  if (!attachmentValid.promise) {
    handleAssignees(conn, locals);

    return;
  }

  queryForNameInOffices(conn, locals, attachmentValid.promise);
};


const createLocals = (conn, locals, result) => {
  const [templateDocRef, subscriptionQueryResult, officeQueryResult,] = result;

  if (!templateDocRef.exists) {
    sendResponse(
      conn,
      code.badRequest,
      `Template '${conn.req.body.template}' not found.`
    );

    return;
  }

  if (subscriptionQueryResult.empty && !conn.requester.isSupportRequest) {
    sendResponse(
      conn,
      code.forbidden,
      `No subscription found for the template: '${conn.req.body.template}`
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

  locals.templateDocRef = templateDocRef;
  locals.subscriptionDocRef = subscriptionQueryResult.docs[0];
  locals.officeDocRef = officeQueryResult.docs[0];

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

  locals.templateDocRef.get('include')
    .forEach((phoneNumber) => locals.allPhoneNumbers.add(phoneNumber));

  handleExtra(conn, locals);
};


const getDocs = (conn, locals) =>
  Promise
    .all([
      rootCollections
        .activityTemplates
        .doc(conn.req.body.template)
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
        .where('name', '==', conn.req.body.office)
        .limit(1)
        .get(),
    ])
    .then((result) => createLocals(conn, locals, result))
    .catch((error) => handleError(conn, error));


module.exports = (conn) => {
  const bodyResult = isValidRequestBody(conn.req.body, 'create');

  if (!bodyResult.isValid) {
    sendResponse(conn, code.badRequest, bodyResult.message);

    return;
  }

  const locals = {
    allPhoneNumbers: new Set().add(conn.requester.phoneNumber),
  };

  // TODO: bodyResult should also return phoneNumbers array
  bodyResult
    .phoneNumbers
    .forEach((phoneNumber) => locals.allPhoneNumbers.add(phoneNumber));

  getDocs(conn, locals);
};
