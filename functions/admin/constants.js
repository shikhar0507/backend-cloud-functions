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
  share: 'share',
  update: 'update',
  create: 'create',
  comment: 'comment',
  changeStatus: 'change-status',
  updatePhoneNumber: 'update-phone-number',
};

const reportingActions = {
  clientError: 'clientError',
  authDeleted: 'authDeleted',
  authChanged: 'authChanged',
  authDisabled: 'authDisabled',
  usedCustomClaims: 'usedCustomClaims',
};

const sendGridTemplateIds = {
  dsr: 'd-e7a922e42d67456dafcc2926731250a0',
  leave: 'd-ae3a31066b0f447bbf8661570b4dc719',
  payroll: 'd-cf7785c6a4a04285b1b2cee7d0227052',
  signUps: 'd-a73b2f579c8746758ba2753fbb0341df',
  installs: 'd-835f877b46bb4cc8aad6df8d735e27a1',
  dutyRoster: 'd-9b9c44018c3b41a8805189476a38c172',
  footprints: 'd-90095557c1c54de1a153626bb0fbe03d',
  expenseClaim: 'd-ae3a31066b0f447bbf8661570b4dc719',
};

const templatesSet = new Set()
  .add('admin')
  .add('branch')
  .add('check-in')
  .add('customer-type')
  .add('customer')
  .add('department')
  .add('dsr')
  .add('duty roster')
  .add('employee')
  .add('expense claim')
  .add('expense-type')
  .add('leave-type')
  .add('office')
  .add('product')
  .add('recipient')
  .add('subscription')
  .add('supplier-type')
  .add('supplier')
  .add('tour plan');


module.exports = {
  vowels,
  weekdays,
  validTypes,
  httpsActions,
  templatesSet,
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
