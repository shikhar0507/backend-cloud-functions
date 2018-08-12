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

const { getGeopointObject, } = require('./../../admin/admin');

const {
  isValidDate,
  isValidGeopoint,
  isNonEmptyString,
  isE164PhoneNumber,
} = require('../../admin/utils');


/**
 * Validates the schedules where the there is a name field present,
 * along with the condition that the endTime >= startTime.
 *
 * @param {Object} body The request body.
 * @param {Array} scheduleNames Schedules names allowed from the template.
 * @returns {Object} `messageObject` denoting whether the `schedules`
 *  from the request body are valid.
 */
const validateSchedules = (body, scheduleNames) => {
  const messageObject = {
    isValid: true,
    message: null,
    finalSchedules: [],
    schedules: [],
  };

  if (!body.hasOwnProperty('schedule')) {
    messageObject.isValid = false;
    messageObject.message = `The 'schedule' field is missing`
      + ` from the request body.`;

    return messageObject;
  }

  const schedules = body.schedule;

  if (!Array.isArray(schedules)) {
    let abbr = 'object';

    if (scheduleNames.length > 1) {
      abbr = 'objects';
    }

    messageObject.isValid = false;
    messageObject.message = `The 'schedule' field in the request body should`
      + ` be an array with ${scheduleNames.length} ${abbr}.`;

    return messageObject;
  }

  if (scheduleNames.length !== schedules.length) {
    let abbr = 'schedule';

    if (scheduleNames.length > 1) {
      abbr = 'schedules';
    }

    messageObject.isValid = false;
    messageObject.message = `Expected ${scheduleNames.length} ${abbr} in the`
      + ` request body. Found ${schedules.length}.`;

    return messageObject;
  }

  /** Not using `forEach` because `break` doesn't work with it. */
  for (let i = 0; i < schedules.length; i++) {
    const scheduleObject = schedules[i];


    if (typeof scheduleObject !== 'object') {
      messageObject.isValid = false;
      messageObject.message = `The schedule array should be an object.`
        + ` Found ${typeof scheduleObject}`;
      break;
    }

    if (!scheduleObject.hasOwnProperty('name')) {
      messageObject.isValid = false;
      messageObject.message = `The Object at position ${i + 1} is missing`
        + ` the 'name' field in the schedule array.`;
      break;
    }

    if (!scheduleObject.hasOwnProperty('startTime')) {
      messageObject.isValid = false;
      messageObject.message = `The Object at the position ${i + 1} is missing`
        + ` the 'startTime' field in the schedule array`;
      break;
    }

    if (!scheduleObject.hasOwnProperty('endTime')) {
      messageObject.isValid = false;
      messageObject.message = `The Object at the position ${i + 1} is missing`
        + ` the 'endTime' field in the schedule array`;
      break;
    }

    const name = scheduleObject.name;
    const startTime = scheduleObject.startTime;
    const endTime = scheduleObject.endTime;

    if (!isNonEmptyString(name)) {
      messageObject.isValid = false;
      messageObject.message = `The Object at position ${i + 1} has an invalid`
        + ` value in the field 'name' in the schedule array.`;
      break;
    }

    if (typeof startTime !== 'number') {
      messageObject.isValid = false;
      messageObject.message = `The 'startTime' in the schedule '${name}' should`
        + ` be a number`;
      break;
    }

    if (typeof endTime !== 'number') {
      messageObject.isValid = false;
      messageObject.message = `The 'startTime' in the schedule '${name}' should`
        + ` be a number`;
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
      messageObject.message = `The value '${name}' is an invalid schedule name.`
        + ` Use: ${scheduleNames}`;
      break;
    }

    messageObject.schedules.push({
      name,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
    });
  }

  return messageObject;
};


/**
 * Validates the venues based on the `venueDescriptors` and
 * valid geopoint object.
 *
 * @param {Object} body The request body.
 * @param {Array} venueDescriptors Venue descriptors allowed from the template.
 * @returns {Object} `messageObject` denoting whether the venues
 * from the request body are valid.
 */
const validateVenues = (body, venueDescriptors) => {
  const messageObject = {
    isValid: true,
    message: null,
    venues: [],
  };

  if (!body.hasOwnProperty('venue')) {
    messageObject.isValid = false;
    messageObject.message = `The 'venue' field is missing from the`
      + ` request body.`;

    return messageObject;
  }

  const venues = body.venue;

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
      + ` ${abbr} in the request body. Found ${venues.length}.`;

    return messageObject;
  }

  /** Not using `forEach` because `break` doesn't work with it. */
  for (let i = 0; i < venues.length; i++) {
    const venueObject = venues[i];

    if (!venueObject.hasOwnProperty('venueDescriptor')) {
      messageObject.isValid = false;
      messageObject.message = `The venue object at position ${i} is missing the`
        + ` field 'venueDescriptor' in venues array.`;
      break;
    }

    if (!venueObject.hasOwnProperty('address')) {
      messageObject.isValid = false;
      messageObject.message = `The venue object at position ${i} is missing the`
        + ` field 'address' in venues array.`;
      break;
    }

    if (!venueObject.hasOwnProperty('geopoint')) {
      messageObject.isValid = false;
      messageObject.message = `The venue object at position ${i} is missing the`
        + ` field 'geopoint' in venues array.`;
      break;
    }

    if (!venueObject.hasOwnProperty('location')) {
      messageObject.isValid = false;
      messageObject.message = `The venue object at position ${i} is missing the`
        + ` field 'location' in venues array.`;
      break;
    }

    const venueDescriptor = venueObject.venueDescriptor;
    const address = venueObject.address;
    const geopoint = venueObject.geopoint;
    const location = venueObject.location;

    if (!isNonEmptyString(venueDescriptor)) {
      messageObject.isValid = false;
      messageObject.message = `In the venue object at position ${i},`
        + ` the 'venueDescriptor' is not valid. Expected a 'non-empty'`
        + ` string. Found '${venueDescriptor}'.`;
      break;
    }

    if (venueDescriptors.indexOf(venueDescriptor) === -1) {
      messageObject.isValid = false;
      messageObject.message = `The value '${venueDescriptor}' is an`
        + ` invalid venueDescriptor. Use: ${venueDescriptors}`;
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
        + `' latitude' and 'longitude' are present in the object with proper`
        + ` range for each field.`;
      break;
    }

    messageObject.venues.push({
      venueDescriptor,
      location,
      address,
      geopoint: getGeopointObject(geopoint),
    });
  }

  return messageObject;
};


/**
 * Validates the attachment object based on the `template`.
 *
 * @param {Object} body The request body.
 * @param {Object} locals Object containing local data.
 * @returns {Object} `messageObject` containing `message` and `isValid` fields
 * denoting if the attachment is a valid object.
 */
const filterAttachment = (body, locals) => {
  const messageObject = {
    isValid: true,
    message: null,
    promise: null,
    /** Avoiding duplication of phone number values. */
    phoneNumbers: new Set(),
  };

  /**
   * Some templates **may** have empty attachment object. For those cases,
   * it's allowed to skip the template in the request body.
   */
  if (!body.hasOwnProperty('attachment')) {
    messageObject.isValid = false;
    messageObject.message = `The 'attachment' field is missing from the`
      + ` request body.`;

    return messageObject;
  }

  const invalidTypeMessage = `Expected the type of 'attachment' to be`
    + ` of type 'Object'. Found ${typeof body.attachment}.`;

  /** The typeof null is also `object`. */
  if (body.attachment === null) {
    messageObject.isValid = false;
    messageObject.message = invalidTypeMessage;

    return messageObject;
  }

  if (typeof body.attachment !== 'object') {
    messageObject.isValid = false;
    messageObject.message = invalidTypeMessage;

    return messageObject;
  }

  const fields = Object.keys(locals.objects.attachment);
  const foundFields = Object.keys(body.attachment);

  if (fields.length !== foundFields.length) {
    messageObject.isValid = false;
    messageObject.message = `The attachment in the request body should`
      + ` have the following fields: ${fields}.`;

    return messageObject;
  }

  for (const field of fields) {
    if (!body.attachment.hasOwnProperty(field)) {
      messageObject.isValid = false;
      messageObject.message = `The '${field}' field is missing`
        + ` from attachment.`;
      break;
    }

    const item = body.attachment[field];

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

    const shouldBeString = `In 'attachment', expected 'string' in '${field}`;

    if (typeof type !== 'string') {
      messageObject.isValid = false;
      messageObject.message = `${shouldBeString}.value object.`
        + ` Found ${typeof value}.`;
      break;
    }

    if (typeof value !== 'string') {
      messageObject.isValid = false;
      messageObject.message = `${shouldBeString}.value object.`
        + ` Found ${typeof value}.`;
      break;
    }

    if (field === 'Name') {
      if (!isNonEmptyString(value)) {
        messageObject.isValid = false;
        messageObject.message = `The 'Name' field in 'attachment' should`
          + ` be a non-empty string.`;
        break;
      }

      if (body.template === 'office'
        && body.attachment.Name.value !== body.office) {
        messageObject.isValid = false;
        messageObject.message = `The office name in the`
          + ` 'attachment.Name.value' and the`
          + ` 'office' field should be the same.`;
        break;
      }

      if (type !== 'office') {
        const rootCollections = require('../../admin/admin').rootCollections;

        messageObject.promise = rootCollections
          .offices
          .doc(locals.static.officeId)
          .collection('Activities')
          .where('attachment.Name.value', '==', value)
          .where('template', '==', type)
          /** Docs exist uniquely based on `Name`, and `template`. */
          .limit(1)
          .get();
      }
    }

    if (type === 'phoneNumber') {
      if (value !== '' && !isE164PhoneNumber(value)) {
        messageObject.isValid = false;
        messageObject.message = `In 'attachment' the field '${field}'`
          + ` has an invalid phone number.`;
        break;
      }

      /**
       * Collecting all phone numbers from attachment to
       * add add in the activity assignee list.
       */
      if (value !== '') {
        messageObject.phoneNumbers.add(value);
      }
    }

    const weekdays = require('../../admin/attachment-types').weekdays;

    if (type === 'weekday') {
      if (value !== '' && !weekdays.has(value)) {
        messageObject.isValid = false;
        messageObject.message = `In 'attachment', the field ${field}`
          + ` is an invalid 'weekday'. Use one of the`
          + ` following: ${Array.from(weekdays.keys())}.`;
      }
    }
  }

  /** Set to array. */
  messageObject.phoneNumbers = [...messageObject.phoneNumbers,];

  return messageObject;
};


/**
 * Checks the `template` and `office` fields from the request body.
 *
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object.
 */
const validateCreateRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('activityName')) {
    return {
      message: `The 'activityName' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (!isNonEmptyString(body.activityName)) {
    return {
      message: `The 'activityName' should be of type 'string'. `
        + `Found '${typeof body.activityName}'.`,
      isValid: false,
    };
  }

  if (!body.hasOwnProperty('template')) {
    return {
      message: `The 'template' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (!isNonEmptyString(body.template)) {
    return {
      message: `Expected 'template' field to have a value of type 'string'. `
        + `Found ${typeof body.template}.`,
      isValid: false,
    };
  }

  if (!body.hasOwnProperty('office')) {
    return {
      message: `The 'office' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (!isNonEmptyString(body.office)) {
    return {
      message: `The 'office' field should be a non-empty string.`,
      isValid: false,
    };
  }

  if (body.hasOwnProperty('share')) {
    if (!Array.isArray(body.share)) {
      return {
        message: `The 'share' field in the request body should be an 'array'.`,
        isValid: false,
      };
    }

    /**
     * Using the traditional loop because you can't
     * `break` out of a `forEach` loop.
     * */
    for (let i = 0; i < body.share.length; i++) {
      const phoneNumber = body.share[i];

      if (!isE164PhoneNumber(phoneNumber)) {
        successMessage.message = `The phone number '${phoneNumber}' at`
          + ` position: ${i} in the 'share' array is invalid.`;
        successMessage.isValid = false;
        break;
      }
    }
  }

  return successMessage;
};


/**
 * Checks if the update body has valid data to make an update request.
 *
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object.
 */
const validateUpdateRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('activityName')
    && !body.hasOwnProperty('description')
    && !body.hasOwnProperty('venue')
    && !body.hasOwnProperty('schedule')
    && !body.hasOwnProperty('attachment')) {
    return {
      message: `The request body has no usable fields.`
        + ` Please add at least any of these: 'activityName',`
        + ` 'schedule', 'venue' or 'attachment'`
        + ` in the request body to make a successful request.`,
      isValid: false,
    };
  }

  if (body.hasOwnProperty('activityName')
    && !isNonEmptyString(body.activityName)) {
    return {
      message: `The 'activityName' field in the request body should be a`
        + ` non-empty string.`,
      isValid: false,
    };
  }

  return successMessage;
};


/**
 * Checks if the request body has a valid `comment`.
 *
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object.
 */
const validateCommentRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('comment')) {
    return {
      message: `The 'comment' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (!isNonEmptyString(body.comment)) {
    return {
      message: `The 'comment' field should be a non-empty string.`,
      isValid: false,
    };
  }

  return successMessage;
};


/**
 * Checks if the request body has a valid `status` field.
 * @param {Object} body Request body from the client's device.
 * @param {Object} successMessage The default success message.
 * @returns {Object} Message object.
 */
const validateChangeStatusRequestBody = (body, successMessage) => {
  if (!body.hasOwnProperty('status')) {
    return {
      message: `The 'status' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (!isNonEmptyString(body.status)) {
    return {
      message: `The 'status' field should be a non-empty string.`,
      isValid: false,
    };
  }

  const activityStatuses = require('../../admin/attachment-types')
    .activityStatuses;

  if (!activityStatuses.has(body.status)) {
    return {
      message: `'${body.status}' is not a valid activity status.`
        + ` Please use one of the following`
        + ` values: ${[...activityStatuses.keys(),]}.`,
      isValid: false,
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
      message: `The 'remove' array is missing from the request body`,
      isValid: false,
    };
  }

  if (typeof body.remove !== 'string') {
    return {
      message: `The 'remove' field in the request body should be string.`,
      isValid: false,
    };
  }

  if (!isE164PhoneNumber(body.remove)) {
    return {
      message: `The phone number: '${body.remove}' is not a valid`
        + ` phone number.`,
      isValid: false,
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
      message: `The 'share' array is missing from the request body`,
      isValid: false,
    };
  }

  if (!Array.isArray(body.share)) {
    return {
      message: `The 'share' field in the request body should be an array.`,
      isValid: false,
    };
  }

  if (body.share.length === 0) {
    return {
      message: `The 'share' array cannot be empty.`,
      isValid: false,
    };
  }

  for (let i = 0; i < body.share.length; i++) {
    const phoneNumber = body.share[i];

    if (!isE164PhoneNumber(phoneNumber)) {
      successMessage.message = `In the 'share' array, the value at position`
        + ` ${i}: '${phoneNumber}' is invalid.`;
      successMessage.isValid = false;
    }

    break;
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
    isValid: true,
  };

  if (!body.hasOwnProperty('timestamp')) {
    return {
      message: `The 'timestamp' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (typeof body.timestamp !== 'number') {
    return {
      message: `The 'timestamp' field should be a number.`,
      isValid: false,
    };
  }

  if (!isValidDate(body.timestamp)) {
    return {
      message: `The 'timestamp' in the request body is invalid.`,
      isValid: false,
    };
  }

  if (!body.hasOwnProperty('geopoint')) {
    return {
      message: `The 'geopoint' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (!isValidGeopoint(body.geopoint)) {
    return {
      message: `The 'geopoint' object in the request body is invalid.`
        + ` Please make sure that the 'latitude' and 'longitude' fields`
        + ` are present in the 'geopoint' object with valid ranges.`,
      isValid: false,
    };
  }

  if (endpoint === 'create') {
    return validateCreateRequestBody(body, successMessage);
  }

  /** With the exception of `/ create` endpoint, ALL other endpoints
   * require the `activityId` in the request body.
   */
  if (!body.hasOwnProperty('activityId')) {
    return {
      message: `The 'activityId' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (!isNonEmptyString(body.activityId)) {
    return {
      message: `The 'activityId' field should be a non - empty string.`,
      isValid: false,
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

  throw new Error(`Invalid endpoint in the method argument`);
};


const getCanEditValue = (locals, phoneNumber) => {
  const canEditRule = locals.static.canEditRule;

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

  /** Probably will never reach here. */
  return false;
};


const getPhoneNumbersFromAttachment = (attachment) => {
  const phoneNumbersSet = new Set();

  Object.keys(attachment).forEach((key) => {
    const field = attachment[key];
    const type = field.type;
    const value = field.value;

    if (type !== 'phoneNumber') return;

    phoneNumbersSet.add(value);
  });

  return phoneNumbersSet;
};


module.exports = {
  validateVenues,
  getCanEditValue,
  validateSchedules,
  filterAttachment,
  isValidRequestBody,
  getPhoneNumbersFromAttachment,
};
