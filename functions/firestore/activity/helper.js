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
  getGeopointObject,
  rootCollections,
} = require('./../../admin/admin');
const {
  getStatusForDay,
} = require('../recipients/report-utils');
const {
  isValidDate,
  isValidEmail,
  isValidGeopoint,
  isNonEmptyString,
  isE164PhoneNumber,
  getAttendancesPath,
  enumerateDaysBetweenDates,
} = require('../../admin/utils');
const {
  allMonths,
  validTypes,
  timezonesSet,
  dateFormats,
  httpsActions,
  subcollectionNames,
  templatesWithNumber,
} = require('../../admin/constants');
const {
  toMapsUrl,
} = require('../../firestore/recipients/report-utils');
const momentTz = require('moment-timezone');
const admin = require('firebase-admin');


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
    schedules: [],
  };

  if (!body.hasOwnProperty('schedule')) {
    messageObject.isValid = false;
    messageObject.message = `The 'schedule' field is missing` +
      ` from the request body.`;

    return messageObject;
  }

  if (!Array.isArray(body.schedule)) {
    messageObject.isValid = false;
    messageObject.message = `The schedule should be an array of objects`;

    return messageObject;
  }

  if (scheduleNames.length !== body.schedule.length) {
    messageObject.isValid = false;
    messageObject.message = `Expected ${scheduleNames.length}` +
      ` venues. Found ${body.schedule.length}`;

    return messageObject;
  }

  const seenNamesSet = new Set();

  /** Not using `forEach` because `break` doesn't work with it. */
  for (let i = 0; i < body.schedule.length; i++) {
    const scheduleObject = body.schedule[i];

    if (typeof scheduleObject !== 'object') {
      messageObject.isValid = false;
      messageObject.message = `The schedule array should be an object.` +
        ` Found ${typeof scheduleObject}`;
      break;
    }

    if (!scheduleObject.hasOwnProperty('name')) {
      messageObject.isValid = false;
      messageObject.message = `Missing the field 'name' in schedule at` +
        ` position ${i}`;
      break;
    }

    if (!scheduleObject.hasOwnProperty('startTime')) {
      messageObject.isValid = false;
      messageObject.message = `Missing the field 'startTime' in schedule at` +
        ` position ${i}`;
      break;
    }

    if (!scheduleObject.hasOwnProperty('endTime')) {
      messageObject.isValid = false;
      messageObject.message = `Missing the field 'endTime' in schedule at` +
        ` position ${i}`;
      break;
    }

    const {
      name,
      startTime,
      endTime
    } = scheduleObject;

    if (seenNamesSet.has(name)) {
      messageObject.isValid = false;
      messageObject.message = `Duplicate schedule objects found`;
      break;
    }

    /** All objects have unique value in the `name`. */
    seenNamesSet.add(name);

    if (!isNonEmptyString(name)) {
      messageObject.isValid = false;
      messageObject.message = `Invalid schedule name at position ${i}`;
      break;
    }

    if (startTime !== '' && endTime !== '') {
      if (typeof startTime !== 'number') {
        messageObject.isValid = false;
        messageObject.message = `The 'startTime' in the schedule '${name}'` +
          ` should be a number`;
        break;
      }

      if (typeof endTime !== 'number') {
        messageObject.isValid = false;
        messageObject.message = `The 'endTime' in the schedule '${name}'` +
          ` should be a number`;
        break;
      }

      if (!isValidDate(startTime)) {
        messageObject.isValid = false;
        messageObject.message = `The 'startTime' in the schedule '${name}'` +
          ` should be a valid unix timestamp`;
        break;
      }

      if (!isValidDate(endTime)) {
        messageObject.isValid = false;
        messageObject.message = `The 'endTime' in the schedule '${name}' should` +
          `be a valid unix timestamp`;
        break;
      }

      if (startTime > endTime) {
        messageObject.isValid = false;
        messageObject.message = `Schedule '${name}' has start time after` +
          ` the end time`;
        break;
      }
    }

    if (!scheduleNames.includes(name)) {
      messageObject.isValid = false;
      messageObject.message = `'${name}' is not a valid schedule name`;
      break;
    }

    messageObject.schedules.push({
      name,
      startTime,
      endTime
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
    messageObject.message = `Missing the field 'venue' from the request body`;

    return messageObject;
  }

  if (!Array.isArray(body.venue)) {
    messageObject.isValid = false;
    messageObject.message = `The field venue should be an 'array' of objects`;

    return messageObject;
  }

  if (venueDescriptors.length !== body.venue.length) {
    messageObject.isValid = false;
    messageObject.message = `Expected ${venueDescriptors.length}` +
      ` venues. Found ${body.venue.length}`;

    return messageObject;
  }

  const seenDescriptorsSet = new Set();

  /** Not using `forEach` because `break` doesn't work with it. */
  for (let i = 0; i < body.venue.length; i++) {
    const venueObject = body.venue[i];

    if (!venueObject.hasOwnProperty('venueDescriptor')) {
      messageObject.isValid = false;
      messageObject.message = `The venue at position ${i} is missing` +
        ` the field 'venueDescriptor'`;
      break;
    }

    if (!venueObject.hasOwnProperty('address')) {
      messageObject.isValid = false;
      messageObject.message = `The venue at position ${i} is missing` +
        ` the field 'address'`;
      break;
    }

    if (!venueObject.hasOwnProperty('geopoint')) {
      messageObject.isValid = false;
      messageObject.message = `The venue at position ${i} is missing` +
        ` the field 'geopoint'`;
      break;
    }

    if (!venueObject.hasOwnProperty('location')) {
      messageObject.isValid = false;

      messageObject.message = `The venue at position ${i} is missing` +
        ` the field 'location'`;
      break;
    }

    const venueDescriptor = venueObject.venueDescriptor;
    const address = venueObject.address;
    const location = venueObject.location;

    if (seenDescriptorsSet.has(venueDescriptor)) {
      messageObject.isValid = false;
      messageObject.message = `Duplicate venues found`;
      break;
    }

    /** All objects have unique value in the `venueDescriptor`. */
    seenDescriptorsSet.add(venueDescriptor);

    if (!isNonEmptyString(venueDescriptor)) {
      messageObject.isValid = false;
      messageObject.message = `The venue at position ${i} is an invalid string`;
      break;
    }

    if (!venueDescriptors.includes(venueDescriptor)) {
      messageObject.isValid = false;
      messageObject.message = `The value '${venueDescriptor}' is an` +
        ` invalid venueDescriptor. Use: ${venueDescriptors}`;
      break;
    }

    if (typeof address !== 'string') {
      messageObject.isValid = false;

      messageObject.message = `The venue at position ${i} has an` +
        ` invalid address`;
      break;
    }

    if (typeof location !== 'string') {
      messageObject.isValid = false;
      messageObject.message = '';
      break;
    }

    if (!isValidGeopoint(venueObject.geopoint)) {
      messageObject.isValid = false;
      messageObject.message = `Invalid venue object at position ${i}`;
      break;
    }

    // const lat = venueObject.geopoint.latitude;
    // const long = venueObject.geopoint.longitude;

    // if (location || address && (!lat || !long)) {
    //   messageObject.isValid = false;
    //   messageObject.message = `Invalid venue at ${i}`;
    //   break;
    // }

    venueObject.geopoint = getGeopointObject(venueObject.geopoint);

    messageObject.venues.push({
      venueDescriptor,
      address,
      location,
      geopoint: venueObject.geopoint,
    });
  }

  return messageObject;
};


/**
 * Validates the attachment object based on the `template`.
 *
 * @param {Object} options Contains object to validate attachment object.
 * @returns {Object} `messageObject` containing `message` and `isValid` fields
 * denoting if the attachment is a valid object.
 */
const filterAttachment = (options) => {
  const {
    bodyAttachment,
    templateAttachment,
    template,
    office,
  } = options;

  const messageObject = {
    isValid: true,
    message: null,
    nameChecks: [],
    phoneNumbersSet: new Set(),
    querySnapshotShouldExist: [],
    querySnapshotShouldNotExist: [],
    profileDocShouldExist: [],
    hasBase64Field: false,
  };

  const invalidTypeMessage = `Expected the type of 'attachment' to be` +
    ` of type 'Object'. Found ${typeof bodyAttachment}`;

  if (typeof bodyAttachment !== 'object') {
    messageObject.isValid = false;
    messageObject.message = invalidTypeMessage;

    return messageObject;
  }

  /** The `typeof null` is also `object`. */
  if (bodyAttachment === null) {
    messageObject.isValid = false;
    messageObject.message = invalidTypeMessage;

    return messageObject;
  }

  if (Array.isArray(bodyAttachment)) {
    messageObject.isValid = false;
    messageObject.message = `Expected the type of 'attachment' to be of type` +
      ` 'Object' Found 'Array'.`;

    return messageObject;
  }

  const templateAttachmentFields = Object.keys(templateAttachment);
  const bodyAttachmentFields = Object.keys(bodyAttachment);

  if (templateAttachmentFields.length !== bodyAttachmentFields.length) {
    messageObject.isValid = false;
    messageObject.message = `Fields mismatch error in the attachment object`;

    return messageObject;
  }

  /** The `forEach` loop doesn't support `break` */
  for (const field of templateAttachmentFields) {
    if (!bodyAttachment.hasOwnProperty(field)) {
      messageObject.isValid = false;
      messageObject.message = `${field} is missing`;
      break;
    }

    const item = bodyAttachment[field];

    if (!item.hasOwnProperty('type')) {
      messageObject.isValid = false;
      messageObject.message = `${field} is missing the property 'type'`;
      break;
    }

    if (!item.hasOwnProperty('value')) {
      messageObject.isValid = false;
      messageObject.message = `${field} is missing the property 'value'`;
      break;
    }

    const type = item.type;
    const value = item.value;

    /** Type will never be an empty string */
    if (!isNonEmptyString(type)) {
      messageObject.isValid = false;
      messageObject.message = `${field} should have an alpha-numeric value`;
      break;
    }

    if (typeof value !== 'number' &&
      typeof value !== 'string' &&
      typeof value !== 'boolean') {
      messageObject.isValid = false;
      messageObject.message = `${field} can only be a number or a string`;
      break;
    }

    if (type === 'base64') {
      const rejectionMessage = `Invalid value for the field '${field}' in attachment object`;

      if (typeof value !== 'string') {
        messageObject.isValid = false;
        messageObject.message = rejectionMessage;
        break;
      }

      const isBase64 = value.startsWith('data:image/jpg;base64,');
      const isUrl = value.startsWith('https://');

      messageObject.isBase64 = isBase64;
      messageObject.isUrl = isUrl;
      messageObject.base64Field = field;
      messageObject.base64Value = value;

      if (!isBase64 && !isUrl && isNonEmptyString(value)) {
        messageObject.isValid = false;
        messageObject.message = rejectionMessage;
        break;
      }
    }

    if (field === 'Timezone' &&
      !timezonesSet.has(value)) {
      messageObject.isValid = false;
      messageObject.message = `${value} is not a valid ${field}`;
      break;
    }

    if (value !== '' &&
      type === 'number' &&
      typeof value !== 'number') {
      messageObject.isValid = false;
      messageObject.message = `${field} should be a number`;
      break;
    }

    if (template === 'subscription') {
      /** Subscription to the office is `forbidden` */
      if (bodyAttachment.Template.value === 'office') {
        messageObject.isValid = false;
        messageObject.message = `Cannot subscribe to office`;
        break;
      }

      if (!isNonEmptyString(value)) {
        messageObject.isValid = false;
        messageObject.message = `${field} should have an alpha-numeric value`;
        break;
      }

      if (type === 'phoneNumber' &&
        !isE164PhoneNumber(value)) {
        messageObject.isValid = false;
        messageObject.message = `${field} should be a valid phone number`;
        break;
      }

      if (field === 'Template') {
        messageObject
          .querySnapshotShouldExist
          .push(rootCollections
            .activityTemplates
            .where('name', '==', value)
            .limit(1)
            .get()
          );
      }
    }

    if (template === 'admin') {
      if (!isE164PhoneNumber(bodyAttachment['Phone Number'].value)) {
        messageObject.isValid = false;
        messageObject.message = `${field} should be a valid phone number`;
        break;
      }

      messageObject
        .profileDocShouldExist
        .push(rootCollections
          .profiles
          .doc(bodyAttachment['Phone Number'].value)
          .get()
        );
    }

    /**
     * For all the cases when the type is not among the `validTypes`
     * the `Offices/(officeId)/Activities` will be queried for the doc
     * to EXIST.
     */
    if (!validTypes.has(type) && value !== '') {
      // Used by admin api
      messageObject.nameChecks.push({
        value,
        type
      });

      if (templatesWithNumber.has(type)) {
        messageObject
          .querySnapshotShouldExist
          .push(rootCollections
            .activities
            .where('attachment.Number.value', '==', value)
            .limit(1)
            .get()
          );
      } else {
        messageObject
          .querySnapshotShouldExist
          .push(rootCollections
            .activities
            .where('attachment.Name.value', '==', value)
            .where('template', '==', type)
            .limit(1)
            .get()
          );
      }
    }

    if (field === 'Name') {
      if (!isNonEmptyString(value)) {
        messageObject.isValid = false;
        messageObject.message = `${field} cannot be left blank`;
        break;
      }

      if (template === 'office' &&
        bodyAttachment.Name.value !== office) {
        messageObject.isValid = false;
        messageObject.message = `The office name in the` +
          ` 'attachment.Name.value' and the` +
          ` 'office' field in the request body should be the same`;
        break;
      }

      messageObject
        .querySnapshotShouldNotExist
        .push(rootCollections
          .activities
          .where('attachment.Name.value', '==', value)
          .where('template', '==', template)
          /** Docs exist uniquely based on `Name`, and `template`. */
          .limit(1)
          .get()
        );
    }

    // Number and Name can't be left blank
    if (field === 'Number') {
      if (!value) {
        messageObject.isValid = false;
        messageObject.message = `Number cannot be empty`;

        break;
      }

      messageObject
        .querySnapshotShouldNotExist
        .push(rootCollections
          .activities
          .where('attachment.Number.value', '==', value)
          /** Docs exist uniquely based on `Name`, and `template`. */
          .limit(1)
          .get()
        );
    }

    if (type === 'phoneNumber' && value !== '') {
      if (!isE164PhoneNumber(value)) {
        messageObject.isValid = false;
        messageObject.message = `${field} should be a valid phone number`;
        break;
      }

      /**
       * Collecting all phone numbers from attachment to
       * add add in the activity assignee list.
       */
      messageObject.phoneNumbersSet.add(value);
    }

    if (type === 'email' && value !== '' && !isValidEmail(value)) {
      messageObject.isValid = false;
      messageObject.message = `${field} should be a valid email`;
      break;
    }

    if (type === 'weekday') {
      const weekdays = require('../../admin/constants').weekdays;

      if (value !== '' &&
        !weekdays.has(value)) {
        messageObject.isValid = false;
        messageObject.message = `${field} should be a weekday.` +
          ` Use: ${Array.from(weekdays.keys())}`;
        break;
      }
    }

    if (type === 'HH:MM') {
      const isHHMMFormat = require('../../admin/utils').isHHMMFormat;

      if (value !== '' && !isHHMMFormat(value)) {
        messageObject.isValid = false;
        messageObject.message = `${field} should be a valid HH:MM format value`;
        break;
      }
    }
  }

  /** Using `Set()` in order to avoid duplication of phone numbers in the array */
  messageObject.phoneNumbers = [...messageObject.phoneNumbersSet.keys()];

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
  if (!body.hasOwnProperty('template')) {
    return {
      message: `The 'template' field is missing from the request body.`,
      isValid: false,
    };
  }

  if (!isNonEmptyString(body.template)) {
    return {
      message: `Expected 'template' field to have a value of type 'string'. ` +
        `Found ${typeof body.template}.`,
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

  if (!body.hasOwnProperty('share')) {
    return {
      message: `The 'share' field is missing from the request body.`,
      isValid: false,
    };
  }


  if (!body.hasOwnProperty('attachment')) {
    return {
      message: `The field 'attachment' is missing from the request body.`,
      isValid: false,
    };
  }

  if (!Array.isArray(body.share)) {
    return {
      message: `The 'share' field in the request body should be an 'array'.`,
      isValid: false,
    };
  }

  /**
   * Using the traditional loop because you can't `break` out of a
   * `forEach` loop.
   */
  for (let i = 0; i < body.share.length; i++) {
    const phoneNumber = body.share[i];

    if (!isE164PhoneNumber(phoneNumber)) {
      successMessage.message = `${phoneNumber} is invalid.` +
        ` Please contact support`;
      successMessage.isValid = false;
      break;
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
  if (!body.hasOwnProperty('venue') &&
    !body.hasOwnProperty('schedule') &&
    !body.hasOwnProperty('attachment')
  ) {
    return {
      message: `The request body has no usable fields.` +
        ` Please add at least any of these: ,` +
        ` 'schedule', 'venue' or 'attachment'` +
        ` in the request body to make a successful request.`,
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

  const activityStatuses = require('../../admin/constants')
    .activityStatuses;

  if (!activityStatuses.has(body.status)) {
    return {
      message: `'${body.status}' is not a valid activity status.`,
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
 * TODO: Remove this...
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
      message: `The phone number: '${body.remove}' is not a valid` +
        ` phone number.`,
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
      successMessage.message = `The phone number ${phoneNumber} is invalid.` +
        ` Please choose a valid phone number.`;
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

  if (body.timestamp !== '' && typeof body.timestamp !== 'number') {
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
      message: `Your location couldn't be determined`,
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
      message: `The 'activityId' field should be a non-empty string.`,
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

  if (canEditRule === 'NONE') return false;

  if (canEditRule === 'CREATOR') {
    return locals.objects.permissions[phoneNumber].isCreator;
  }

  if (canEditRule === 'ADMIN') {
    return locals.objects.permissions[phoneNumber].isAdmin;
  }

  if (canEditRule === 'EMPLOYEE') {
    return locals.objects.permissions[phoneNumber].isEmployee;
  }

  /** The `canEditRule` is `ALL`. */
  return true;
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


const checkActivityAndAssignee = (docs, isSupportRequest) => {
  const [activity, requester] = docs;

  if (!activity.exists) {
    return {
      isValid: false,
      message: `The activity does not exist.`,
    };
  }

  if (!isSupportRequest) {
    const message = `You cannot edit this activity.`;

    if (!requester.exists) {
      return {
        isValid: false,
        message,
      };
    }
  }

  return {
    isValid: true,
    message: null
  };
};

const haversineDistance = (geopointOne, geopointTwo) => {
  const toRad = value => value * Math.PI / 180;
  const RADIUS_OF_EARTH = 6371;

  const distanceBetweenLatitudes =
    toRad(
      geopointOne._latitude - geopointTwo._latitude
    );
  const distanceBetweenLongitudes =
    toRad(
      geopointOne._longitude - geopointTwo._longitude
    );

  const lat1 = toRad(geopointOne._latitude);
  const lat2 = toRad(geopointTwo._latitude);

  const a =
    Math.sin(distanceBetweenLatitudes / 2) *
    Math.sin(distanceBetweenLatitudes / 2) +
    Math.sin(distanceBetweenLongitudes / 2) *
    Math.sin(distanceBetweenLongitudes / 2) *
    Math.cos(lat1) *
    Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = RADIUS_OF_EARTH * c;

  // We do not care about small values in KM
  if (distance < 0.5) return 0;

  return distance;
};

const activityName = (options) => {
  const {
    attachmentObject,
    templateName,
    requester,
  } = options;

  const {
    displayName,
    phoneNumber,
  } = requester;

  if (templateName === 'recipient') {
    return `${templateName.toUpperCase()}:` +
      ` ${attachmentObject.Name.value.toUpperCase()} REPORT`;
  }

  if (attachmentObject.hasOwnProperty('Name')) {
    return `${templateName.toUpperCase()}: ${attachmentObject.Name.value}`;
  }

  if (attachmentObject.hasOwnProperty('Number')) {
    return `${templateName.toUpperCase()}: ${attachmentObject.Number.value}`;
  }

  if (templateName === 'admin') {
    return `${templateName.toUpperCase()}: ${attachmentObject['Phone Number'].value}`;
  }

  if (templateName === 'subscription') {
    return `${templateName.toUpperCase()}:` +
      ` ${attachmentObject['Phone Number'].value}`;
  }

  return `${templateName.toUpperCase()}: ${displayName || phoneNumber}`;
};


const toAttachmentValues = (conn, locals) => {
  // activityId, createTime, attachment, status
  if (conn.req.body.status === 'CANCELLED') {
    return admin.firestore.FieldValue.delete();
  }

  const object = {
    activityId: locals.docs.activityRef.id,
    createTime: Date.now(),
  };

  const fields = Object.keys(conn.req.body.attachment);

  fields
    .forEach((field) => {
      object[field] = conn.req.body.attachment[field].value;
    });

  return object;
};

const toProductObject = (docData, createTime) => {
  const attachment = docData.attachment;

  return {
    createTime,
    Name: attachment.Name.value,
    'Product Type': attachment['Product Type'].value,
    'Product Description': attachment['Product Description'].value,
    Brand: attachment.Brand.value,
    Model: attachment.Model.value,
    'Stock Keeping Unit': attachment['Stock Keeping Unit'].value,
    Size: attachment.Size.value,
    Variant: attachment.Variant.value,
    'Unit Value': attachment['Unit Value'].value,
    GST: attachment.GST.value,
  };
};

const toCustomerObject = (docData, createTime) => {
  const attachment = docData.attachment;
  const venue = docData.venue[0];
  const customerOffice = {
    url: '',
    identifier: '',
  };

  if (venue.address) {
    customerOffice.url = toMapsUrl(venue.geopoint);
    customerOffice.identifier = venue.address;
  }

  const customerObject = {
    customerOffice,
    createTime,
    name: attachment.Name.value,
    firstContact: attachment['First Contact'].value,
    secondContact: attachment['Second Contact'].value,
    customerType: attachment['Customer Type'].value,
    customerCode: attachment['Customer Code'].value,
    dailyStartTime: attachment['Daily Start Time'].value,
    dailyEndTime: attachment['Daily End Time'].value,
    weeklyOff: attachment['Weekly Off'].value,
  };

  return customerObject;
};

const toEmployeesData = (activity) => {
  return {
    createTime: activity.createTime.toDate().getTime(),
    Name: activity.get('attachment.Name.value'),
    phoneNumber: activity.get('attachment.Phone Number.value'),
    firstSupervisor: activity.get('attachment.First Supervisor.value'),
    secondSupervisor: activity.get('attachment.Second Supervisor.value'),
    department: activity.get('attachment.Department.value'),
    baseLocation: activity.get('attachment.Base Location.value'),
    employeeCode: activity.get('attachment.Employee Code.value'),
  };
};


const cancelLeaveOrAr = async params => {
  const {
    officeId,
    startTime,
    endTime,
    template,
    creatorsPhoneNumber,
  } = params;

  const promises = getAttendancesPath({
    startTime,
    endTime,
    officeId,
    phoneNumber: creatorsPhoneNumber,
  });
  const [
    attendanceDocs,
    employeeQueryResult,
  ] = await Promise
    .all([
      Promise
      .all(promises),
      rootCollections
      .activities
      .where('officeId', '==', officeId)
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', 'employee')
      .where('attachment.Phone Number.value', '==', creatorsPhoneNumber)
      .limit(1)
      .get(),
    ]);
  const batch = db.batch();
  const addendumPromises = [];
  const queryDates = [];

  attendanceDocs
    .forEach(doc => {
      const {
        month,
        year
      } = doc.data();
      const p = rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ADDENDUM)
        .where('date', '==', doc.id)
        .where('month', '==', month)
        .where('year', '==', year)
        .where('user', '==', creatorsPhoneNumber)
        .get();

      queryDates
        .push(`${doc.id} ${month} ${year}`);
      addendumPromises
        .push(p);
    });

  const snapShots = await Promise
    .all(addendumPromises);

  const datesMap = new Map();

  snapShots
    .forEach((snapShot, index) => {
      const numberOfCheckIns = snapShot.size;
      const minimumDailyActivityCount = employeeQueryResult
        .docs[0]
        .get('attachment.Minimum Daily Activity Count.value');
      const minimumWorkingHours = employeeQueryResult
        .docs[0]
        .get('attachment.Minimum Working Hours.value');
      const hoursWorked = (() => {
        if (numberOfCheckIns === 0) {
          return 0;
        }

        const firstCheckIn = snapShot.docs[0];
        const lastCheckIn = snapShot.docs[snapShot.size - 1];

        return momentTz(lastCheckIn.get('timestamp'))
          .diff(momentTz(firstCheckIn.get('timestamp')), 'hours');
      })();

      const statusForDay = getStatusForDay({
        numberOfCheckIns,
        minimumDailyActivityCount,
        minimumWorkingHours,
        hoursWorked,
      });

      const docUpdate = {
        statusForDay,
      };

      if (template === 'leave') {
        docUpdate
          .onLeave = false;
      }

      if (template === 'attendance regularization') {
        docUpdate
          .onAr = false;
      }

      datesMap
        .set(queryDates[index], docUpdate);
    });

  attendanceDocs
    .forEach(doc => {
      const date = doc.id;
      const {
        month,
        year
      } = doc.data();
      const onLeave = template === 'leave';
      const onAr = template === 'attendance regularization';
      const docUpdates = {
        statusForDay: datesMap.get(`${date} ${month} ${year}`),
      };

      if (onLeave) {
        docUpdates
          .onLeave = false;
      }

      if (onAr) {
        docUpdates
          .onAr = false;
      }

      batch
        .set(doc.ref, docUpdates, {
          merge: true,
        });
    });

  const updatesQuery = await rootCollections
    .updates
    .where('phoneNumber', '==', creatorsPhoneNumber)
    .limit(1)
    .get();

  const doc = updatesQuery.docs[0];

  if (doc) {
    batch.set(doc.ref, {
      lastStatusDocUpdateTimestamp: Date.now()
    }, {
      merge: true,
    });
  }

  await batch
    .commit();

  return batch
    .commit();
};

const setOnLeaveOrAr = async params => {
  const result = {
    message: null,
    success: true,
  };

  const {
    officeId,
    timezone,
    startTime,
    endTime,
    template,
    status,
    leaveReason,
    arReason,
    leaveType,
    creatorsPhoneNumber,
    requestersPhoneNumber,
  } = params;

  if (template === 'attendance regularization') {
    // if (startTime >= momentTz().tz(timezone).startOf('day').valueOf()) {
    //   result
    //     .success = false;
    //   result
    //     .message = `Attendance can only be applied for the past`;

    //   return result;
    // }

    const recipientQueryResult = await rootCollections
      .activities
      .where('officeId', '==', officeId)
      .where('template', '==', 'recipient')
      .where('status', '==', 'CONFIRMED')
      .where('attachment.Name.value', '==', 'payroll')
      .limit(1)
      .get();

    if (recipientQueryResult.empty) {
      result
        .success = false;
      result
        .message = `Your organization has not` +
        ` subscribed to Growthfile's Payroll Automation`;

      return result;
    }
  }

  const promises = getAttendancesPath({
    startTime,
    endTime,
    officeId,
    phoneNumber: creatorsPhoneNumber,
  });
  const docs = await Promise
    .all(promises);
  const isPending = status === 'PENDING';
  const isCONFIRMED = status === 'CONFIRMED';
  const conflictsSet = new Set();
  const batch = db
    .batch();
  const conflictMessage = {
    AR_WITH_AR: `Attendance already regularized for the following dates:`,
    AR_WITH_LEAVE: `Leave already applied for the following dates:`,
    LEAVE_WITH_AR: `Attendance already regularized for the following dates:`,
    LEAVE_WITH_LEAVE: `Leave already applied for the following dates:`,
  };

  docs
    .forEach(doc => {
      const onAr = doc.get('onAr') || false;
      const onLeave = doc.get('onLeave') || false;
      const {
        path
      } = doc.ref;
      const parts = path.split('/');
      const monthYearString = parts[3];
      const [
        monthString,
        year,
      ] = monthYearString
        .split(' ');
      const month = allMonths[monthString];
      const fmt = momentTz()
        .date(doc.id)
        .month(month)
        .year(year)
        .tz(timezone)
        .format(dateFormats.DATE);
      const docUpdate = doc.data() || {
        officeId,
        phoneNumber: creatorsPhoneNumber,
        month: Number(month),
        year: Number(year),
      };

      if (template === 'leave' &&
        onLeave &&
        isPending) {
        conflictsSet.add(fmt);
        // Leave CANCELLED: Leave already applied for the following dates:
        result
          .message = conflictMessage.LEAVE_WITH_LEAVE;

        return;
      }

      if (template === 'leave' &&
        onAr &&
        isPending) {
        conflictsSet
          .add(fmt);
        // Leave CANCELLED: Attendance already regularized for the following dates:
        result
          .message = conflictMessage.LEAVE_WITH_AR;

        return;
      }

      if (template === 'attendance regularization' &&
        onLeave &&
        isPending) {
        conflictsSet
          .add(fmt);
        // Attendance Regularization CANCELLED: Leave already applied for the following dates:
        result
          .message = conflictMessage.AR_WITH_LEAVE;

        return;
      }

      if (template === 'attendance regularization' &&
        onAr &&
        isPending) {
        conflictsSet
          .add(fmt);
        // Attendance Regularization CANCELLED: Attendance already regularized for the following dates:
        result
          .message = conflictMessage.AR_WITH_AR;

        return;
      }

      docUpdate
        .statusForDay = 1;
      docUpdate
        .onLeave = template === 'leave';
      docUpdate
        .onAr = template === 'attendance regularization';
      docUpdate
        .leaveReason = leaveReason || '',
        docUpdate
        .leaveType = leaveType || '';
      docUpdate
        .arReason = arReason || '';

      if (isCONFIRMED) {
        docUpdate
          .leaveConfirmedBy = requestersPhoneNumber;
        docUpdate
          .leaveConfirmedAt = momentTz().tz(timezone).valueOf();
      }

      batch
        .set(doc.ref, docUpdate, {
          merge: true,
        });
    });

  /**
   * No conflicts, that means the leave can be created successfully
   */
  // if (conflictsSet.size === 0) {
  if (conflictsSet) {
    const updatesQuery = await rootCollections
      .updates
      .where('phoneNumber', '==', creatorsPhoneNumber)
      .limit(1)
      .get();

    const doc = updatesQuery.docs[0];

    if (doc) {
      batch.set(doc.ref, {
        lastStatusDocUpdateTimestamp: Date.now()
      }, {
        merge: true,
      });
    }

    await batch
      .commit();

    return result;
  }

  result
    .success = false;
  result
    .message = `${result.message} ${[...conflictsSet]}`;

  return result;
};


const createAutoSubscription = async (locals, templateName, subscriber) => {
  if (!subscriber ||
    !locals.addendumDoc) {
    return;
  }

  const {
    officeId,
  } = locals.change.after.data();
  const batch = db.batch();

  const [
    subscriptionTemplateQuery,
    userSubscriptionQuery,
  ] = await Promise.all([
    rootCollections
    .activityTemplates
    .where('name', '==', 'subscription')
    .limit(1)
    .get(),
    rootCollections
    .activities
    .where('attachment.Phone Number.value', '==', subscriber)
    .where('attachment.Template.value', '==', templateName)
    .where('officeId', '==', officeId)
    .where('status', '==', 'CONFIRMED')
    .limit(1)
    .get()
  ]);

  /** Already has the subscription to whatever template that was passed */
  if (!userSubscriptionQuery.empty) {
    return;
  }

  const [subscriptionTemplateDoc] = subscriptionTemplateQuery.docs;
  const activityRef = rootCollections.activities.doc();
  const addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();
  const attachment = Object.assign({}, subscriptionTemplateDoc.get('attachment'), {
    'Phone Number': {
      value: subscriber,
      type: subscriptionTemplateDoc.get('attachment.Phone Number.type'),
    },
    Template: {
      value: templateName,
      type: subscriptionTemplateDoc.get('attachment.Template.type')
    }
  });

  const activityData = {
    addendumDocRef,
    attachment,
    timestamp: Date.now(),
    timezone: locals.change.after.get('timezone') || 'Asia/Kolkata',
    venue: subscriptionTemplateDoc.get('venue'),
    office: locals.change.after.get('office'),
    template: 'subscription',
    schedule: subscriptionTemplateDoc.get('schedule'),
    status: subscriptionTemplateDoc.get('statusOnCreate'),
    canEditRule: subscriptionTemplateDoc.get('canEditRule'),
    activityName: `SUBSCRIPTION: ${subscriber}`,
    officeId: locals.change.after.get('officeId'),
    hidden: subscriptionTemplateDoc.get('hidden'),
    creator: locals.change.after.get('creator'),
    createTimestamp: Date.now(),
  };

  const addendumDocData = {
    activityData,
    user: locals.change.after.get('creator.phoneNumber'),
    userDisplayName: locals.change.after.get('creator.displayName'),
    share: locals.assigneePhoneNumbersArray,
    action: httpsActions.create,
    template: 'subscription',
    location: locals.addendumDoc.get('location'),
    timestamp: Date.now(),
    userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
    activityId: activityRef.id,
    isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
    isAdminRequest: locals.addendumDoc.get('isAdminRequest') || false,
    isAutoGenerated: true,
    geopointAccuracy: null,
    provider: null,
  };

  batch.set(activityRef, activityData);
  batch.set(addendumDocRef, addendumDocData);

  locals.assigneePhoneNumbersArray.forEach(phoneNumber => {
    batch.set(
      activityRef
      .collection(subcollectionNames.ASSIGNEES)
      .doc(phoneNumber), {
        /** Subscription's canEditRule is ADMIN */
        addToInclude: phoneNumber !== subscriber,
      });
  });

  return batch.commit();
};


const attendanceConflictHandler = async params => {
  // Called for templates {leave and attendance regularization}
  const {
    schedule,
    phoneNumber,
    office,
  } = params;
  const allDateStrings = [];
  const queries = [];
  let conflictingDate = null;
  let conflictingTemplate = null;

  // runs for leave/ar
  // generate all date strings from start time to end time
  // create queries for leave and ar for each date
  // where(scheduleDates, array_contains, '1 Jan 2019')
  schedule.forEach(scheduleObject => {
    const {
      startTime,
      endTime,
    } = scheduleObject;

    allDateStrings.push(
      ...enumerateDaysBetweenDates(startTime, endTime, dateFormats.DATE)
    );
  });

  allDateStrings.forEach(dateString => {
    queries.push(
      rootCollections
      .profiles
      .doc(phoneNumber)
      .collection(subcollectionNames.ACTIVITIES)
      .where('office', '==', office)
      .where('scheduleDates', 'array-contains', dateString)
      /** Leave creator is the person for whom the leave should be checked */
      .where('creator.phoneNumber', '==', phoneNumber)
      .limit(1)
      .get()
    );
  });

  const snapShots = await Promise.all(queries);

  for (const snap of snapShots) {
    const {
      empty,
    } = snap;

    if (empty) {
      continue;
    }

    const [doc] = snap.docs;
    const {
      schedule,
      template,
      status,
    } = doc.data();

    if (template !== 'leave' && template !== 'attendance regularization') {
      continue;
    }

    if (status === 'CANCELLED') {
      continue;
    }

    const [firstSchedule] = schedule;
    const {
      startTime,
    } = firstSchedule;

    conflictingDate = momentTz(startTime).format(dateFormats.DATE);
    conflictingTemplate = template;
  }

  return {
    conflictingDate,
    conflictingTemplate,
  };
};


module.exports = {
  attendanceConflictHandler,
  activityName,
  validateVenues,
  getCanEditValue,
  toProductObject,
  toCustomerObject,
  toEmployeesData,
  validateSchedules,
  cancelLeaveOrAr,
  filterAttachment,
  haversineDistance,
  isValidRequestBody,
  toAttachmentValues,
  setOnLeaveOrAr,
  getAttendancesPath,
  createAutoSubscription,
  checkActivityAndAssignee,
  getPhoneNumbersFromAttachment,
};
