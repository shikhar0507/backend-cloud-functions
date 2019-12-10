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
    message: []
  };

  scheduleArray.forEach((schedule, index) => {
    const {
      startTime,
      endTime,
      name
    } = schedule;

    if (!startTime ||
      !endTime ||
      !name ||
      typeof startTime !== 'number' ||
      typeof endTime !== 'number' ||
      !isNonEmptyString(name)) {
      result.success = false;
      result
        .message
        .push(`Invalid Schedule at index: ${index}`);
    }

    if (startTime > endTime) {
      result.success = false;
      result
        .message
        .push(
          `The startTime cannot be greater than endTime at index: ${index}`
        );
    }
  });

  return result;
};

const validateVenues = venue => {
  const result = {
    success: true,
    message: []
  };

  venue.forEach((object, index) => {
    const {
      venueDescriptor,
      address,
      location,
      geopoint
    } = object;

    if (!isNonEmptyString(venueDescriptor) ||
      !isNonEmptyString(address) ||
      !isNonEmptyString(location) ||
      !isValidGeopoint(geopoint)) {
      result.success = false;
      result
        .message
        .push(`Invalid venue at index: ${index}`);
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
  set setTimezone(timezone) {
    if (!isValidTimezone(timezone)) {
      throw new Error(`Invalid timezone: '${timezone}'`);
    }

    this.timezone = timezone;
  }

  /**
   * @param {string} displayName
   */
  set setActivityName(displayName) {
    this.activityName = `${this.template}: ${displayName}`;
  }

  /**
   * @param {string} status
   */
  set setStatus(status) {
    if (!isValidStatus(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    this.status = status;
  }

  /**
   * @param {string} canEditRule
   */
  set setCanEditRule(canEditRule) {
    if (!isValidCanEditRule(canEditRule)) {
      throw new Error('Invalid canEditRule');
    }

    this.canEditRule = canEditRule;
  }

  /**
   * @param {string} office
   */
  set setOffice(office) {
    if (!isNonEmptyString(office)) {
      throw new Error('Office name cannot be empty string');
    }

    this.office = office;
  }

  /**
   * @param {string} officeId
   */
  set setOfficeId(officeId) {
    if (!isNonEmptyString(officeId)) {
      throw new Error('OfficeId should be a non-empty string');
    }

    this.officeId = officeId;
  }

  /**
   * @param {number} number
   */
  set setHidden(number) {
    if (typeof number !== 'number' || ![0, 1].includes(number)) {
      throw new Error(
        'The value should be a number and can only have the values 0 or 1'
      );
    }

    this.hidden = number;
  }

  /**
   * @param {{ displayName: string; phoneNumber: string; photoURL: string; }} creator
   */
  set setCreator(creator) {
    if (typeof creator !== 'object') {
      throw new Error(
        `The 'creator' should be an object with the following
        ` + ` properties: 'displayName', 'phoneNumber', and 'photoURL'`
      );
    }
    const {
      displayName,
      phoneNumber,
      photoURL
    } = creator;

    if (typeof displayName !== 'string') {
      throw new Error(
        'The displayName should be a string',
      );
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
      photoURL
    };
  }

  /**
   * @param {Array} schedule
   */
  set setSchedule(schedule) {
    const result = validateSchedules(schedule);
    if (!result.success) {
      throw new Error(result.message);
    }

    this.schedule = schedule;
  }

  /**
   * @param {Array} venue
   */
  set setVenue(venue) {
    const result = validateVenues(venue);

    if (!result.success) {
      throw new Error(result.message);
    }

    this.venue = venue;
  }

  toObject() {
    return this;
  }
}

class Creator {
  constructor(phoneNumber, displayName = '', photoURL = '') {
    if (!isE164PhoneNumber(phoneNumber)) {
      throw new Error(`Invalid phoneNumber ${phoneNumber}`);
    }

    this.phoneNumber = phoneNumber;
    this.displayName = displayName;
    this.photoURL = photoURL;
  }

  toObject() {
    return {
      phoneNumber: this.phoneNumber,
      displayName: this.displayName,
      photoURL: this.photoURL,
    };
  }
}

class Attachment {
  constructor(object, attachmentTemplate) {
    Object
      .entries(attachmentTemplate)
      .forEach(value => {
        const [field, child] = value;

        object[field] = object[field] || {};

        this[field] = {
          value: object[field].value || '',
          type: child.type,
        };
      });
  }

  toObject() {
    return this;
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
    if (!Array.isArray(phoneNumbers) ||
      phoneNumbers.length === 0) {
      throw new Error(`Field 'include' should be a non-empty array of phone numbers`);
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
