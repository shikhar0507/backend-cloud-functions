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
 * @param {Array} schedules Schedules from request body.
 * @param {Array} scheduleNames Schedules names allowed from the template.
 * @returns {Object} `messageObject` denoting whether the `schedules`
 *  from the request body are valid.
 */
const validateSchedules = (schedules, scheduleNames) => {
  const messageObject = {
    isValid: true,
    message: null,
  };

  let tempObj;

  if (!Array.isArray(schedules)) {
    messageObject.isValid = false;
    messageObject.message = `The 'schedule' field in the request body should`
      + ` be an array of objects.`;

    return messageObject;
  }

  if (scheduleNames.length !== schedules.length) {
    let abbr = 'schedule';

    if (scheduleNames.length > 1) {
      abbr = 'schedules';
    }

    messageObject.isValid = false;
    messageObject.message = `Expected ${scheduleNames.length} ${abbr} in the`
      + `request body. Found ${schedules.length}.`;

    return messageObject;
  }

  /** Not using `forEach` because `break` doesn't work with it. */
  for (let i = 0; i < schedules.length; i++) {
    tempObj = schedules[i];

    if (typeof tempObj !== 'object') {
      messageObject.isValid = false;
      messageObject.message = `The schedule array should .`;
      break;
    }

    if (!tempObj.hasOwnProperty('name')) {
      messageObject.isValid = false;
      messageObject.message = `The Object at position ${i + 1} is missing`
        + ` the 'name' field in the schedule array.`;
      break;
    }

    if (!tempObj.hasOwnProperty('startTime')) {
      messageObject.isValid = false;
      messageObject.message = `The Object at the position ${i + 1} is missing`
        + ` the 'startTime' field in the schedule array`;
      break;
    }

    if (!tempObj.hasOwnProperty('endTime')) {
      messageObject.isValid = false;
      messageObject.message = `The Object at the position ${i + 1} is missing`
        + ` the 'endTime' field in the schedule array`;
      break;
    }

    const name = tempObj.name;
    const startTime = tempObj.startTime;
    const endTime = tempObj.endTime;

    if (!isNonEmptyString(name)) {
      messageObject.isValid = false;
      messageObject.message = `The Object at position ${i + 1} has an invalid`
        + ` value in the field 'name' in the schedule array.`;
      break;
    }

    if (!isValidDate(startTime)) {
      messageObject.isValid = false;
      messageObject.message = `The 'startTime' in the schedule '${name}' should`
        + ` be a valid unix timestamp.`;
      break;
    }

    if (!isValidDate(endTime)) {
      messageObject.isValid = false;
      messageObject.message = `The 'endTime' in the schedule '${name}' should`
        + `be a valid unix timestamp.`;
      break;
    }

    if (startTime > endTime) {
      messageObject.isValid = false;
      messageObject.message = `The value of 'startTime' is greater than the`
        + ` value of 'endTime' in the object ${name}.`;
      break;
    }

    if (scheduleNames.indexOf(name) === -1) {
      messageObject.isValid = false;
      messageObject.message = `'${name}' is an invalid schedule name.`;
      break;
    }
  }

  return messageObject;
};


/**
 * Validates the venues based on the `venueDescriptors` and
 * valid geopoint object.
 *
 * @param {Array} venues Venue objects from request body.
 * @param {Array} venueDescriptors Venue descriptors allowed from the template.
 * @returns {Object} `messageObject` denoting whether the venues
 * from the request body are valid.
 */
const validateVenues = (venues, venueDescriptors) => {
  const messageObject = {
    isValid: true,
    message: null,
  };

  let tempObj;

  if (!Array.isArray(venues)) {
    messageObject.isValid = false;
    messageObject.message = `The 'venue' field in the request body should`
      + ` be an array of objects.`;

    return messageObject;
  }

  if (venueDescriptors.length !== venues.length) {
    let abbr = 'venue';

    if (venueDescriptors.length > 1) {
      abbr = 'venues';
    }

    messageObject.isValid = false;
    messageObject.message = `Expected ${venueDescriptors.length}`
      + `${abbr} in the request body. Found ${venues.length}.`;

    return messageObject;
  }

  /** Not using `forEach` because `break` doesn't work with it. */
  for (let i = 0; i < venues.length; i++) {
    tempObj = venues[i];

    if (!tempObj.hasOwnProperty('venueDescriptor')) {
      messageObject.isValid = false;
      messageObject.message = `The venue object at position ${i} is missing the`
        + ` field 'venueDescriptor' in venues array.`;
      break;
    }

    if (!tempObj.hasOwnProperty('address')) {
      messageObject.isValid = false;
      messageObject.message = `The venue object at position ${i} is missing the`
        + ` field 'address' in venues array.`;
      break;
    }

    if (!tempObj.hasOwnProperty('geopoint')) {
      messageObject.isValid = false;
      messageObject.message = `The venue object at position ${i} is missing the`
        + ` field 'geopoint' in venues array.`;
      break;
    }

    if (!tempObj.hasOwnProperty('location')) {
      messageObject.isValid = false;
      messageObject.message = `The venue object at position ${i} is missing the`
        + ` field 'location' in venues array.`;
      break;
    }

    const venueDescriptor = tempObj.venueDescriptor;
    const address = tempObj.address;
    const geopoint = tempObj.geopoint;
    const location = tempObj.location;

    if (!isNonEmptyString(venueDescriptor)) {
      messageObject.isValid = false;
      messageObject.message = `In the venue object at position ${i},`
        + ` the 'venueDescriptor' is not valid. Expected a 'non-empty'`
        + ` string. Found '${venueDescriptor}'.`;
      break;
    }

    if (venueDescriptors.indexOf(venueDescriptor) === -1) {
      messageObject.isValid = false;
      messageObject.message = `'${venueDescriptor}' is not a valid `
        + ` 'venueDescriptor'.`;
      break;
    }

    if (typeof address !== 'string') {
      messageObject.isValid = false;
      messageObject.message = `In the venue object at position ${i},`
        + ` the 'address' is not valid. Expected 'string'.`
        + ` Found '${typeof address}'.`;
      break;
    }

    if (typeof location !== 'string') {
      messageObject.isValid = false;
      messageObject.message = '';
      break;
    }

    if (typeof geopoint !== 'object') {
      messageObject.isValid = false;
      messageObject.message = `In the venue object at position ${i}, the`
        + ` 'geopoint' is not valid. Expected 'object'.`
        + ` Found '${typeof geopoint}'.`;
      break;
    }

    if (!isValidGeopoint(geopoint)) {
      messageObject.isValid = false;
      messageObject.message = `In the venue object at position ${i}, the`
        + ` ' geopoint' is invalid. Make sure to include the fields`
        + `' latitude' and 'longitude' in the object with proper range`
        + ` for each field.`;
      break;
    }
  }

  return messageObject;
};


/**
 * Validates the attachment object based on the `template`.
 *
 * @param {Object} conn Object containing Express Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {Object} `messageObject` containing `message` and `isValid` fields
 * denoting if the attachment is a valid object.
 */
const filterAttachment = (conn, locals) => {
  // TODO: Move this function to `isValidRequestBody` function.
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
    messageObject.message = `The 'attachment' field is missing from the`
      + ` request body.`;

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

    const validTypes = require('../../admin/attachment-types');

    if (!validTypes.has(type)) {
      messageObject.isValid = false;
      messageObject.message = `The '${type}' is not a valid type.`;
      break;
    }

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

    // TODO: Refactor this... :O
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
  validateVenues,
  handleCanEdit,
  validateSchedules,
  filterAttachment,
  isValidRequestBody,
};
