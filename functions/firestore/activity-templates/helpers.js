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
  isValidLocation,
  isValidDate,
} = require('../activity/helper');


const validateSchedule = (schedule) => {
  if (!schedule) return false;
  if (typeof schedule.name !== 'string') return false;
  if (!isValidDate(schedule.startTime)) return false;
  if (!isValidDate(schedule.endTime)) return false;
  if (schedule.endTime < schedule.startTime) return false;

  return true;
};


const validateVenue = (venue) => {
  if (!venue) return false;
  if (typeof venue.venueDescriptor !== 'string') return false;
  if (typeof venue.address !== 'string') return false;
  if (typeof venue.location !== 'string') return false;
  if (Object.prototype.toString
    .call(venue.geopoint) !== '[object Object]') return false;
  if (!isValidLocation(venue.geopoint)) return false;

  return true;
};


/**
 * Validates the attachment object.
 *
 * @param {Object} attachment Extra data for activity.
 * @returns {boolean} If the attachment is valid.
 */
const validateAttachment = (attachment) => {
  if (!attachment) return false;
  /** TODO: implement this */
  return true;
};


module.exports = {
  validateSchedule,
  validateVenue,
  validateAttachment,
};
