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


const dateFormats = require('../../admin/constants').dateFormats;

const momentTz = require('moment-timezone');

const momentDateObject = (() => {
  const today = (() => {
    const momentToday = momentTz();

    return {
      MONTH_NUMBER: momentToday.month(),
      MONTH_NAME_SHORT: momentToday.format('MMM'),
      MONTH_NAME_LONG: momentToday.format('MMMM'),
      DATE_NUMBER: momentToday.date(),
      YEAR: momentToday.year(),
    };
  })();

  const yesterday = (() => {
    const momentYesterday = momentTz().subtract(1, 'day');

    return {
      MONTH_NUMBER: momentYesterday.month(),
      MONTH_NAME_SHORT: momentYesterday.format('MMM'),
      MONTH_NAME_LONG: momentYesterday.format('MMMM'),
      DATE_NUMBER: momentYesterday.date(),
      YEAR: momentYesterday.year(),
    };
  })();

  return { today, yesterday };
})();


const getYesterdaysDateString = () => {
  const today = new Date();
  today.setDate(today.getDate() - 1);

  return today.toDateString();
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

// https://momentjs.com/docs/#/displaying/format/
const dateStringWithOffset = (options) => {
  const {
    timezone,
    timestampToConvert,
    format,
  } = options;

  if (!timestampToConvert || !timezone) return '';

  const targetZonedDate = momentTz.tz(timestampToConvert, timezone);

  return targetZonedDate.format(format || dateFormats.DATE);
};

const timeStringWithOffset = (options) => {
  const {
    timezone,
    timestampToConvert,
  } = options;

  if (!timestampToConvert || !timezone) return '';

  const targetZonedTime = momentTz.tz(timestampToConvert, timezone);

  return targetZonedTime.format(dateFormats.TIME);
};


module.exports = {
  monthsArray,
  weekdaysArray,
  alphabetsArray,
  momentDateObject,
  dateStringWithOffset,
  timeStringWithOffset,
  getYesterdaysDateString,
};
