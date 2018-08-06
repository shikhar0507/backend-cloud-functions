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
  isValidDate,
  isValidGeopoint,
  isNonEmptyString,
  isE164PhoneNumber,
} = require('../../admin/utils');


/**
 * Handles whether a person has the authority to edit an activity after it is
 * created.
 *
 * @param {Object} locals Object containing local data.
 * @param {string} phoneNumber Number to check the `canEdit` rule for.
 * @param {string} requesterPhoneNumber Phone number of the requester.
 * @param {Array} assignees Array of people who are assignees of the activity.
 * @returns {boolean} Depends on the subscription and the phoneNumber in args.
 */
const handleCanEdit = (
  locals,
  phoneNumber,
  requesterPhoneNumber,
  assignees = []
) => {
  if (locals.canEditRule === 'ALL') return true;

  if (locals.canEditRule === 'NONE') return false;

  /** List of assignees... */
  if (locals.canEditRule === 'FROM_INCLUDE') {
    if (locals.include.indexOf(phoneNumber) > -1
      || assignees.indexOf(phoneNumber) > -1) {
      return true;
    }

    return false;
  }

  // TODO: this needs to be implemented.
  if (locals.canEditRule === 'PEOPLE_TYPE') return true;

  if (locals.canEditRule === 'CREATOR') {
    if (phoneNumber === requesterPhoneNumber) {
      return true;
    }

    return false;
  }

  return false;
};


/**
 * Validates the schedules where the there is a name field present,
 * along with the condition that the endTime >= startTime.
 *
 * @param {Array} requestBodySchedule Schedules from request body.
 * @param {Array} scheduleNames Schedules from template.
 * @returns {Array} Of valid schedules.
 */
const filterSchedules = (requestBodySchedule, scheduleNames) => {
  const defaultSchedules = [];

  if (!scheduleNames) return defaultSchedules;

  scheduleNames.forEach((schedule) => {
    defaultSchedules.push({
      name: schedule,
      startTime: '',
      endTime: '',
    });
  });

  if (scheduleNames.length === 0) return defaultSchedules;

  if (!Array.isArray(requestBodySchedule)) return defaultSchedules;

  let validSchedules = [];

  scheduleNames.forEach((name) => {
    requestBodySchedule.forEach((schedule) => {
      if (schedule.name !== name) return;

      if (!schedule.hasOwnProperty('startTime')) return;

      /** Both `startTime` and `endTime` are absent. */
      if (!isValidDate(schedule.startTime)
        && !isValidDate(schedule.endTime)) return;

      /** Schedule has valid `startTime` */
      if (isValidDate(schedule.startTime) && !schedule.hasOwnProperty('endTime')) {
        validSchedules.push({
          name: schedule.name,
          startTime: new Date(schedule.startTime),
          endTime: new Date(schedule.startTime),
        });

        return;
      }

      if (isValidDate(schedule.endTime) && isValidDate(schedule.startTime)
        && schedule.endTime >= schedule.startTime) {
        validSchedules.push({
          name: schedule.name,
          startTime: new Date(schedule.startTime),
          endTime: new Date(schedule.endTime),
        });
      }
    });
  });

  if (validSchedules.length === 0) {
    validSchedules = defaultSchedules;
  }

  return validSchedules;
};


/**
 * Validates the venues based on the `venueDescriptors` and
 * valid geopoint object.
 *
 * @param {Array} requestBodyVenue Venue objects from request.
 * @param {Array} venueDescriptors Venue descriptors from template.
 * @returns {Array} Valid venues based on template.
 */
const filterVenues = (requestBodyVenue, venueDescriptors) => {
  let validVenues = [];
  const defaultVenues = [];

  if (!venueDescriptors) return defaultVenues;

  const getGeopointObject = require('../../admin/admin').getGeopointObject;

  venueDescriptors.forEach((venueDescriptor) => {
    defaultVenues.push({
      venueDescriptor,
      location: '',
      address: '',
      geopoint: null,
    });
  });

  if (!Array.isArray(requestBodyVenue)) return defaultVenues;

  if (requestBodyVenue.length === 0) return defaultVenues;

  venueDescriptors.forEach((venueDescriptor) => {
    requestBodyVenue.forEach((venue) => {
      if (venue.venueDescriptor !== venueDescriptor) return;

      if (!isValidGeopoint(venue.geopoint)) return;

      validVenues.push({
        geopoint: getGeopointObject(venue.geopoint),
        venueDescriptor: venue.venueDescriptor,
        location: venue.location || '',
        address: venue.address || '',
      });
    });
  });

  if (validVenues.length === 0) {
    validVenues = defaultVenues;
  }

  return validVenues;
};


/**
 * Validates the attachment object based on the `template`.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const filterAttachment = (conn, locals) => {
  const weekdays = require('../../admin/attachment-types').weekdays;

  const messageObject = {
    isValid: true,
    message: null,
    promise: null,
  };

  const fields = Object.keys(locals.template.attachment);

  /**
   * Some templates **may** have empty attachment object. For those cases,
   * it's allowed to skip the template in the request body.
   */
  if (fields.length > 0
    && !conn.req.body.hasOwnProperty('attachment')) {
    messageObject.isValid = false;
    messageObject.message = `The 'attachment' field is missing from the request body.`;

    return messageObject;
  }

  for (const field of fields) {
    const item = conn.req.body.attachment[field];

    if (!conn.req.body.attachment.hasOwnProperty(field)) {
      messageObject.isValid = false;
      messageObject.message = `The '${field}' field is missing`
        + ` from attachment.`;
      break;
    }

    if (!item.hasOwnProperty('type')) {
      messageObject.isValid = false;
      messageObject.message = `The 'type' field is missing from`
        + ` the Object '${field}'.`;
      break;
    }

    if (!item.hasOwnProperty('value')) {
      messageObject.isValid = false;
      messageObject.message = `The 'type' field is missing from`
        + ` the Object '${field}'.`;
      break;
    }

    const type = item.type;
    const value = item.value;

    if (typeof type !== 'string') {
      messageObject.isValid = false;
      messageObject.message = `The 'type' field in '${field}' field`
        + ` should be a non-empty string.`;
      break;
    }

    if (typeof value !== 'string') {
      messageObject.isValid = false;
      messageObject.message = `The 'value' field in '${field}' field`
        + ` should be a non-empty string.`;
      break;
    }

    if (field === 'Name') {
      if (!isNonEmptyString(value)) {
        messageObject.isValid = false;
        messageObject.message = `The Object '${field}' should have`
          + ` a string in the 'value' field.`;
        break;
      }

      if (type !== 'office') {
        messageObject.promise = locals
          .docRef
          .collection('Activities')
          .where('Name', '==', value)
          .where('template', '==', type)
          /** Docs exist uniquely based on `Name`, and `template`. */
          .limit(1)
          .get();
      }
    }

    if (type === 'phoneNumber') {
      if (value !== '') {
        if (!isE164PhoneNumber(value)) {
          messageObject.isValid = false;
          messageObject.message = `The phone number in the`
            + ` field '${field}' is invalid.`;
          break;
        }
      }
    }

    if (type === 'weekday') {
      if (value !== '') {
        if (!weekdays.has(value)) {
          messageObject.isValid = false;
          messageObject.message = `The value '${value}' in the`
            + `field '${field}' should be a weekday.`;
        }
      }
    }
  }

  return messageObject;
};


/**
 * Checks the `template` and `office` fields from the request body.
 *
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object
 */
const validateCreateRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('template')) {
    return {
      message: 'The "template" field is missing from the request body.',
      isValidBody: false,
    };
  }

  if (!isNonEmptyString(body.template)) {
    return {
      message: 'The "template" field should be a non-empty string.',
      isValidBody: false,
    };
  }

  if (!body.hasOwnProperty('office')) {
    return {
      message: 'The "office" field is missing from the request body.',
      isValidBody: false,
    };
  }

  if (!isNonEmptyString(body.office)) {
    return {
      message: 'The "office" field should be a non-empty string.',
      isValidBody: false,
    };
  }

  return successMessage;
};


/**
 * Checks if the update body has valid data to make an update request.
 *
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object
 */
const validateUpdateRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('activityName')
    && !body.hasOwnProperty('description')
    && !body.hasOwnProperty('venue')
    && !body.hasOwnProperty('schedule')) {
    return {
      message: 'The request body has no usable fields.'
        + ' Please add at least any (or all) of these: "title",'
        + ' "description", "schedule", or "venue"'
        + ' in the request body to make a successful request.',
      isValidBody: false,
    };
  }

  if (body.hasOwnProperty('activityName')
    && !isNonEmptyString(body.activityName)) {
    return {
      message: 'The "activityName" field in the request body should be a non-empty string.',
      isValidBody: false,
    };
  }

  return successMessage;
};


/**
 * Checks if the request body has a valid `comment`.
 *
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object
 */
const validateCommentRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('comment')) {
    return {
      message: 'The "comment" field is missing from the request body.',
      isValidBody: false,
    };
  }

  if (!isNonEmptyString(body.comment)) {
    return {
      message: 'The "comment" field should be a non-empty string.',
      isValidBody: false,
    };
  }

  return successMessage;
};


/**
 * Checks if the request body has a valid `status` field.
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object
 */
const validateChangeStatusRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('status')) {
    return {
      message: 'The "status" field is missing from the request body.',
      isValidBody: false,
    };
  }

  if (!isNonEmptyString(body.status)) {
    return {
      message: 'The "status" field should be a non-empty string.',
      isValidBody: false,
    };
  }

  return successMessage;
};


/**
 * Checks if the request body has the `remove` field as an array
 * with at least one valid phone number remove from the
 * activity assignee list.
 *
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object
 */
const validateRemoveRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('remove')) {
    return {
      message: 'The "remove" array is missing from the request body',
      isValidBody: false,
    };
  }

  if (!Array.isArray(body.remove)) {
    return {
      message: 'The "remove" field in the request body should be an array.',
      isValidBody: false,
    };
  }

  if (body.remove.length === 0) {
    return {
      message: 'The "remove" array cannot be empty.',
      isValidBody: false,
    };
  }

  const validPhoneNumbers = [];

  body.remove.forEach((phoneNumber) => {
    if (!isE164PhoneNumber(phoneNumber)) return;

    validPhoneNumbers.push(phoneNumber);
  });

  if (validPhoneNumbers.length === 0) {
    return {
      message: 'No valid phone numbers found in the "remove" array from the'
        + ' request body.',
      isValidBody: false,
    };
  }

  return successMessage;
};


/**
 * Checks if the request body has the `share` field as an array
 * with at least one valid phone number to add to the activity
 * assignee list.
 *
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object
 */
const validateShareRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('share')) {
    return {
      message: 'The "share" array is missing from the request body',
      isValidBody: false,
    };
  }

  if (!Array.isArray(body.share)) {
    return {
      message: 'The "share" field in the request body should be an array.',
      isValidBody: false,
    };
  }

  if (body.share.length === 0) {
    return {
      message: 'The "share" array cannot be empty.',
      isValidBody: false,
    };
  }

  const validPhoneNumbers = [];

  body.share.forEach((phoneNumber) => {
    if (!isE164PhoneNumber(phoneNumber)) return;

    validPhoneNumbers.push(phoneNumber);
  });

  if (validPhoneNumbers.length === 0) {
    return {
      message: 'No valid phone numbers found in the "share" array from the'
        + ' request body.',
      isValidBody: false,
    };
  }

  return successMessage;
};


/**
 * Validates the request body for data from the client, and constructs
 * a helpful message in case of some error.
 *
 * @param {Object} body Request body from the client's device.
 * @param {string} endpoint Resource name for which the validation is to be performed.
 * @returns {Object} message object.
 */
const isValidRequestBody = (body, endpoint) => {
  /** Message returned when everything in the request body is alright. */
  const successMessage = {
    message: null,
    isValidBody: true,
  };

  if (!body.hasOwnProperty('timestamp')) {
    return {
      message: 'The "timestamp" field is missing from the request body.',
      isValidBody: false,
    };
  }

  if (typeof body.timestamp !== 'number') {
    return {
      message: 'The "timestamp" field should be a number.',
      isValidBody: false,
    };
  }

  if (!isValidDate(body.timestamp)) {
    return {
      message: 'The "timestamp" in the request body is invalid.',
      isValidBody: false,
    };
  }

  if (!body.hasOwnProperty('geopoint')) {
    return {
      message: 'The "geopoint" field is missing from the request body.',
      isValidBody: false,
    };
  }

  if (!isValidGeopoint(body.geopoint)) {
    return {
      message: 'The "geopoint" object in the request body is invalid.'
        + ' Please make sure that the "latitude" and "longitude" fields'
        + ' are present in the "geopoint" object with valid ranges.',
      isValidBody: false,
    };
  }

  if (endpoint === 'create') {
    return validateCreateRequestBody(body, successMessage);
  }

  /** With the exception of `/create` endpoint, ALL other endpoints
   * require the `activityId` in the request body.
   */
  if (!body.hasOwnProperty('activityId')) {
    return {
      message: 'The "activityId" field is missing from the request body.',
      isValidBody: false,
    };
  }

  if (!isNonEmptyString(body.activityId)) {
    return {
      message: 'The "activityId" field should be a non-empty string.',
      isValidBody: false,
    };
  }

  if (endpoint === 'comment') {
    return validateCommentRequestBody(body, successMessage);
  }

  if (endpoint === 'update') {
    return validateUpdateRequestBody(body, successMessage);
  }

  if (endpoint === 'change-status') {
    return validateChangeStatusRequestBody(body, successMessage);
  }

  if (endpoint === 'remove') {
    return validateRemoveRequestBody(body, successMessage);
  }

  if (endpoint === 'share') {
    return validateShareRequestBody(body, successMessage);
  }

  throw new Error('Invalid endpoint in the method argument');
};


module.exports = {
  filterVenues,
  handleCanEdit,
  filterSchedules,
  filterAttachment,
  isValidRequestBody,
};
