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


/**
 * Checks if the location is valid with respect to the standard
 * lat and lng values.
 *
 * @param {Object} location Contains lat and lng values.
 * @returns {boolean} If the input `latitude` & `longitude` pair is valid.
 */
const isValidLocation = (location) => {
  if (Object.prototype.toString
    .call(location) !== '[object Object]') return false;

  const lat = location.latitude;
  const lng = location.longitude;

  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return false;

  return true;
};


/**
 * Checks for a non-null, non-empty string.
 *
 * @param {string} str A string.
 * @returns {boolean} If `str` is a non-empty string.
 */
const isValidString = (str) => {
  if (typeof str !== 'string') return false;
  if (str.trim() === '') return false;
  return true;
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
 * @param {Object} subscription User's subscription document.
 * @param {string} phoneNumber Number to check the `canEdit` rule for.
 * @param {string} requesterPhoneNumber Phone number of the requester.
 * @param {Array} assignees Array of people who are assignees of the activity.
 */
const handleCanEdit = (subscription, phoneNumber, requesterPhoneNumber,
  assignees = []) => {
  if (subscription.canEditRule === 'ALL') return true;

  if (subscription.canEditRule === 'NONE') return false;

  if (subscription.canEditRule === 'FROM_INCLUDE') {
    if (subscription.include.indexOf(phoneNumber) > -1
      || assignees.indexOf(phoneNumber) > -1) {
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
 * @param {Array} schedules Array of scheule objects.
 * @param {Object} scheduleFromTemplate Single schedule from template.
 */
const filterSchedules = (schedules, scheduleFromTemplate) => {
  const schedulesArray = [];

  const defaultSchedule = {
    name: scheduleFromTemplate.name,
    startTime: null,
    endTime: null,
  };

  if (!Array.isArray(schedules)) {
    schedulesArray.push(defaultSchedule);
    return schedulesArray;
  }

  schedules.forEach((schedule) => {
    if (schedule.name !== scheduleFromTemplate.name) {
      return;
    }

    /** schedule has startTime but not endTime */
    if (!isNaN(new Date(schedule.startTime)) && !schedule.endTime) {
      schedulesArray.push({
        name: schedule.name,
        startTime: new Date(schedule.startTime),
        endTime: new Date(schedule.startTime),
      });
    } else if (!isNaN(new Date(schedule.startTime)) &&
      !isNaN(new Date(schedule.endTime)) &&
      schedule.endTime >= schedule.startTime) {
      /** schedule has both startTime, endTime & endTime  >= startTime */
      schedulesArray.push({
        name: schedule.name,
        startTime: new Date(schedule.startTime),
        endTime: new Date(schedule.endTime),
      });
    }
  });

  /** In cases where there is no valid schedule in
   * the request body, we create an object with null values.
   */
  if (schedulesArray.length === 0) {
    schedulesArray.push(defaultSchedule);
  }

  return schedulesArray;
};


/**
 * Returns a venue object and filters out all the invalid ones.
 *
 * @param {Object} venues Venues from the request body.
 * @param {Object} venueFromTemplate Venue object from template.
 * @returns {Array} Containing all the valid venues.
 */
const filterVenues = (venues, venueFromTemplate) => {
  const getGeopointObject = require('../../admin/admin').getGeopointObject;
  const venueArray = [];

  const defaultVenue = {
    venueDescriptor: venueFromTemplate.venueDescriptor,
    location: null,
    geopoint: null,
    address: null,
  };

  if (!Array.isArray(venues)) {
    venueArray.push(defaultVenue);
    return venueArray;
  }

  venues.forEach((venue) => {
    if (venue.venueDescriptor !== venueFromTemplate.venueDescriptor) {
      return;
    }

    /** The `geopoint` is a required field for a venue. */
    if (!isValidLocation(venue.geopoint)) {
      return;
    }

    venueArray.push({
      venueDescriptor: venue.venueDescriptor,
      location: venue.location || '',
      geopoint: getGeopointObject(venue.geopoint),
      address: venue.address || '',
    });
  });

  /** In cases where there is no valid venue in the request body we
   * create an array with all null values except the descriptor
   */
  if (venueArray.length === 0) {
    venueArray.push(defaultVenue);
    return venueArray;
  }

  return venueArray;
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
  if (!attachmentFromTemplate) return {};

  const filteredAttachment = {};

  Object.keys(attachmentFromTemplate).forEach((key) => {
    if (typeof attachmentFromTemplate[`${key}`]
      === typeof attachment[`${key}`]) {
      /** filter for each of the value type and their key of the object */
      filteredAttachment[`${key}`] = attachment[`${key}`];
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
