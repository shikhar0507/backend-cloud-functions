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
  rootCollections,
  getGeopointObject,
  db,
  serverTimestamp,
} = require('../../admin/admin');

const {
  validateVenues,
  getCanEditValue,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
} = require('./helper');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const updateDocsWithBatch = (conn, locals) => {
  const activityRef = rootCollections.activities.doc(conn.req.body.activityId);

  locals.batch.set(activityRef,
    locals.objects.updatedFields, {
      merge: true,
    });

  Object.keys(locals.objects.permissions)
    .forEach((phoneNumber) => {
      locals.batch.set(activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
          canEdit: getCanEditValue(locals, phoneNumber),
        }, {
          merge: true,
        });
    });

  locals.batch.set(rootCollections
    .offices
    .doc(locals.docs.activity.get('officeId'))
    .collection('Addendum')
    .doc(), {
      share: [],
      remove: null,
      action: 'update',
      updatedPhoneNumber: null,
      timestamp: serverTimestamp,
      user: conn.requester.phoneNumber,
      activityId: conn.req.body.activityId,
      template: locals.docs.activity.get('template'),
      location: getGeopointObject(conn.req.body.geopoint),
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      updatedFields: Object.keys(locals.objects.updatedFields),
      comment: null,
    });

  /** Ends the response. */
  locals.batch
    .commit()
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


const getUpdatedFields = (conn, locals) => {
  const activityName = locals.docs.activity.get('activityName');
  const activitySchedule = locals.docs.activity.get('schedule');
  const activityVenue = locals.docs.activity.get('venue');

  if (conn.req.body.hasOwnProperty('activityName')
    && activityName !== conn.req.body.activityName) {
    locals.objects.updatedFields.activityName = conn.req.body.activityName;
  }

  if (conn.req.body.hasOwnProperty('schedule')) {
    const scheduleNames = [];
    activitySchedule.forEach((schedule) => scheduleNames.push(schedule.name));

    console.log('scheduleNames', scheduleNames);

    const result = validateSchedules(conn.req.body, scheduleNames);

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    locals.objects.updatedFields.schedule = conn.req.body.schedule;
  }

  if (conn.req.body.hasOwnProperty('venue')) {
    const venueDescriptors = [];
    activityVenue
      .forEach((venue) => venueDescriptors.push(venue.venueDescriptor));

    console.log('venueDescriptors', venueDescriptors);

    const result = validateVenues(conn.req.body, venueDescriptors);

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    locals.objects.updatedFields.venue = conn.req.body.venue;
  }

  console.log('locals.objects.updatedFields', locals.objects.updatedFields);

  updateDocsWithBatch(conn, locals);
};


const handleAssignees = (conn, locals) => {
  const bodyAttachmentFields = Object.keys(conn.req.body.attachment);
  const activityAttachment = locals.docs.activity.get('attachment');

  const promises = [];

  bodyAttachmentFields.forEach((field) => {
    const oldPhoneNumber = activityAttachment[field].value;
    const item = conn.req.body.attachment[field];
    const type = item.type;
    const phoneNumber = item.value;

    if (type !== 'phoneNumber') return;

    if (phoneNumber === '') return;

    if (oldPhoneNumber !== '') {
      /** 
       * Unassign the old phone number from the activity.
       * Replace this with the new one from the attachment.
       */
      locals.batch.delete(rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(oldPhoneNumber)
      );
    }

    if (phoneNumber === oldPhoneNumber) return;

    const isRequester = phoneNumber === conn.requester.phoneNumber;

    locals.objects.permissions[phoneNumber] = {
      isAdmin: false,
      isEmployee: false,
      isCreator: isRequester,
    };

    promises.push(rootCollections
      .offices
      .doc(locals.static.officeId)
      .collection('Activities')
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .where('template', '==', 'employee')
      .limit(1)
      .get()
    );

    promises.push(rootCollections
      .offices
      .doc(locals.static.officeId)
      .collection('Activities')
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .where('template', '==', 'admin')
      .limit(1)
      .get()
    );
  });

  if (promises.length === 0) {
    getUpdatedFields(conn, locals);

    return;
  }

  Promise.all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];

        const template = doc.get('template');
        const phoneNumber = doc.get('attachment.Phone Number.value');

        if (template === 'admin') {
          locals.objects.permissions[phoneNumber].isAdmin = true;

          return;
        }

        locals.objects.permissions[phoneNumber].isEmployee = true;
      });

      locals.objects.updatedFields.attachment = conn.req.body.attachment;

      getUpdatedFields(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handleResult = (conn, result) => {
  const profileActivity = result[0];
  const activity = result[1];

  if (!conn.requester.isSupportRequest) {
    if (!conn.requester.isSupportRequest) {
      if (!profileActivity.exists) {
        sendResponse(
          conn,
          code.badRequest,
          `No activity found with the id: '${conn.req.body.activityId}'.`
        );

        return;
      }

      if (!profileActivity.get('canEdit')) {
        sendResponse(
          conn,
          code.forbidden,
          'You do not have the permission to edit this activity.'
        );

        return;
      }
    }
  }

  const locals = {
    batch: db.batch(),
    objects: {
      updatedFields: {
        timestamp: serverTimestamp,
      },
      permissions: {},
      attachment: activity.get('attachment'),
    },
    docs: {
      activity,
    },
    static: {
      officeId: activity.get('officeId'),
      canEditRule: activity.get('canEditRule'),
    },
  };

  const attachmentValid = filterAttachment(conn.req.body, locals);

  if (!attachmentValid.isValid) {
    sendResponse(conn, code.badRequest, attachmentValid.message);

    return;
  }

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


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'update');

  if (!result.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      result.message
    );

    return;
  }

  Promise.all([
    rootCollections
      .profiles
      .doc(conn.requester.phoneNumber)
      .collection('Activities')
      .doc(conn.req.body.activityId)
      .get(),
    rootCollections
      .activities
      .doc(conn.req.body.activityId)
      .get(),
  ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};
