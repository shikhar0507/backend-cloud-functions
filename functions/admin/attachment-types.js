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


const validTypes = new Map();

validTypes.set('office', 'office');
validTypes.set('string', 'string');
validTypes.set('phoneNumber', 'phoneNumber');
validTypes.set('weekday', 'weekday');
validTypes.set('template', 'template');

const weekdays = new Map();

weekdays.set('monday', 'monday');
weekdays.set('tuesday', 'tuesday');
weekdays.set('wednesday', 'wednesday');
weekdays.set('thursday', 'thursday');
weekdays.set('friday', 'friday');
weekdays.set('saturday', 'saturday');
weekdays.set('sunday', 'sunday');

const activityStatuses = new Map();

activityStatuses.set('CONFIRMED', 'CONFIRMED');
activityStatuses.set('CANCELLED', 'CANCELLED');
activityStatuses.set('PENDING', 'PENDING');

const canEditRules = new Map();

canEditRules.set('ALL', 'ALL');
canEditRules.set('NONE', 'NONE');
canEditRules.set('CREATOR', 'CREATOR');
canEditRules.set('ADMIN', 'ADMIN');
canEditRules.set('EMPLOYEE', 'EMPLOYEE');


module.exports = {
  weekdays,
  validTypes,
  activityStatuses,
  canEditRules,
};
