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


const validTypes = new Map()
  .set('office', 'office')
  .set('string', 'string')
  .set('phoneNumber', 'phoneNumber')
  .set('weekday', 'weekday')
  .set('template', 'template');

const weekdays = new Map()
  .set('monday', 'monday')
  .set('tuesday', 'tuesday')
  .set('wednesday', 'wednesday')
  .set('thursday', 'thursday')
  .set('friday', 'friday')
  .set('saturday', 'saturday')
  .set('sunday', 'sunday');

const activityStatuses = new Map()
  .set('CONFIRMED', 'CONFIRMED')
  .set('CANCELLED', 'CANCELLED')
  .set('PENDING', 'PENDING');

const canEditRules = new Map()
  .set('ALL', 'ALL')
  .set('NONE', 'NONE')
  .set('CREATOR', 'CREATOR')
  .set('ADMIN', 'ADMIN')
  .set('EMPLOYEE', 'EMPLOYEE');


module.exports = {
  weekdays,
  validTypes,
  activityStatuses,
  canEditRules,
};
