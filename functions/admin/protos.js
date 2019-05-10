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

const validateSchedules = (scheduleArray) => {
  const result = { success: true, message: [] };

  scheduleArray.forEach((schedule, index) => {
    const { startTime, endTime, name } = schedule;

    if (!startTime
      || !endTime
      || !name
      || typeof startTime !== 'number'
      || typeof endTime !== 'number'
      || !isNonEmptyString(name)) {
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

const validateVenues = (venueArray) => {
  const result = { success: true, message: [] };

  venueArray.forEach((venue, index) => {
    const { venueDescriptor, address, location, geopoint } = venue;

    if (!isNonEmptyString(venueDescriptor)
      || !isNonEmptyString(address)
      || !isNonEmptyString(location)
      || !isValidGeopoint(geopoint)) {
      result.success = false;
      result
        .message
        .push(`Invalid venue at index: ${index}`);
    }
  });

  return result;
};

class Activity {
  constructor(templateName) {
    this.template = templateName;
    this.timestamp = Date.now();
  }

  set setTimezone(timezone) {
    if (!isValidTimezone(timezone)) {
      throw new Error(`Invalid timezone: '${timezone}'`);
    }

    this.timezone = timezone;
  }

  set setActivityName(displayName) {
    this.activityName = `${this.template}: ${displayName}`;
  }

  set setStatus(status) {
    if (!isValidStatus(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    this.status = status;
  }

  set setCanEditRule(canEditRule) {
    if (!isValidCanEditRule(canEditRule)) {
      throw new Error('Invalid canEditRule');
    }

    this.canEditRule = canEditRule;
  }

  set setOffice(office) {
    if (!isNonEmptyString(office)) {
      throw new Error('Office name cannot be empty string');
    }

    this.office = office;
  }

  set setOfficeId(officeId) {
    if (!isNonEmptyString(officeId)) {
      throw new Error('OfficeId should be a non-empty string');
    }

    this.officeId = officeId;
  }

  set setHidden(number) {
    if (typeof number !== 'number' || ![0, 1].includes(number)) {
      throw new Error(
        'The value should be a number and can only have the values 0 or 1'
      );
    }

    this.hidden = number;
  }

  set setCreator(creator) {
    if (typeof creator !== 'object') {
      throw new Error(
        `The 'creator' should be an object with the following
        `+ ` properties: 'displayName', 'phoneNumber', and 'photoURL'`
      );
    }
    const {
      displayName,
      phoneNumber,
      photoURL,
    } = creator;

    if (!isNonEmptyString(displayName)) {
      throw new Error(
        'The displayName should be a non-empty string',
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
      photoURL,
    };
  }

  set setSchedule(scheduleArray) {
    const result = validateSchedules(scheduleArray);
    if (!result.success) {
      throw new Error(result.message);
    }

    this.schedule = scheduleArray;
  }

  set setVenue(venueArray) {
    const result = validateVenues(venueArray);

    if (!result.success) {
      throw new Error(result.message);
    }

    this.venue = venueArray;
  }

  setStuff(stuff) {
    this.stuff = stuff;
  }

  toObject() {
    return this;
  }
}

class Creator {
  constructor(phoneNumber, displayName, photoURL) {
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

module.exports = {
  Activity,
  Creator,
};
