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

const convertToNumberingScheme = number => {
  const baseChar = ('A').charCodeAt(0);
  let letters = '';

  do {
    number -= 1;
    letters = String.fromCharCode(baseChar + (number % 26)) + letters;
    number = (number / 26) >> 0;
  } while (number > 0);

  return letters;
};

const getExcelHeader = range => {
  return [...Array(range).keys()]
    .map(number => convertToNumberingScheme(number + 1));
};

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

const getEmployeeDetailsString = (employeesData, phoneNumber) => {
  if (!employeesData[phoneNumber]) {
    return `Not an active employee`;
  }

  const supervisorsString = (() => {
    let result = [];
    let firstSupervisor = employeesData[phoneNumber]['First Supervisor'];
    let secondSupervisor = employeesData[phoneNumber]['Second Supervisor'];

    if (employeesData[firstSupervisor]) {
      firstSupervisor = employeesData[firstSupervisor].Name;
    }

    if (employeesData[secondSupervisor]) {
      secondSupervisor = employeesData[secondSupervisor].Name;
    }

    if (employeesData[firstSupervisor]) {
      result.push(employeesData[firstSupervisor].Name);
    } else {
      result.push(firstSupervisor);
    }

    if (employeesData[secondSupervisor]) {
      result.push(employeesData[secondSupervisor].Name);
    } else {
      result.push(secondSupervisor);
    }

    if (result.length === 0) {
      return result;
    }

    return ` | Supervisors: ${result}`;
  })();

  return `Name: ${employeesData[phoneNumber].Name}`
    + ` | Employee Code: ${employeesData[phoneNumber]['Employee Code']}`
    + ` | Contact Number: ${employeesData[phoneNumber]['Employee Contact']}`
    + `${supervisorsString}`;
};

const getUrl = doc => {
  const venue = doc
    .get('activityData.venue');

  if (venue && venue[0] && venue[0].location) {
    return toMapsUrl(venue[0].geopoint);
  }

  if (doc.get('venueQuery')
    && doc.get('venueQuery').location) {
    return toMapsUrl(doc.get('venueQuery').geopoint);
  }

  return doc.get('url') || '';
};

const getIdentifier = doc => {
  const venue = doc
    .get('activityData.venue');

  if (venue && venue[0] && venue[0].location) {
    return venue[0].location;
  }

  if (doc.get('venueQuery')
    && doc.get('venueQuery').location) {
    return doc
      .get('venueQuery')
      .location;
  }

  return doc.get('identifier');
};

const getStatusForDay = options => {
  const {
    numberOfCheckIns, // number of actions done in the day by the user
    minimumDailyActivityCount,
    minimumWorkingHours,
    hoursWorked // difference between first and last action in hours,
  } = options;

  let activityRatio = numberOfCheckIns / minimumDailyActivityCount;

  if (activityRatio > 1) {
    activityRatio = 1;
  }

  /** Could be `undefined`, so ignoring further actions related it it */
  if (!minimumWorkingHours) {
    return activityRatio;
  }

  const workHoursRatio = hoursWorked / minimumWorkingHours;
  const minOfRatios = Math.min(activityRatio, workHoursRatio);
  const rev = 1 / minimumDailyActivityCount;

  if (minOfRatios <= rev) {
    return rev;
  }

  return Math.floor(minOfRatios / rev) * rev;
};


module.exports = {
  getUrl,
  toMapsUrl,
  monthsArray,
  employeeInfo,
  weekdaysArray,
  getIdentifier,
  getExcelHeader,
  alphabetsArray,
  getStatusForDay,
  momentOffsetObject,
  dateStringWithOffset,
  timeStringWithOffset,
  getEmployeeDetailsString,
};
