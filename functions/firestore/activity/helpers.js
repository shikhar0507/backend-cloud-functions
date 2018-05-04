const {
  getGeopointObject,
} = require('../../admin/admin');

const isValidLocation = (location) => {
  if (Array.isArray(location)) {
    const lat = location[0];
    const lng = location[1];

    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return true;
  }
  return false;
};

const isValidString = (value) => {
  if (typeof value === 'string') {
    if (value.trim() !== '') return true;
  }
  return false;
};

const isValidDate = (date) => !isNaN(new Date(date));

const scheduleCreator = (conn) => {
  const validScheduleObject = {};
  // venue needs to be an array.
  if (Array.isArray(conn.req.body.schedule)) {
    conn.req.body.schedule.forEach((sch, index) => {
      if (!isNaN(new Date(sch.startTime)) && !sch.endTime) {
        // schedule has startTime but not endTime
        validScheduleObject[`${index}`] = {
          name: sch.name || '',
          startTime: new Date(new Date(sch.startTime).toUTCString()),
          endTime: new Date(new Date(sch.startTime).toUTCString()),
        };
      } else if (!isNaN(new Date(sch.startTime)) &&
        !isNaN(new Date(sch.endTime)) &&
        sch.endTime >= sch.startTime) {
        // schedule has both startTime, endTime & endTime  >= startTime
        validScheduleObject[`${index}`] = {
          name: sch.name || '',
          startTime: getDateObject(sch.startTime),
          endTime: getDateObject(sch.endTime),
        };
      }
    });
  }
  return validScheduleObject;
};

const venueCreator = (conn) => {
  const validVenueObject = {};

  if (Array.isArray(conn.req.body.venue)) {
    conn.req.body.venue.forEach((val, index) => {
      if (!Array.isArray(val.geopoint)) {
        // skip the iteration where the geopoint is not of type array
        return;
      }

      if (!((val.geopoint[0] >= -90 && val.geopoint[0] <= 90) &&
        (val.geopoint[1] >= -180 && val.geopoint[1] <= 180))) {
        // if the geopoint is an array, but doesn't have the valid ranges,
        // skip the iteration
        return;
      }

      // if both conditions above are false, create the venue
      validVenueObject[`${index}`] = {
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
  return validVenueObject;
};

const getDateObject = (date) => new Date(new Date(date).toUTCString());

const handleCanEdit = (canEditRule) => true;

module.exports = {
  scheduleCreator,
  venueCreator,
  getDateObject,
  handleCanEdit,
  validateLocation,
  isValidString,
  isValidDate,
};
