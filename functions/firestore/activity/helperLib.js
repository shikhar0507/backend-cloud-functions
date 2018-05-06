const {
  getGeopointObject,
} = require('../../admin/admin');

const isValidLocation = (location) => {
  if (!Array.isArray(location)) return false;

  const lat = location[0];
  const lng = location[1];

  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return false;

  return true;
};

const isValidString = (str) => {
  if (!str || typeof str !== 'string' || str.trim() === '') return false;
  return true;
};

const isValidDate = (date) => !isNaN(new Date(date));

/**
 * Verifies a phone number based on the E.164 standard.
 *
 * @param {string} phoneNumber A valid (E.164) phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const isValidPhoneNumber = (phoneNumber) => new RegExp(/^\+?[1-9]\d{5,14}$/);

const scheduleCreator = (schedule, scheduleDataFromTemplate) => {
  const schedules = {};

  if (Array.isArray(schedule)) {
    schedule.forEach((sch) => {
      if (sch.name !== scheduleDataFromTemplate.name) return;

      if (!isNaN(new Date(sch.startTime)) && !sch.endTime) {
        // schedule has startTime but not endTime
        schedules[`${sch.name}`] = {
          name: sch.name,
          startTime: new Date(sch.startTime),
          endTime: new Date(sch.startTime),
        };
      } else if (!isNaN(new Date(sch.startTime)) &&
        !isNaN(new Date(sch.endTime)) &&
        sch.endTime >= sch.startTime) {
        // schedule has both startTime, endTime & endTime  >= startTime
        schedules[`${sch.name}`] = {
          name: sch.name,
          startTime: new Date(sch.startTime),
          endTime: new Date(sch.endTime),
        };
      }
    });
  }
  return schedules;
};

const venueCreator = (venue, venueDataFromTemplate) => {
  const venues = {};

  if (Array.isArray(venue)) {
    venue.forEach((val) => {
      if (venue.venueDescriptor !== venueDataFromTemplate.venueDescriptor) {
        return;
      }

      if (!isValidLocation(val.geopoint)) {
        return;
      }

      venues[`${val.venueDescriptor}`] = {
        venueDescriptor: val.venueDescriptor,
        location: val.location || '',
        geopoint: getGeopointObject(
          val.geopoint[0],
          val.geopoint[1]
        ),
        address: val.address || '',
      };
    });
  }

  return venues;
};


const handleCanEdit = (canEditRule) => true;

module.exports = {
  scheduleCreator,
  venueCreator,
  handleCanEdit,
  isValidString,
  isValidDate,
  isValidLocation,
  isValidPhoneNumber,
};
