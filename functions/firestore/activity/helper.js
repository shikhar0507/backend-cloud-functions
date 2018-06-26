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


/**
 * Checks if the location is valid with respect to the standard
 * lat and lng values.
 *
 * @param {Object} location Contains lat and lng values.
 * @returns {boolean} If the input `latitude` & `longitude` pair is valid.
 */
const isValidLocation = (location) => {
  if (!location) return false;
  if (!location.hasOwnProperty('latitude')
    || !location.hasOwnProperty('longitude')) return false;

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
 * @returns {boolean} Whether the number is a *valid* Unix timestamp.
 */
const isValidDate = (date) => !isNaN(new Date(parseInt(date)));


/**
 * Verifies a phone number based on the E.164 standard.
 *
 * @param {string} phoneNumber A phone number.
 * @returns {boolean} If the number is a *valid* __E.164__ phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const isValidPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return false;

  /**
   * RegExp *Explained*...
   * * ^: Matches the beginning of the string, or the beginning of a line if the multiline flag (m) is enabled.
   * * \+: Matches the `+` character
   * *[1-9]: Matches the character in range `1` to `9`
   * *\d: Matches any digit character
   * * *{5-14}: Match between 5 and 14 characters after the preceeding `+` token
   * *$: Matches the end of the string, or the end of a line if the multiple flag (m) is enabled.
   */
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
 * @returns {boolean} Depends on the subscription and the phoneNumber in args.
 */
const handleCanEdit = (
  subscription,
  phoneNumber,
  requesterPhoneNumber,
  assignees = []
) => {
  if (subscription.canEditRule === 'ALL') return true;

  if (subscription.canEditRule === 'NONE') return false;

  /** List of assignees... */
  if (subscription.canEditRule === 'FROM_INCLUDE') {
    if (subscription.include.indexOf(phoneNumber) > -1
      || assignees.indexOf(phoneNumber) > -1) {
      return true;
    }
    return false;
  }

  // TODO: this needs to be implemented.
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
 * Validates the schedules where the there is a name field present,
 * along with the condition that the endTime >= startTime.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @param {Array} requestBodySchedule Schedules from request body.
 * @param {Array} scheduleNames Schedules from template.
 * @returns {Array} Of valid schedules.
 */
const filterSchedules = (conn, requestBodySchedule, scheduleNames) => {
  /** If filterSchedules has been called once, return the cached values. */
  if (conn.data.hasOwnProperty('schedule')) return conn.data.schedule;

  const defaultSchedules = [];

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
      if (!isValidDate(schedule.startTime) && !isValidDate(schedule.endTime)) return;

      /** Schedule has valid `startTime` */
      if (isValidDate(schedule.startTime) && !schedule.hasOwnProperty('endTime')) {
        validSchedules.push({
          name: schedule.name,
          startTime: new Date(schedule.startTime),
          endTime: new Date(schedule.startTime),
        });

        return;
      }

      if (schedule.endTime >= schedule.startTime) {
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

  /** Set up the cache for avoiding subsequent calculations on next function
   * calls to filterSchedules function.
   */
  conn.data.schedule = validSchedules;

  return validSchedules;
};

const getGeopointObject = require('../../admin/admin').getGeopointObject;

/**
 * Validates the venues based on the `venueDescriptors` and 
 * valid geopoint object.
 * 
 * @param {Object} conn Express Request and Response object.
 * @param {Array} requestBodyVenue Venue objects from request.
 * @param {Array} venueDescriptors Venue descriptors from template.
 * @returns {Array} Valid venues based on template.
 */
const filterVenues = (conn, requestBodyVenue, venueDescriptors) => {
  /** If filterVenues has been called once, return the cached values. */
  if (conn.data.hasOwnProperty('venue')) return conn.data.venue;

  let validVenues = [];
  const defaultVenues = [];

  const getGeopointObject = require('../../admin/admin').getGeopointObject;

  venueDescriptors.forEach((venueDescriptor) => {
    defaultVenues.push({
      venueDescriptor,
      location: '',
      address: '',
      geopoint: getGeopointObject({
        latitude: 0,
        longitude: 0,
      }),
    });
  });

  if (!Array.isArray(requestBodyVenue)) return defaultVenues;

  if (requestBodyVenue.length === 0) return defaultVenues;

  venueDescriptors.forEach((venueDescriptor) => {
    requestBodyVenue.forEach((venue) => {
      if (!isValidLocation(venue.geopoint)) return;

      validVenues.push({
        geopoint: getGeopointObject(venue.geopoint),
        venueDescriptor: venue.venueDescriptor,
        location: venue.location || '',
        adddress: venue.address || '',
      });
    });
  });

  if (validVenues.length === 0) {
    validVenues = defaultVenues;
  }

  /** Set up the cache for avoiding subsequent calculations on next function
   * calls to filterVenues function.
   */
  conn.data.venue = validVenues;

  return validVenues;
};


/**
 * Filters out all the non-essential keys from the attachment object in the
 * request body using the attachment object from the template.
 *
 * @param {Object} attachmentFromRequestBody Attachment from the request.body.attachment.
 * @param {Object} attachmentFromTemplate Attachment object from the template
 * in the firestore.
 * @returns {Array} Venue Objects.
 */
const attachmentCreator = (attachmentFromRequestBody, attachmentFromTemplate) => {
  if (!attachmentFromTemplate) return {};

  const filteredAttachment = {};

  Object
    .keys(attachmentFromTemplate)
    .forEach((key) => {
      if (typeof attachmentFromTemplate[`${key}`]
        === typeof attachmentFromRequestBody[`${key}`]) {
        /** Filter for each of the value type and their key of the object */
        filteredAttachment[`${key}`] = attachmentFromRequestBody[`${key}`];
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
