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


const { isValidDate, isValidGeopoint, } = require('../../admin/utils');


/**
 * Handles whether a person has the authority to edit an activity after it is
 * created.
 *
 * @param {Object} locals Object containing local data.
 * @param {string} phoneNumber Number to check the `canEdit` rule for.
 * @param {string} requesterPhoneNumber Phone number of the requester.
 * @param {Array} assignees Array of people who are assignees of the activity.
 * @returns {boolean} Depends on the subscription and the phoneNumber in args.
 */
const handleCanEdit = (locals, phoneNumber, requesterPhoneNumber, assignees = []) => {
  if (locals.canEditRule === 'ALL') return true;

  if (locals.canEditRule === 'NONE') return false;

  /** List of assignees... */
  if (locals.canEditRule === 'FROM_INCLUDE') {
    if (locals.include.indexOf(phoneNumber) > -1
      || assignees.indexOf(phoneNumber) > -1) {
      return true;
    }

    return false;
  }

  // TODO: this needs to be implemented.
  if (locals.canEditRule === 'PEOPLE_TYPE') return true;

  if (locals.canEditRule === 'CREATOR') {
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
 * @param {Array} requestBodySchedule Schedules from request body.
 * @param {Array} scheduleNames Schedules from template.
 * @returns {Array} Of valid schedules.
 */
const filterSchedules = (requestBodySchedule, scheduleNames) => {
  const defaultSchedules = [];

  if (!scheduleNames) return defaultSchedules;

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
      if (!isValidDate(schedule.startTime)
        && !isValidDate(schedule.endTime)) return;

      /** Schedule has valid `startTime` */
      if (isValidDate(schedule.startTime) && !schedule.hasOwnProperty('endTime')) {
        validSchedules.push({
          name: schedule.name,
          startTime: new Date(schedule.startTime),
          endTime: new Date(schedule.startTime),
        });

        return;
      }

      if (isValidDate(schedule.endTime) && isValidDate(schedule.startTime)
        && schedule.endTime >= schedule.startTime) {
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

  return validSchedules;
};


/**
 * Validates the venues based on the `venueDescriptors` and
 * valid geopoint object.
 *
 * @param {Array} requestBodyVenue Venue objects from request.
 * @param {Array} venueDescriptors Venue descriptors from template.
 * @returns {Array} Valid venues based on template.
 */
const filterVenues = (requestBodyVenue, venueDescriptors) => {
  let validVenues = [];
  const defaultVenues = [];

  if (!venueDescriptors) return defaultVenues;

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
      if (venue.venueDescriptor !== venueDescriptor) return;

      if (!isValidGeopoint(venue.geopoint)) return;

      validVenues.push({
        geopoint: getGeopointObject(venue.geopoint),
        venueDescriptor: venue.venueDescriptor,
        location: venue.location || '',
        address: venue.address || '',
      });
    });
  });

  if (validVenues.length === 0) {
    validVenues = defaultVenues;
  }

  return validVenues;
};


/**
 * Filters out all the non-essential keys from the attachment object in the
 * request body using the attachment object from the template.
 *
 * @param {Object} reqBodyAttachment Attachment from the request.body.attachment.
 * @param {Object} templateAttachment Attachment from the template in db.
 * @returns {Object} Valid attachment object.
 */
const filterAttachment = (reqBodyAttachment, templateAttachment) => {
  const filteredAttachment = {};

  const requestBodyAttachmentKeys = Object.keys(reqBodyAttachment);
  const templateAttachmentKeys = Object.keys(templateAttachment);

  templateAttachmentKeys.forEach((key) => {
    requestBodyAttachmentKeys.forEach((valueName) => {
      if (key !== valueName) return;
      if (!reqBodyAttachment[valueName].hasOwnProperty('value')) return;

      /** If the value field is missing, the attachment object isn't valid. */
      filteredAttachment[key] = reqBodyAttachment[key].value;
    });
  });

  return filteredAttachment;
};


module.exports = {
  filterVenues,
  handleCanEdit,
  filterSchedules,
  filterAttachment,
};
