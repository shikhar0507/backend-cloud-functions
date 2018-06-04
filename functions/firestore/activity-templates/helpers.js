const {
  isValidLocation,
  isValidDate,
} = require('../activity/helper');


const validateSchedule = (schedule) => {
  if (!schedule) return false;
  if (typeof schedule.name !== 'string') return false;
  if (!isValidDate(schedule.startTime)) return false;
  if (!isValidDate(schedule.endTime)) return false;
  if (schedule.endTime < schedule.startTime) return false;

  return true;
};


const validateVenue = (venue) => {
  if (!venue) return false;
  if (typeof venue.venueDescriptor !== 'string') return false;
  if (typeof venue.address !== 'string') return false;
  if (typeof venue.location !== 'string') return false;
  if (Object.prototype.toString
    .call(venue.geopoint) !== '[object Object]') return false;
  if (!isValidLocation(venue.geopoint)) return false;

  return true;
};

const validateAttachment = (attachment) => {
  if (!attachment) return false;
  /** TODO: implement this */
  return true;
};


module.exports = {
  validateSchedule,
  validateVenue,
  validateAttachment,
};
