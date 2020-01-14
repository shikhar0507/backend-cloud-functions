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
  isNonEmptyString,
  isValidGeopoint,
  isValidTimezone,
  isValidStatus,
  isE164PhoneNumber,
  isValidUrl,
  isValidCanEditRule,
} = require('../admin/utils');

const validateSchedules = scheduleArray => {
  const result = {
    success: true,
    message: [],
  };

  scheduleArray.forEach((schedule, index) => {
    const {startTime, endTime, name} = schedule;

    if (typeof startTime === 'undefined' || typeof endTime === 'undefined') {
      result.message.push(`Invalid Schedule at index: ${index}`);

      return;
    }

    if (
      (startTime && typeof startTime !== 'number') ||
      (endTime && typeof endTime !== 'number')
    ) {
      result.message.push(`Invalid Schedule at index: ${index}`);
    }

    if (!isNonEmptyString(name)) {
      result.message.push(`Invalid Schedule name at index: ${index}`);
    }

    if (startTime > endTime) {
      result.success = false;
      result.message.push(
        `The startTime cannot be greater than endTime at index: ${index}`,
      );
    }
  });

  return result;
};

const validateVenues = venue => {
  const result = {
    success: true,
    message: [],
  };

  venue.forEach((object, index) => {
    const {venueDescriptor, address, location, geopoint} = object;

    if (
      !isNonEmptyString(venueDescriptor) ||
      !isNonEmptyString(address) ||
      !isNonEmptyString(location) ||
      !isValidGeopoint(geopoint)
    ) {
      result.success = false;
      result.message.push(`Invalid venue at index: ${index}`);
    }
  });

  return result;
};

class Activity {
  constructor(template) {
    if (!(this instanceof Activity)) {
      throw new Error('You need to call Activity constructor with "new"');
    }

    this.template = template;
    this.timestamp = Date.now();
  }

  /**
   * @param {string} timezone
   */
  set timezone(timezone) {
    if (!isValidTimezone(timezone)) {
      throw new Error(`Invalid timezone: '${timezone}'`);
    }

    this.timezone = timezone;
  }

  /**
   * @param {string} displayName
   */
  set activityName(displayName) {
    this.activityName = `${this.template}: ${displayName}`;
  }

  /**
   * @param {string} status
   */
  set status(status) {
    if (!isValidStatus(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    this.status = status;
  }

  /**
   * @param {string} canEditRule
   */
  set canEditRule(canEditRule) {
    if (!isValidCanEditRule(canEditRule)) {
      throw new Error('Invalid canEditRule');
    }

    this.canEditRule = canEditRule;
  }

  /**
   * @param {string} office
   */
  set office(office) {
    if (!isNonEmptyString(office)) {
      throw new Error('Office name cannot be empty string');
    }

    this.office = office;
  }

  /**
   * @param {string} officeId
   */
  set officeId(officeId) {
    if (!isNonEmptyString(officeId)) {
      throw new Error('OfficeId should be a non-empty string');
    }

    this.officeId = officeId;
  }

  /**
   * @param {number} number
   */
  set hidden(number) {
    if (typeof number !== 'number' || ![0, 1].includes(number)) {
      throw new Error(
        'The value should be a number and can only have the values 0 or 1',
      );
    }

    this.hidden = number;
  }

  /**
   * @param {{ displayName: string; phoneNumber: string; photoURL: string; }} creator
   */
  set creator(creator) {
    if (typeof creator !== 'object') {
      throw new Error(
        `The 'creator' should be an object with the following
        ` + ` properties: 'displayName', 'phoneNumber', and 'photoURL'`,
      );
    }

    const {displayName, phoneNumber, photoURL} = creator;

    if (typeof displayName !== 'string') {
      throw new Error('The displayName should be a string');
    }

    if (!isE164PhoneNumber(phoneNumber)) {
      throw new Error('Invalid phone number');
    }

    if (photoURL && !isValidUrl(photoURL)) {
      throw new Error('The photoURL should be a valid URL');
    }

    this.creator = {
      phoneNumber,
      displayName,
      photoURL,
    };
  }

  /**
   * @param {Array} schedule
   */
  set schedule(schedule) {
    const result = validateSchedules(schedule);
    if (!result.success) {
      throw new Error(result.message);
    }

    this.schedule = schedule;
  }

  /**
   * @param {Array} venue
   */
  set venue(venue) {
    const result = validateVenues(venue);

    if (!result.success) {
      throw new Error(result.message);
    }

    this.venue = venue;
  }

  toObject() {
    return Object.assign({}, this);
  }
}

class Creator {
  /**
   * @param {String} phoneNumber
   * @param {String} displayName
   * @param {String} photoURL
   */
  constructor(phoneNumber, displayName = '', photoURL = '') {
    if (!isE164PhoneNumber(phoneNumber)) {
      throw new Error(`Invalid phoneNumber ${phoneNumber}`);
    }

    this.phoneNumber = phoneNumber;
    this.displayName = displayName;
    this.photoURL = photoURL;
  }

  toObject() {
    return Object.assign({}, this);
  }
}

class Attachment {
  constructor(object, attachmentTemplate) {
    let countOfPhoneNumberFields = 0;
    let countOfPhoneNumbersFound = 0;

    Object.entries(attachmentTemplate).forEach(value => {
      const [field, child] = value;
      object[field] = object[field] || '';

      // Name or Number cannot be empty
      if ((field === 'Name' || field === 'Number') && !value) {
        throw new Error(`${field} cannot be empty`);
      }

      if (child.type === 'phoneNumber') {
        countOfPhoneNumberFields++;

        if (object[field]) {
          countOfPhoneNumbersFound++;
        }
      }

      this[field] = {
        value: object[field],
        type: child.type,
      };
    });

    /**
     * If activity attachment has type `phoneNumber`, all of the fields
     * with phoneNumber cannot be empty strings
     */
    if (countOfPhoneNumberFields > 0 && countOfPhoneNumbersFound === 0) {
      throw new Error(`All fields with type 'phoneNumber' cannot be empty`);
    }
  }

  toObject() {
    return Object.assign({}, this);
  }
}

class Subscription {
  constructor(templateDoc, activityDoc) {
    this.name = templateDoc.get('name');
    this.schedule = templateDoc.get('schedule');
    this.venue = templateDoc.get('venue');
    this.template = templateDoc.get('template');
    this.attachment = templateDoc.get('attachment');
    this.canEditRule = templateDoc.get('canEditRule');
    this.hidden = templateDoc.get('hidden');
    this.statusOnCreate = templateDoc.get('statusOnCreate');
    this.report = templateDoc.get('report') || null;
    this.timestamp = activityDoc.get('timestamp');
    this.status = activityDoc.get('status');
    this.office = activityDoc.get('office');
  }

  /**
   *
   * @param {Array<String>} phoneNumbers Array of phone numbers
   */
  setIncludeArray(phoneNumbers) {
    if (!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) {
      throw new Error(
        `Field 'include' should be a non-empty array of phone numbers`,
      );
    }

    /** Duplication is reduntant while */
    this.include = [...new Set(phoneNumbers)];
  }

  toObject() {
    return this;
  }
}

module.exports = {
  Creator,
  Activity,
  Attachment,
  Subscription,
};
