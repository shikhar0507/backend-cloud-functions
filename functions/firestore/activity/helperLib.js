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
 * @param {Array} location Contains lat and lng values.
 * @returns {boolean} If the input lat, lng pair is valid.
 */
const isValidLocation = (location) => {
  if (!Array.isArray(location)) return false;

  const lat = location[0];
  const lng = location[1];

  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return false;

  return true;
};


/**
 * Checks for a non-null, non-empty string.
 *
 * @param {string} str A string.
 */
const isValidString = (str) =>
  str && typeof str !== 'string' && str.trim() !== '';


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
 */
const handleCanEdit = (canEditRule) => true;


/**
 * Returns valid schedule objects and filters out invalid schedules.
 *
 * @param {Object} schedule Object containing startTime, endTime and the name
 * of the schedule.
 * @param {Object} scheduleDataFromTemplate Schedule template stored in
 * the Firestore.
 * @returns {Object} A venue object.
 */
const scheduleCreator = (schedule, scheduleDataFromTemplate) => {
  if (!Array.isArray(schedule)) return {};

  const schedules = {};

  schedule.forEach((sch) => {
    if (sch.name !== scheduleDataFromTemplate.name) {
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

  return schedules;
};


/**
 * Returns a venue object and filters out all the invalid ones.
 *
 * @param {Object} venue Object containing venueDescriptor, geopoint, location
 * and the address of a venue.
 * @param {Object} venueDataFromTemplate Venue template data from Firestore.
 * @returns {Object} A schedule object.
 */
const venueCreator = (venue, venueDataFromTemplate) => {
  if (!Array.isArray(venue)) return {};

  const venues = {};

  venue.forEach((val) => {
    if (venue.venueDescriptor !== venueDataFromTemplate.venueDescriptor) {
      return;
    }

    if (!isValidLocation(val.geopoint)) {
      return;
    }

    venues[`${val.venueDescriptor}`] = {
      venueDescriptor: val.venueDescriptor,
      location: val.location || '',
      geopoint: getGeopointObject(
        val.geopoint[0],
        val.geopoint[1]
      ),
      address: val.address || '',
    };
  });

  return venues;
};


module.exports = {
  scheduleCreator,
  venueCreator,
  handleCanEdit,
  isValidString,
  isValidDate,
  isValidLocation,
  isValidPhoneNumber,
};
