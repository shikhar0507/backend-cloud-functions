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
  code
} = require('../../admin/responses');
const {
  httpsActions,
} = require('../../admin/constants');
const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const {
  activityName,
  validateVenues,
  filterAttachment,
  validateSchedules,
  isValidRequestBody,
  checkActivityAndAssignee,
  attendanceConflictHandler,
} = require('./helper');
const {
  handleError,
  sendResponse,
  getRelevantTime,
  getScheduleDates,
  getCanEditValue,
  getAdjustedGeopointsFromVenue,
} = require('../../admin/utils');


const updateDocsWithBatch = async (conn, locals) => {
  const activityRef = rootCollections.activities.doc(conn.req.body.activityId);
  const {
    activityUpdateObject
  } = locals;

  if (locals.activityDoc.get('schedule').length > 0) {
    activityUpdateObject
      .relevantTime = getRelevantTime(conn.req.body.schedule);
    activityUpdateObject
      .scheduleDates = getScheduleDates(conn.req.body.schedule);
  }

  if (locals.activityDoc.get('adjustedGeopoints')) {
    activityUpdateObject
      .adjustedGeopoints = getAdjustedGeopointsFromVenue(
        activityUpdateObject.venue
      );
  }

  /**
   * Checking if field with the name `Name` exists
   */
  const nameFieldUpdated = locals.activityDoc.get('attachment.Name') &&
    locals.activityDoc.get('attachment.Name.value') !==
    conn.req.body.attachment.Name.value;
  const numberFieldUpdated = locals.activityDoc.get('attachment.Number') &&
    locals.activityDoc.get('attachment.Number.value') !==
    conn.req.body.attachment.Number.value;

  if (nameFieldUpdated || numberFieldUpdated) {
    activityUpdateObject.activityName = activityName({
      templateName: locals.activityDoc.get('template'),
      attachmentObject: conn.req.body.attachment,
      requester: conn.requester,
    });
  }

  locals
    .batch
    .set(activityUpdateObject.addendumDocRef, {
      /**
       * Sequence matters here. The `activityUpdateObject` object contains updated values.
       * Priority is of the `activityUpdateObject`.
       */
      activityData: Object.assign({}, locals.activityDoc.data(), activityUpdateObject),
      timestamp: Date.now(),
      action: httpsActions.update,
      user: conn.requester.phoneNumber,
      activityId: conn.req.body.activityId,
      /**
       * Required by `addendumOnCreate` function to delete old data from
       * init docs and update it the case of new ones. e.g., schedule and venue.
       */
      activityOld: locals.activityDoc.data(),
      userDeviceTimestamp: conn.req.body.timestamp,
      template: locals.templateDoc.get('name'),
      isSupportRequest: conn.requester.isSupportRequest,
      location: getGeopointObject(conn.req.body.geopoint),
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      provider: conn.req.body.geopoint.provider || null,
      userDisplayName: conn.requester.displayName,
    });

  locals
    .newPhoneNumbers
    .filter(Boolean)
    .forEach(phoneNumber => {
      const isRequester = conn.requester.phoneNumber === phoneNumber;
      let addToInclude = true;

      if (locals.templateDoc.get('name') === 'subscription' && isRequester) {
        addToInclude = false;
      }

      locals.batch.set(
        activityRef
        .collection('Assignees')
        .doc(phoneNumber), {
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

  if (locals.activityDoc.get('template') === 'employee') {
    const sv1 = activityUpdateObject.attachment['First Supervisor'].value;
    const sv2 = activityUpdateObject.attachment['Second Supervisor'].value;
    const sv3 = activityUpdateObject.attachment['Third Supervisor'].value;

    if (!sv1 && !sv2 && !sv3) {
      return sendResponse(
        conn,
        code.conflict,
        `Employee's First, Second and Third Supervisors cannot be empty at the same time`
      );
    }
  }

  if (locals.activityDoc.get('template') === 'office') {
    if (!activityUpdateObject.attachment['First Contact'].value &&
      !activityUpdateObject.attachment['Second Contact'].value) {
      return sendResponse(
        conn,
        code.conflict,
        `Office's First and Second Contacts cannot be empty` +
        ` at the same time.`
      );
    }

    if (activityUpdateObject.attachment['First Contact'].value ===
      activityUpdateObject.attachment['Second Contact'].value) {
      return sendResponse(
        conn,
        code.conflict,
        `Office's First and Second Contacts should be distinct` +
        ` phone numbers`
      );
    }
  }

  await locals
    .batch
    .commit();

  return sendResponse(conn, code.ok, 'Success');
};


const getUpdatedFields = (conn, locals) => {
  const activitySchedule = locals.activityDoc.get('schedule');
  const activityVenue = locals.activityDoc.get('venue');
  const scheduleNames = [];
  const venueDescriptors = [];

  activitySchedule.forEach(schedule => scheduleNames.push(schedule.name));

  const scheduleValidationResult = validateSchedules(conn.req.body, scheduleNames);

  if (!scheduleValidationResult.isValid) {
    return sendResponse(conn, code.badRequest, scheduleValidationResult.message);
  }

  activityVenue.forEach(venue => venueDescriptors.push(venue.venueDescriptor));

  const venueValidationResult = validateVenues(conn.req.body, venueDescriptors);

  if (!venueValidationResult.isValid) {
    return sendResponse(conn, code.badRequest, venueValidationResult.message);
  }

  locals.activityUpdateObject.venue = venueValidationResult.venues;

  return updateDocsWithBatch(conn, locals);
};


const handleAssignees = (conn, locals) => {
  const bodyAttachmentFields = Object.keys(conn.req.body.attachment);
  const {
    attachment: activityAttachment,
    template
  } = locals.activityDoc.data();
  bodyAttachmentFields.forEach((field) => {
    const item = conn.req.body.attachment[field];
    const type = item.type;

    if (type !== 'phoneNumber') {
      return;
    }

    const {
      value: newPhoneNumber
    } = item;
    const {
      value: oldPhoneNumber
    } = activityAttachment[field];

    /** Nothing has changed, so no point in creating promises. */
    if (oldPhoneNumber === newPhoneNumber) {
      return;
    }

    locals.newPhoneNumbers.push(newPhoneNumber);

    /**
     * Number was removed so the person needs to be unassigned from
     * the activity.
     */
    if (oldPhoneNumber !== '' && newPhoneNumber === '') {
      locals.batch.delete(
        rootCollections
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
      locals.batch.delete(
        rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .collection('Assignees')
        .doc(oldPhoneNumber)
      );
    }
  });

  if (new Set(['branch', 'department']).has(template) &&
    conn.req.body.attachment.Name.value !==
    locals.activityDoc.get('attachment.Name.value')) {
    return sendResponse(
      conn,
      code.conflict,
      `The ${template} name cannot be edited.`
    );
  }

  if (template === 'employee' &&
    locals.activityDoc.get('attachment.Phone Number.value') !==
    conn.req.body.attachment['Phone Number'].value) {
    return sendResponse(
      conn,
      code.conflict,
      `Phone numbers cannot be updated for the template: ${template}`
    );
  }

  /**
   * These templates aren't allowed to be updated from the client-side app.
   * Updating these phone numbers is done via the admin panel.
   */
  if (new Set(['subscription', 'admin']).has(template)) {
    return sendResponse(
      conn,
      code.conflict,
      `Phone numbers cannot be updated for the template: ${template}`
    );
  }

  return getUpdatedFields(conn, locals);
};


const resolveQuerySnapshotShouldNotExistPromises = async (conn, locals, result) => {
  // const promises = result.querySnapshotShouldNotExist;

  /**
   * No need to query for the `Name` to be unique since that check
   * has already been performed while creating an activity. Of course,
   * only when the Name.value hasn't changed.
   */
  if (locals.activityDoc.get('attachment.Name') &&
    locals.activityDoc.get('attachment.Name.value') ===
    conn.req.body.attachment.Name.value) {
    return handleAssignees(conn, locals);
  }

  if (locals.activityDoc.get('attachment.Number') &&
    locals.activityDoc.get('attachment.Number.value') ===
    conn.req.body.attachment.Number.value) {
    return handleAssignees(conn, locals);
  }

  const snapShots = await Promise.all(result.querySnapshotShouldNotExist);

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
};


const resolveQuerySnapshotShouldExistPromises = async (conn, locals, result) => {
  const snapShots = await Promise.all(result.querySnapshotShouldExist);
  let message;

  for (const snapShot of snapShots) {
    const filters = snapShot.query._queryOptions.fieldFilters;
    const argOne = filters[0].value;

    message = `No template found with the name: ${argOne} from` +
      ` the attachment.`;

    if (snapShot.empty) {
      return sendResponse(conn, code.badRequest, message);
    }
  }

  return resolveQuerySnapshotShouldNotExistPromises(conn, locals, result);
};


const resolveProfileCheckPromises = async (conn, locals, result) => {
  const docs = await Promise.all(result.profileDocShouldExist);

  let successful = true;
  let message = null;

  for (const doc of docs) {
    message = `No user found with the phone number:` +
      ` ${doc.id} from the attachment.`;

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
};


const handleAttachment = (conn, locals) => {
  const result = filterAttachment({
    bodyAttachment: conn.req.body.attachment,
    templateAttachment: locals.activityDoc.get('attachment'),
    template: locals.activityDoc.get('template'),
    officeId: locals.activityDoc.get('officeId'),
    office: locals.activityDoc.get('office'),
  });

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  /**
   * Changing the name of an office will render all the activities
   * of that office useless since we are currently not updating
   * the office name in the respective activities.
   */
  if (locals.activityDoc.get('template') === 'office' &&
    conn.req.body.attachment.Name.value !== locals.activityDoc.get('office')) {
    return sendResponse(
      conn,
      code.conflict,
      `Updating the 'Name' of an 'Office' is not allowed.`
    );
  }

  if (result.querySnapshotShouldExist.length === 0 &&
    result.querySnapshotShouldNotExist.length === 0 &&
    result.profileDocShouldExist.length === 0) {
    return handleAssignees(conn, locals);
  }

  return resolveProfileCheckPromises(conn, locals, result);
};


const handleResult = async (conn, docs) => {
  const result = checkActivityAndAssignee(
    docs,
    conn.requester.isSupportRequest
  );

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  const [activityDoc] = docs;
  const {
    template
  } = activityDoc.data();

  const [templateDoc] = (
    await rootCollections
    .activityTemplates
    .where('name', '==', template)
    .limit(1)
    .get()
  ).docs;

  if (!getCanEditValue(activityDoc, conn.requester)) {
    return sendResponse(
      conn,
      code.forbidden,
      `You cannot edit this activity`
    );
  }

  if (template === 'subscription') {
    return sendResponse(
      conn,
      code.badRequest,
      'Subscription activity cannot be updated'
    );
  }

  const locals = {
    templateDoc,
    activityDoc,
    activityUpdateObject: {
      attachment: conn.req.body.attachment,
      schedule: conn.req.body.schedule,
      timestamp: Date.now(),
      addendumDocRef: rootCollections.offices.doc(activityDoc.get('officeId'))
        .collection('Addendum')
        .doc(),
    },
    newPhoneNumbers: [],
    batch: db.batch(),
    objects: {
      updatedFields: {
        timestamp: Date.now(),
      },
      attachment: activityDoc.get('attachment'),
    },
  };

  if (template === 'leave' || template === 'attendance regularization') {
    const {
      conflictingDate,
      conflictingTemplate,
    } = await attendanceConflictHandler({
      schedule: conn.req.body.schedule,
      phoneNumber: conn.requester.phoneNumber,
      office: activityDoc.get('office'),
    });

    if (conflictingDate) {
      const message = `Cannot update the ${template}` +
        ` ${conflictingTemplate} is already set for the date: ${conflictingDate}`;

      return sendResponse(conn, code.badRequest, message);
    }
  }

  return handleAttachment(conn, locals);
};


module.exports = (conn) => {
  if (conn.req.method !== 'PATCH') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /update endpoint.` +
      ` Use PATCH.`
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
