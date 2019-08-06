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


const { code } = require('../../admin/responses');
const {
  httpsActions,
} = require('../../admin/constants');
const {
  rootCollections,
  getGeopointObject,
  db,
} = require('../../admin/admin');
const {
  toCustomerObject,
  activityName,
  validateVenues,
  getCanEditValue,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
  checkActivityAndAssignee,
} = require('./helper');
const {
  handleError,
  sendResponse,
  getAdjustedGeopointsFromVenue,
} = require('../../admin/utils');


const updateDocsWithBatch = (conn, locals) => {
  const activityRef = rootCollections
    .activities
    .doc(conn.req.body.activityId);
  const addendumDocRef = rootCollections
    .offices
    .doc(locals.docs.activity.get('officeId'))
    .collection('Addendum')
    .doc();

  const activityUpdateObject = {
    addendumDocRef,
    schedule: conn.req.body.schedule,
    venue: locals.objects.updatedFields.venue,
    timestamp: Date.now(),
    attachment: conn.req.body.attachment,
  };

  if (locals.docs.activity.get('adjustedGeopoints')) {
    activityUpdateObject
      .adjustedGeopoints = getAdjustedGeopointsFromVenue(
        locals.objects.updatedFields.venue
      );
  }

  locals.nameFieldUpdated = locals.docs.activity.get('attachment').hasOwnProperty('Name')
    && locals.docs.activity.get('attachment.Name.value')
    !== conn.req.body.attachment.Name.value;

  const numberFieldUpdated =
    locals.docs.activity.get('attachment').hasOwnProperty('Number')
    && locals.docs.activity.get('attachment.Number.value')
    !== conn.req.body.attachment.Number.value;

  if (locals.nameFieldUpdated || numberFieldUpdated) {
    activityUpdateObject.activityName = activityName({
      attachmentObject: conn.req.body.attachment,
      templateName: locals.docs.activity.get('template'),
      requester: conn.requester,
    });
  }

  const now = new Date();

  locals
    .batch
    .set(addendumDocRef, {
      /**
       * Sequence matters here. The `activityUpdateObject` object contains updated values.
       * Priority is of the `activityUpdateObject`.
       */
      activityData: Object
        .assign({}, locals.docs.activity.data(), activityUpdateObject),
      timestamp: Date.now(),
      action: httpsActions.update,
      dateString: now.toDateString(),
      user: conn.requester.phoneNumber,
      activityId: conn.req.body.activityId,
      /**
       * Required by `addendumOnCreate` function to delete old data from
       * init docs and update it the case of new ones. e.g., schedule and venue.
       */
      activityOld: locals.docs.activity.data(),
      userDeviceTimestamp: conn.req.body.timestamp,
      template: locals.docs.activity.get('template'),
      isSupportRequest: conn.requester.isSupportRequest,
      location: getGeopointObject(conn.req.body.geopoint),
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      provider: conn.req.body.geopoint.provider || null,
    });

  Object
    .keys(locals.objects.permissions)
    .forEach((phoneNumber) => {
      const isRequester = conn.requester.phoneNumber === phoneNumber;
      let addToInclude = true;

      if (locals.static.template === 'subscription' && isRequester) {
        addToInclude = false;
      }

      locals.batch.set(activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
          canEdit: getCanEditValue(locals, phoneNumber),
          /**
           * These people are not from the `share` array of the request body.
           * The update api doesn't accept the `share` array.
           */
          addToInclude,
        });
    });

  locals
    .batch
    .set(activityRef, activityUpdateObject, {
      merge: true,
    });

  if (locals.docs.activity.get('template') !== 'customer') {
    return locals
      .batch
      .commit()
      .then(() => sendResponse(conn, code.ok, 'Success'))
      .catch((error) => handleError(conn, error));
  }

  return rootCollections
    .offices
    .doc(locals.docs.activity.get('officeId'))
    .get()
    .then((doc) => {
      const customersData = doc.get('customersData') || {};

      customersData[conn.req.body.attachment.Name.value] = toCustomerObject(
        conn.req.body,
        locals.docs.activity.createTime.toDate().getTime());

      locals.batch.set(doc.ref, {
        customersData,
      }, {
          merge: true,
        });

      return locals.batch.commit();
    })
    .then(() => sendResponse(conn, code.ok, 'Success'))
    .catch((error) => handleError(conn, error));
};


const getUpdatedFields = (conn, locals) => {
  const activitySchedule = locals.docs.activity.get('schedule');
  const activityVenue = locals.docs.activity.get('venue');

  const scheduleNames = [];
  activitySchedule.forEach((schedule) => scheduleNames.push(schedule.name));

  const scheduleValidationResult = validateSchedules(conn.req.body, scheduleNames);

  if (!scheduleValidationResult.isValid) {
    return sendResponse(conn, code.badRequest, scheduleValidationResult.message);
  }

  const venueDescriptors = [];
  activityVenue
    .forEach((venue) => venueDescriptors.push(venue.venueDescriptor));

  const venueValidationResult
    = validateVenues(conn.req.body, venueDescriptors);

  if (!venueValidationResult.isValid) {
    return sendResponse(conn, code.badRequest, venueValidationResult.message);
  }

  locals.objects.updatedFields.venue = venueValidationResult.venues;

  // handleLeave(conn, locals);

  return updateDocsWithBatch(conn, locals);
  // handlePayroll(conn, locals);
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

    /**
     * Number was removed so the person needs to be unassigned from
     * the activity.
     */
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

    /**
     * The `newPhoneNumber` is not an empty `string`; it will be a valid
     * phone number since the attachment validation function checks that out.
     */
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

    if (locals.static.canEditRule === 'EMPLOYEE') {
      promises.push(rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection('Activities')
        .where('attachment.Employee Contact.value', '==', newPhoneNumber)
        .where('template', '==', 'employee')
        .limit(1)
        .get()
      );
    }

    if (locals.static.canEditRule === 'ADMIN') {
      promises.push(rootCollections
        .offices
        .doc(locals.static.officeId)
        .collection('Activities')
        .where('attachment.Admin.value', '==', newPhoneNumber)
        .where('template', '==', 'admin')
        .limit(1)
        .get()
      );
    }
  });

  if (new Set()
    .add('department')
    .add('branch')
    .has(locals.static.template)
    && conn.req.body.attachment.Name.value
    !== locals.docs.activity.get('attachment').Name.value) {
    return sendResponse(
      conn,
      code.conflict,
      `The ${locals.static.template} name cannot be edited.`
    );
  }

  if (locals.static.template === 'employee'
    && locals.docs.activity.get('attachment.Employee Contact.value')
    !== conn.req.body.attachment['Employee Contact'].value) {
    return sendResponse(
      conn,
      code.conflict,
      `Phone numbers cannot be updated for the template:`
      + ` ${locals.static.template}`
    );
  }


  /**
   * These templates aren't allowed to be updated from the client-side app.
   * Updating these phone numbers is done via the admin panel.
   */
  if (new Set()
    .add('subscription')
    .add('admin')
    .has(locals.static.template)) {
    return sendResponse(
      conn,
      code.conflict,
      `Phone numbers cannot be updated for the template:`
      + ` ${locals.static.template}`
    );
  }

  if (promises.length === 0) {
    return getUpdatedFields(conn, locals);
  }

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        let phoneNumber;
        const template = doc.get('template');

        const isAdmin = template === 'admin';

        if (isAdmin) {
          phoneNumber = doc.get('attachment.Admin.value');
          locals.objects.permissions[phoneNumber].isAdmin = isAdmin;
        }

        const isEmployee = template === 'employee';

        if (isEmployee) {
          phoneNumber = doc.get('attachment.Employee Contact.value');
          locals.objects.permissions[phoneNumber].isEmployee = isEmployee;
        }
      });

      return getUpdatedFields(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};


const resolveQuerySnapshotShouldNotExistPromises = (conn, locals, result) => {
  const promises = result.querySnapshotShouldNotExist;

  if (promises.length === 0) {
    return handleAssignees(conn, locals);
  }

  /**
   * No need to query for the `Name` to be unique since that check
   * has already been performed while creating an activity. Of course,
   * only when the Name.value hasn't changed.
   */
  if (locals.docs.activity.get('attachment').hasOwnProperty('Name')
    && locals.docs.activity.get('attachment').Name.value
    === conn.req.body.attachment.Name.value) {
    return handleAssignees(conn, locals);
  }

  if (locals.docs.activity.get('attachment').hasOwnProperty('Number')
    && locals.docs.activity.get('attachment').Number.value
    === conn.req.body.attachment.Number.value) {
    return handleAssignees(conn, locals);
  }

  Promise
    .all(promises)
    .then((snapShots) => {
      let successful = true;
      let message = null;

      for (const snapShot of snapShots) {
        const filters = snapShot.query._queryOptions.fieldFilters;
        const argOne = filters[0].value;

        if (!snapShot.empty) {
          successful = false;
          message = `The value ${argOne} is already in use`;
          break;
        }
      }

      if (!successful) {
        return sendResponse(conn, code.badRequest, message);
      }

      return handleAssignees(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};


const resolveQuerySnapshotShouldExistPromises = (conn, locals, result) => {
  const promises = result.querySnapshotShouldExist;

  if (promises.length === 0) {
    return resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);
  }

  Promise
    .all(promises)
    .then(snapShots => {
      let successful = true;
      let message;

      for (const snapShot of snapShots) {
        const filters = snapShot.query._queryOptions.fieldFilters;
        console.log('filters', filters);
        const argOne = filters[0].value;
        let argTwo;

        message = `No template found with the name: ${argOne} from`
          + ` the attachment.`;

        if (locals.static.template !== 'subscription') {
          argTwo = filters[1].value;
          message = `The ${argOne} ${argTwo} does not exist in`
            + ` the office: ${locals.static.office}.`;
        }

        if (snapShot.empty) {
          successful = false;
          break;
        }
      }

      if (!successful) {
        return sendResponse(conn, code.badRequest, message);
      }

      return resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);
    })
    .catch((error) => handleError(conn, error));
};


const resolveProfileCheckPromises = (conn, locals, result) => {
  const promises = result.profileDocShouldExist;

  if (promises.length === 0) {
    return resolveQuerySnapshotShouldExistPromises(conn, locals, result);
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

        /** A doc in `/Profiles` can exist for a user even when
         * they haven't actually done the `OTP`.
         *
         * This is because when a new phone number is introduced
         * to the system, the activity Activity `onWrite` function
         * creates their `Profile` regardless.
         *
         * To counter that, we actually check the value of the field
         * `uid` in the `Profile` doc. For all the numbers introduced
         * automatically and not by using the `OTP`, the uid will be `null`.
         */
        if (!doc.get('uid')) {
          successful = false;
          break;
        }
      }

      if (!successful) {
        return sendResponse(conn, code.badRequest, message);
      }

      return resolveQuerySnapshotShouldExistPromises(conn, locals, result);
    })
    .catch((error) => handleError(conn, error));
};


const handleAttachment = (conn, locals) => {
  const result = filterAttachment({
    bodyAttachment: conn.req.body.attachment,
    templateAttachment: locals.docs.activity.get('attachment'),
    template: locals.docs.activity.get('template'),
    officeId: locals.docs.activity.get('officeId'),
    office: locals.docs.activity.get('office'),
  });

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  /**
   * Changing the name of an office will render all the activities
   * of that office useless since we are currently not updating
   * the office name in the respective activities.
   */
  if (conn.req.body.template === 'office'
    && conn.req.body.attachment.Name.value !== locals.static.office) {
    return sendResponse(
      conn,
      code.conflict,
      `Updating the 'Name' of an 'Office' is not allowed.`
    );
  }

  if (result.querySnapshotShouldExist.length === 0
    && result.querySnapshotShouldNotExist.length === 0
    && result.profileDocShouldExist.length === 0) {
    return handleAssignees(conn, locals);
  }

  return resolveProfileCheckPromises(conn, locals, result);
};


const handleResult = (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  const [activityDoc] = docs;

  if (activityDoc.get('template') === 'subscription') {
    return sendResponse(
      conn,
      code.badRequest,
      'Subscription activity cannot be updated'
    );
  }

  const locals = {
    batch: db.batch(),
    objects: {
      updatedFields: {
        timestamp: Date.now(),
      },
      permissions: {},
      attachment: activityDoc.get('attachment'),
    },
    docs: {
      activity: activityDoc,
    },
    static: {
      officeId: activityDoc.get('officeId'),
      canEditRule: activityDoc.get('canEditRule'),
      template: activityDoc.get('template'),
      office: activityDoc.get('office'),
    },
  };

  return handleAttachment(conn, locals);
};


module.exports = (conn) => {
  if (conn.req.method !== 'PATCH') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /update endpoint.`
      + ` Use PATCH.`
    );
  }

  const result = isValidRequestBody(conn.req.body, httpsActions.update);

  if (!result.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      result.message
    );
  }

  return Promise
    .all([
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(conn.requester.phoneNumber)
        .get(),
    ])
    .then(result => handleResult(conn, result))
    .catch(error => handleError(conn, error));
};
