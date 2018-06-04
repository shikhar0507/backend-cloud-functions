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


const {
  getGeopointObject,
} = require('../../admin/admin');


/**
 * Checks if the location is valid with respect to the standard
 * lat and lng values.
 *
 * @param {Object} location Contains lat and lng values.
 * @returns {boolean} If the input lat, lng pair is valid.
 */
const isValidLocation = (location) => {
  const lat = location.latitude;
  const lng = location.longitude;

  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return false;

  return true;
};


/**
 * Checks for a non-null, non-empty string.
 *
 * @param {string} str A string.
 */
const isValidString = (str) => {
  if (typeof str !== 'string') return false;
  // TODO: This `re` doesn't like `-` in the string.
  /** Checks for empty (or whitespace) string */
  const re = /^$|\s+/;
  return !re.test(str);
};


/**
 * Checks whether the number is a valid Unix timestamp.
 *
 * @param {Object} date Javascript Date object.
 * @returns {boolean} Whether the number is a valid Unix timestamp.
 */
const isValidDate = (date) => !isNaN(new Date(parseInt(date)));


/**
 * Verifies a phone number based on the E.164 standard.
 *
 * @param {string} phoneNumber A phone number.
 * @returns {boolean} If the number is a valid E.164 phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const isValidPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return false;

  const re = /^\+[1-9]\d{5,14}$/;
  return re.test(phoneNumber);
};

/**
 * Handles whether a person has the authority to edit an activity after it is
 * created.
 *
 * @param {Object} subscription User's subscription.
 * @param {string} phoneNumber Number to check the canEdir rule for.
 * @param {string} requesterPhoneNumber Phone number of the requester.
 */
const handleCanEdit = (subscription, phoneNumber, requesterPhoneNumber) => {
  /** The rules will have one of the following values
   * ALL
   * NONE
   * FROM_INCLUDE
   * CREATOR
   * PEOPLE_TYPE
   */

  if (subscription.canEditRule === 'ALL') return true;

  if (subscription.canEditRule === 'NONE') return false;

  if (subscription.canEditRule === 'FROM_INCLUDE') {
    if (subscription.include.indexOf(phoneNumber) > -1) {
      return true;
    }
    return false;
  }

  /** TODO: this needs to be implemented. */
  if (subscription.canEditRule === 'PEOPLE_TYPE') return true;

  if (subscription.canEditRule === 'CREATOR') {
    if (phoneNumber === requesterPhoneNumber) {
      return true;
    }
    return false;
  }

  return false;
};


/**
 * Returns valid schedule objects and filters out invalid schedules.
 *
 * @param {Object} schedule Object containing startTime, endTime and the name
 * of the schedule.
 * @param {Object} scheduleFromTemplate Schedule template stored in
 * the Firestore.
 * @returns {Object} A venue object.
 */
const filterSchedules = (schedule, scheduleFromTemplate) => {
  let schedules = {};

  const defaultSchedule = schedules[scheduleFromTemplate.name] = {
    name: scheduleFromTemplate.name,
    startTime: null,
    endTime: null,
  };

  if (!Array.isArray(schedule)) {
    return defaultSchedule;
  }

  schedule.forEach((sch) => {
    if (sch.name !== scheduleFromTemplate.name) {
      return;
    }

    if (!isNaN(new Date(sch.startTime)) && !sch.endTime) {
      // schedule has startTime but not endTime
      schedules[sch.name] = {
        name: sch.name,
        startTime: new Date(sch.startTime),
        endTime: new Date(sch.startTime),
      };
    } else if (!isNaN(new Date(sch.startTime)) &&
      !isNaN(new Date(sch.endTime)) &&
      sch.endTime >= sch.startTime) {
      // schedule has both startTime, endTime & endTime  >= startTime
      schedules[sch.name] = {
        name: sch.name,
        startTime: new Date(sch.startTime),
        endTime: new Date(sch.endTime),
      };
    }
  });

  /** In cases where there is no valid schedule in
   * the request body, we create an object with null values.
   */
  if (Object.keys(schedules).length === 0) {
    return defaultSchedule;
  }

  return schedules;
};


/**
 * Returns a venue object and filters out all the invalid ones.
 *
 * @param {Object} venue Object containing venueDescriptor, geopoint, location
 * and the address of a venue.
 * @param {Object} venueDataFromDB Venue template data from Firestore.
 * @returns {Object} A schedule object.
 */
const filterVenues = (venue, venueDataFromDB) => {
  let venues = {};

  const defaultVenue = venues[venueDataFromDB.venueDescriptor] = {
    venueDescriptor: venueDataFromDB.venueDescriptor,
    location: null,
    geopoint: null,
    address: null,
  };

  if (!Array.isArray(venues)) {
    return defaultVenue;
  }

  venue.forEach((val) => {
    if (val.venueDescriptor !== venueDataFromDB.venueDescriptor) {
      return;
    }

    if (!isValidLocation(val.geopoint)) {
      return;
    }

    venues[`${val.venueDescriptor}`] = {
      venueDescriptor: val.venueDescriptor,
      location: val.location || '',
      geopoint: getGeopointObject(val.geopoint),
      address: val.address || '',
    };
  });

  /** In cases where there is no valid venue in the request body we
   * create an object with all null values except the name
   */
  if (Object.keys(venues).length === 0) {
    return defaultVenue;
  }

  return venues;
};


/**
 * Filters out all the non-essential keys from the attachment object in the
 * request body using the attachment object from the template.
 *
 * @param {Object} attachment Attachment from the request.body.attachment.
 * @param {Object} attachmentFromTemplate Attachment object from the template
 * in the firestore.
 */
const attachmentCreator = (attachment, attachmentFromTemplate) => {
  if (!attachmentFromTemplate) return null;

  const filteredAttachment = {};

  Object.keys(attachmentFromTemplate).forEach((key) => {
    if (typeof attachmentFromTemplate[key] === typeof attachment[key]) {
      /** filter for each of the value type and their key of the object */
      filteredAttachment[key] = attachment[key];
    }
  });

  return filteredAttachment;
};

module.exports = {
  filterSchedules,
  filterVenues,
  handleCanEdit,
  isValidString,
  isValidDate,
  isValidLocation,
  isValidPhoneNumber,
  attachmentCreator,
};
