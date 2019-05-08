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


const {
  dateFormats,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');

const momentOffsetObject = (timezone) => {
  const momentToday = momentTz()
    .utc()
    .clone()
    .tz(timezone);

  const momentYesterday = momentTz()
    .utc()
    .clone()
    .tz(timezone)
    .subtract(1, 'days');

  const today = {
    MONTH_NUMBER: momentToday.month(),
    DATE_NUMBER: momentToday.date(),
    YEAR: momentToday.year(),
  };

  const yesterday = {
    MONTH_NUMBER: momentYesterday.month(),
    DATE_NUMBER: momentYesterday.date(),
    YEAR: momentYesterday.year(),
  };

  return { today, yesterday };
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

// Why generate when you can store??
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
  'AA',
  'AB',
  'AC',
  'AD',
  'AE',
  'AF',
  'AG',
  'AH',
  'AI',
  'AJ',
  'AK',
  'AK',
  'AL',
  'AM',
  'AN',
  'AO',
  'AP',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AV',
  'AW',
  'AX',
  'AY',
  'AZ',
  'BA',
  'BB',
  'BC',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BK',
  'BL',
  'BM',
  'BN',
  'BO',
  'BP',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BU',
  'BV',
  'BW',
  'BX',
  'BY',
  'BZ',
];

// https://momentjs.com/docs/#/displaying/format/
const dateStringWithOffset = (options) => {
  const {
    timezone,
    timestampToConvert,
    format,
  } = options;

  if (!timestampToConvert || !timezone) {
    return '';
  }

  const targetZonedDate = momentTz.tz(timestampToConvert, timezone);

  return targetZonedDate
    .format(format || dateFormats.DATE);
};

const timeStringWithOffset = (options) => {
  const {
    timezone,
    timestampToConvert,
    format,
  } = options;

  if (!timestampToConvert || !timezone) return '';

  const targetZonedDate = momentTz.tz(timestampToConvert, timezone);

  return targetZonedDate
    .format(format || dateFormats.TIME);
};

const employeeInfo = (employeesData, phoneNumber) => {
  if (!employeesData[phoneNumber]) {
    return {
      name: '',
      firstSupervisor: '',
      secondSupervisor: '',
      department: '',
      baseLocation: '',
      employeeCode: '',
    };
  }

  return {
    name: employeesData[phoneNumber].Name,
    firstSupervisor: employeesData[phoneNumber]['First Supervisor'],
    secondSupervisor: employeesData[phoneNumber]['Second Supervisor'],
    department: employeesData[phoneNumber].Department,
    baseLocation: employeesData[phoneNumber]['Base Location'],
    employeeCode: employeesData[phoneNumber]['Employee Code'],
  };
};

const toMapsUrl = (geopoint) => {
  const latitude = geopoint._latitude || geopoint.latitude;
  const longitude = geopoint._longitude || geopoint.longitude;

  return `https://maps.google.com/?q=${latitude},${longitude}`;
};


module.exports = {
  toMapsUrl,
  monthsArray,
  employeeInfo,
  weekdaysArray,
  alphabetsArray,
  momentOffsetObject,
  dateStringWithOffset,
  timeStringWithOffset,
};
