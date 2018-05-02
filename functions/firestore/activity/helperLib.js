const getGeopointObject = require('../../admin/admin').getGeopointObject;

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

const isValidPhoneNumber = (phoneNumber) => {
  // FIXME: Add logic here
  // regex: ^\+?[1-9]\d{5,14}$
  if (!isValidString(phoneNumber)) return false;
  return true;
};

const scheduleCreator = (schedule) => {
  const schedules = {};
  // venue needs to be an array.
  if (Array.isArray(schedule)) {
    schedule.forEach((sch, index) => {
      if (!isNaN(new Date(sch.startTime)) && !sch.endTime) {
        // schedule has startTime but not endTime
        schedules[`${index}`] = {
          name: sch.name || '',
          startTime: new Date(new Date(sch.startTime).toUTCString()),
          endTime: new Date(new Date(sch.startTime).toUTCString()),
        };
      } else if (!isNaN(new Date(sch.startTime)) &&
        !isNaN(new Date(sch.endTime)) &&
        sch.endTime >= sch.startTime) {
        // schedule has both startTime, endTime & endTime  >= startTime
        schedules[`${index}`] = {
          name: sch.name || '',
          startTime: getDateObject(sch.startTime),
          endTime: getDateObject(sch.endTime),
        };
      }
    });
  }
  return schedules;
};

const venueCreator = (venue) => {
  const venues = {};

  if (Array.isArray(venue)) {
    venue.forEach((val, index) => {
      if (!isValidLocation(val.geopoint)) return;

      // if both conditions above are false, create the venue
      venues[`${index}`] = {
        venueDescriptor: val.venueDescriptor || '',
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

const getDateObject = (date) => new Date(new Date(date).toUTCString());

const handleCanEdit = (canEditRule) => true;

module.exports = {
  scheduleCreator,
  venueCreator,
  getDateObject,
  handleCanEdit,
  isValidString,
  isValidDate,
  isValidLocation,
  isValidPhoneNumber,
};
