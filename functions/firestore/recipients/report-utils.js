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


const getYesterdaysDateString = () => {
  const today = new Date();
  today.setDate(today.getDate() - 1);

  return today.toDateString();
};


const getPreviousDayMonth = () => {
  const today = new Date();
  const yesterday = new Date(today.setDate(today.getDate() - 1));

  return yesterday.getMonth();
};

const getPreviousDayYear = () => {
  const today = new Date();
  const yesterday = new Date(today.setDate(today.getDate() - 1));

  return yesterday.getFullYear();
};

const getNumberOfDaysInMonth = (options) => {
  const {
    month,
    year,
  } = options;

  /** Month starts with 0 */
  return new Date(year, month + 1, 0).getDate();
};

const monthsArray = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
];

const weekdaysArray = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const alphabetsArray = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
];


const dateStringWithOffset = (options) => {
  const {
    timezone,
    timestampToConvert,
  } = options;

  if (!timestampToConvert) return '';

  const moment = require('moment-timezone');
  const date = new Date(timestampToConvert);

  const localTime = moment(date).format('YYYY-MM-DDTHH:mm:ss.SSS');
  const targetZonedTime = moment.tz(localTime, timezone);

  const split = targetZonedTime.toString().split(' ');

  const dateString = `${split[1]} ${split[2]} ${split[3]}`;

  return dateString;
};

const timeStringWithOffset = (options) => {
  const {
    timezone,
    timestampToConvert,
  } = options;

  if (!timestampToConvert) return '';

  const moment = require('moment-timezone');
  const date = new Date(timestampToConvert);
  const fmt = 'YYYY-MM-DDTHH:mm:ss.SSS';
  const localTime = moment(date).format(fmt);
  const targetZonedTime = moment.tz(localTime, timezone);

  const split = targetZonedTime.toString().split(' ');

  const timeString = split[4].split(':');

  return `${timeString[0]}:${timeString[1]}`;
};


module.exports = {
  monthsArray,
  weekdaysArray,
  alphabetsArray,
  getPreviousDayYear,
  getPreviousDayMonth,
  dateStringWithOffset,
  timeStringWithOffset,
  getNumberOfDaysInMonth,
  getYesterdaysDateString,
};
