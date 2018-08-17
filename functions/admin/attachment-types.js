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


/** Types allowed for the field `type` in the attachment object. */
const validTypes = new Map()
  .set('string', 'string')
  .set('weekday', 'weekday')
  .set('office', 'office')
  .set('phoneNumber', 'phoneNumber')
  .set('moment.HTML5_FMT.TIME', 'moment.HTML5_FMT.TIME')
  .set('base64', 'base64');

/** Weekdays accepted in the attachment for the field `type` of `weekday`. */
const weekdays = new Map()
  .set('monday', 'monday')
  .set('tuesday', 'tuesday')
  .set('wednesday', 'wednesday')
  .set('thursday', 'thursday')
  .set('friday', 'friday')
  .set('saturday', 'saturday')
  .set('sunday', 'sunday');

/**
 * Statuses which are allowed for the `activity`, `subscription` or `office`.
 */
const activityStatuses = new Map()
  .set('PENDING', 'PENDING')
  .set('CONFIRMED', 'CONFIRMED')
  .set('CANCELLED', 'CANCELLED');

/**
 * Values of `canEdit` which for validating the `canEditRule`.
 */
const canEditRules = new Map()
  .set('ALL', 'ALL')
  .set('NONE', 'NONE')
  .set('ADMIN', 'ADMIN')
  .set('CREATOR', 'CREATOR')
  .set('EMPLOYEE', 'EMPLOYEE');

const templateFields = new Map()
  .set('name', 'name')
  .set('statusOnCreate', 'statusOnCreate')
  .set('canEditRule', 'canEditRule')
  .set('venue', 'venue')
  .set('schedule', 'schedule')
  .set('comment', 'comment')
  .set('attachment', 'attachment');

const vowels = new Map()
  .set('a', 'a')
  .set('e', 'e')
  .set('i', 'i')
  .set('o', 'o')
  .set('u', 'u');

const sgMailTemplateIds = new Map()
  .set('instantEmails', 'd-a9a592a473d6414d94a8344e8f16c8a0');

const createBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('template', 'template')
  .set('activityName', 'activityName')
  .set('share', 'share')
  .set('venue', 'venue')
  .set('schedule', 'schedule')
  .set('attachment', 'attachment');

const updateBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('schedule', 'schedule')
  .set('venue', 'venue');

const shareBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('share', 'share');

const changeStatusBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('status', 'status');

const commentBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('comment', 'comment');

const removeBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('activityId', 'activityId')
  .set('remove', 'remove');

const phoneNumberUpdateBodyFields = new Map()
  .set('timestamp', 'timestamp')
  .set('geopoint', 'geopoint')
  .set('phoneNumber', 'phoneNumber');


module.exports = {
  vowels,
  weekdays,
  validTypes,
  canEditRules,
  templateFields,
  activityStatuses,
  sgMailTemplateIds,
  createBodyFields,
  updateBodyFields,
  shareBodyFields,
  removeBodyFields,
  commentBodyFields,
  changeStatusBodyFields,
  phoneNumberUpdateBodyFields,
};
