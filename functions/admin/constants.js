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
  .set('email', 'email')
  .set('number', 'number')
  .set('string', 'string')
  .set('weekday', 'weekday')
  .set('phoneNumber', 'phoneNumber')
  .set('HH:MM', 'HH:MM')
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
  .set('attachment', 'attachment')
  .set('hidden', 'hidden');

/** Used while creating comments, to handle vowels correctly. */
const vowels = new Map()
  .set('a', 'a')
  .set('e', 'e')
  .set('i', 'i')
  .set('o', 'o')
  .set('u', 'u');

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

const httpsActions = {
  create: 'create',
  update: 'update',
  changeStatus: 'change-status',
  share: 'share',
  updatePhoneNumber: 'update-phone-number',
  comment: 'comment',
};

const reportingActions = {
  authDeleted: 'authDeleted',
  authDisabled: 'authDisabled',
  usedCustomClaims: 'usedCustomClaims',
  authChanged: 'authChanged',
};

const sendGridTemplateIds = {
  signUps: 'd-a73b2f579c8746758ba2753fbb0341df',
  installs: 'd-835f877b46bb4cc8aad6df8d735e27a1',
  footprints: '',
};


module.exports = {
  vowels,
  weekdays,
  validTypes,
  httpsActions,
  canEditRules,
  templateFields,
  shareBodyFields,
  activityStatuses,
  reportingActions,
  createBodyFields,
  updateBodyFields,
  removeBodyFields,
  commentBodyFields,
  sendGridTemplateIds,
  changeStatusBodyFields,
  phoneNumberUpdateBodyFields,
};
