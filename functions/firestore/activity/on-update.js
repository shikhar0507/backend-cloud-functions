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

const { httpsActions, } = require('../../admin/attachment-types');

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

  Object
    .keys(locals.objects.permissions)
    .forEach((phoneNumber) => {
      locals.batch.set(activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
          canEdit: getCanEditValue(locals, phoneNumber),
        });
    });

  locals.batch.set(rootCollections
    .offices
    .doc(locals.docs.activity.get('officeId'))
    .collection('Addendum')
    .doc(), {
      user: conn.requester.phoneNumber,
      share: null,
      remove: null,
      action: httpsActions.update,
      status: null,
      comment: null,
      template: null,
      location: getGeopointObject(conn.req.body.geopoint),
      timestamp: serverTimestamp,
      userDeviceTimestamp: new Date(conn.req.body.timestamp),
      activityId: conn.req.body.activityId,
      activityName: locals.static.activityName,
      updatedFields: {
        requestBody: conn.req.body,
        activityBody: locals.docs.activity,
      },
      updatedPhoneNumber: null,
      isSupportRequest: conn.requester.isSupportRequest,
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

    const result = validateSchedules(conn.req.body, scheduleNames);

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    locals.objects.updatedFields.schedule = result.schedules;
  }

  if (conn.req.body.hasOwnProperty('venue')) {
    const venueDescriptors = [];
    activityVenue
      .forEach((venue) => venueDescriptors.push(venue.venueDescriptor));

    const result = validateVenues(conn.req.body, venueDescriptors);

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    locals.objects.updatedFields.venue = result.venues;
  }

  updateDocsWithBatch(conn, locals);
};


const handleAssignees = (conn, locals) => {
  const bodyAttachmentFields = Object.keys(conn.req.body.attachment);
  const activityAttachment = locals.docs.activity.get('attachment');

  const promises = [];

  bodyAttachmentFields.forEach((field) => {
    const item = conn.req.body.attachment[field];
    const type = item.type;

    if (type !== 'phoneNumber') return;

    const newPhoneNumber = item.value;
    const oldPhoneNumber = activityAttachment[field].value;

    /** Nothing has changed, so no point in creating promises. */
    if (oldPhoneNumber === newPhoneNumber) return;

    if (oldPhoneNumber !== '' && newPhoneNumber === '') {
      locals.batch.delete(rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(oldPhoneNumber)
      );

      /**
       * New phone number is an empty string which is not a valid phone number
       * Not creating promises in that case.
       */
      return;
    }

    if (oldPhoneNumber !== '' && newPhoneNumber !== '') {
      locals.batch.delete(rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(oldPhoneNumber)
      );
    }

    const isRequester = newPhoneNumber === conn.requester.phoneNumber;

    locals.objects.permissions[newPhoneNumber] = {
      isAdmin: false,
      isEmployee: false,
      isCreator: isRequester,
    };

    promises.push(rootCollections
      .offices
      .doc(locals.static.officeId)
      .collection('Activities')
      .where('attachment.Phone Number.value', '==', newPhoneNumber)
      .where('template', '==', 'employee')
      .limit(1)
      .get()
    );

    promises.push(rootCollections
      .offices
      .doc(locals.static.officeId)
      .collection('Activities')
      .where('attachment.Phone Number.value', '==', newPhoneNumber)
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

      getUpdatedFields(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const resolveQuerySnapshotShouldNotExistPromises = (conn, locals, result) => {
  const promises = result.querySnapshotShouldNotExist;

  if (promises.length === 0) {
    handleAssignees(conn, locals);

    return;
  }

  const attachmentFromActivity = locals.docs.activity.get('attachment');
  const attachmentFromBody = conn.req.body.attachment;

  if (attachmentFromActivity.hasOwnProperty('Name')) {
    if (attachmentFromActivity.Name.value === attachmentFromBody.Name.value) {
      handleAssignees(conn, locals);

      return;
    }
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
            + ` ${locals.static.office} with Name: ${argOne} &`
            + ` template: ${argTwo}.`;
          break;
        }
      }

      if (!successful) {
        sendResponse(conn, code.badRequest, message);

        return;
      }

      handleAssignees(conn, locals);

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

        if (locals.static.template !== 'subscription') {
          argTwo = filters[1]._value;
          message = `The ${argOne} ${argTwo} does not exist in`
            + ` the office: ${locals.static.office}.`;
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

  if (result.querySnapshotShouldExist.length === 0
    && result.querySnapshotShouldNotExist.length === 0
    && result.profileDocShouldExist.length === 0) {
    handleAssignees(conn, locals);

    return;
  }

  locals.objects.updatedFields.attachment = conn.req.body.attachment;

  resolveProfileCheckPromises(conn, locals, result);
};


const handleResult = (conn, result) => {
  const profileActivity = result[0];
  const activity = result[1];

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
      activityName: activity.get('activityName'),
      template: activity.get('template'),
      office: activity.get('office'),
    },
  };

  handleAttachment(conn, locals);
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
