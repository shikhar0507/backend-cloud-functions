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
  if (typeof location !== 'object') return false;

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
const isValidString = (str) =>
  str && typeof str === 'string' && str.trim() !== '';


/**
 * Checks whether the number is a valid Unix timestamp.
 *
 * @param {Object} date Javascript Date object.
 * @returns {boolean} Whether the number is a valid Unix timestamp.
 */
const isValidDate = (date) => !isNaN(new Date(date));


/**
 * Verifies a phone number based on the E.164 standard.
 *
 * @param {string} phoneNumber A phone number.
 * @returns {boolean} Whethere the number is a valid E.164 phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const isValidPhoneNumber = (phoneNumber) =>
  new RegExp(/^\+?[1-9]\d{5,14}$/).test(phoneNumber);


/**
 * Handles whether a person has the authority to edit an activity after
 * creation.
 *
 * @param {string} canEditRule Rule stating whether a someone can edit
 * an activity.
 * @param {Object} ruleEnumFromDB Object containing the enum array.
 * @returns {boolean} If a person can edit the activity after creation.
 */
const handleCanEdit = (canEditRule, ruleEnumFromDB) => {
  return true;
};


/**
 * Returns valid schedule objects and filters out invalid schedules.
 *
 * @param {Object} schedule Object containing startTime, endTime and the name
 * of the schedule.
 * @param {Object} scheduleDataFromDB Schedule template stored in
 * the Firestore.
 * @returns {Object} A venue object.
 */
const scheduleCreator = (schedule, scheduleDataFromDB) => {
  if (!Array.isArray(schedule)) return {};

  const schedules = {};

  schedule.forEach((sch) => {
    if (sch.name !== scheduleDataFromDB.name) {
      return;
    }

    if (!isNaN(new Date(sch.startTime)) && !sch.endTime) {
      // schedule has startTime but not endTime
      schedules[`${sch.name}`] = {
        name: sch.name,
        startTime: new Date(sch.startTime),
        endTime: new Date(sch.startTime),
      };
    } else if (!isNaN(new Date(sch.startTime)) &&
      !isNaN(new Date(sch.endTime)) &&
      sch.endTime >= sch.startTime) {
      // schedule has both startTime, endTime & endTime  >= startTime
      schedules[`${sch.name}`] = {
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
    schedules[scheduleDataFromDB.name] = {
      name: scheduleDataFromDB.name,
      startTime: null,
      endTime: null,
    };
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
const venueCreator = (venue, venueDataFromDB) => {
  if (!Array.isArray(venue)) return {};

  const venues = {};

  venue.forEach((val) => {
    if (venue.venueDescriptor !== venueDataFromDB.venueDescriptor) {
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
    venues[venueDataFromDB.venueDescriptor] = {
      venueDescriptor: val.venueDescriptor,
      location: null,
      geopoint: null,
      address: null,
    };
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
  scheduleCreator,
  venueCreator,
  handleCanEdit,
  isValidString,
  isValidDate,
  isValidLocation,
  isValidPhoneNumber,
  attachmentCreator,
};
