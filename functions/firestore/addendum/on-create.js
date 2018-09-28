'use strict';

const {
  rootCollections,
  db,
} = require('../../admin/admin');
const {
  getISO8601Date,
} = require('../../admin/utils');
const {
  httpsActions,
} = require('../../admin/constants');

const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: require('../../admin/env').mapsApiKey,
      Promise: Promise,
    });

const haversineDistance = (geopointOne, geopointTwo) => {
  const toRad = (value) => value * Math.PI / 180;

  const RADIUS_OF_EARTH = 6371;
  const distanceBetweenLatitudes = toRad(geopointOne._latitude - geopointTwo._latitude);
  const distanceBetweenLongitudes = toRad(geopointOne._longitude - geopointTwo._longitude);
  const lat1 = toRad(geopointOne._latitude);
  const lat2 = toRad(geopointTwo._latitude);

  const a =
    Math.sin(distanceBetweenLatitudes / 2)
    * Math.sin(distanceBetweenLatitudes / 2)
    + Math.sin(distanceBetweenLongitudes / 2)
    * Math.sin(distanceBetweenLongitudes / 2)
    * Math.cos(lat1)
    * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = RADIUS_OF_EARTH * c;

  console.log({
    distanceWithoutCheck: distance,
  });

  /** We ignore the distance if the distance is less than 1 */
  return distance < 1 ? 0 : distance;
};


const getRemark = (addendumDoc) => {
  const activityData = addendumDoc.get('activityData');
  const action = addendumDoc.get('action');

  let remark = '';

  const actionsToLog = new Set()
    .add('create')
    .add('update');

  if (new Set()
    .add('check-in')
    .add('dsr')
    .add('tour plan')
    .has(activityData.template)
    && actionsToLog.has(action)) {
    remark = activityData.attachment.Comment.value;
  }

  if (new Set()
    .add('expense')
    .add('leave')
    .has(activityData.template)
    && actionsToLog.has(action)) {
    remark = activityData.attachment.Reason.value;
  }

  return remark;
};

/**
 * Not all addendum contain the data that is relevant to the
 * footprints report. This function validates those conditions.
 *
 * @param {Object} options Metadata about the event.
 * @returns {Boolean} To log or not.
 */
const isValidFootprint = (options) => {
  let isValid = true;

  const {
    template,
    status,
    action,
  } = options;

  const templatesSet =
    new Set()
      .add('check-in')
      .add('tour plan')
      .add('duty roster')
      .add('dsr')
      .add('leave');

  if (!templatesSet.has(template)) {
    isValid = false;
  }

  if (template === 'check-in'
    && action !== httpsActions.create) {
    isValid = false;
  }

  if (template === 'duty roster'
    || template === 'tour plan'
    && action !== httpsActions.changeStatus
    && status !== 'CONFIRMED') {
    isValid = false;
  }

  if (template === 'dsr'
    && action !== httpsActions.create) {
    isValid = false;
  }

  return isValid;
};


const getPlaceInformation = (results) => {
  const addressComponents = results[0]['address_components'];
  const locality = addressComponents[0];
  const city = addressComponents[1];

  return {
    city: city['long_name'],
    locality: locality['long_name'],
    formattedAddress: results['formatted_address'],
  };
};

const getLatLngString = (location) =>
  `${location._latitude},${location._longitude}`;

const getLocationUrl = (geopoint) =>
  `https://www.google.co.in/maps/@${getLatLngString(geopoint)}`;


const getLocalTime = (countryCode) => {
  const timestamp = new Date();

  if (countryCode === '+91') {
    timestamp.setHours(timestamp.getHours() + 5);
    timestamp.setMinutes(timestamp.getMinutes() + 30);
  }

  const offsetted = new Date(timestamp);

  return offsetted.toTimeString().split(' ')[0];
};


module.exports = (addendumDoc) => {
  const {
    activityData,
    /** Location is the geopoint */
    location,
    /** User is the phone number */
    user,
    action,
  } = addendumDoc.data();

  const {
    office,
    officeId,
    template,
    status,
  } = activityData;

  const options = {
    template, status, action,
  };

  if (!isValidFootprint(options)) {
    return Promise.resolve();
  }

  const batch = db.batch();

  const todaysDateString = new Date().toDateString();

  return Promise
    .all([
      googleMapsClient
        .reverseGeocode({
          latlng: getLatLngString(location),
        })
        .asPromise(),
      rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .orderBy('timestamp', 'desc')
        .where('user', '==', user)
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('office', '==', office)
        .where('date', '==', todaysDateString)
        .where('report', '==', 'footprints')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        mapsApiResult,
        lastAddendumQuery,
        initDocQuery,
      ] = result;
      /**
       * When the addendum doesn't exist for today, this simply means that
       * this person is just starting the work.
       */
      let distanceTravelled = 0;

      if (!lastAddendumQuery.empty) {
        const lastLocation = lastAddendumQuery.docs[0].get('location');
        distanceTravelled = haversineDistance(lastLocation, location);

        console.log({
          lastLocation,
          distanceTravelled,
          location,
        });
      }

      let docRef = rootCollections.inits.doc();

      if (!initDocQuery.empty) {
        docRef = initDocQuery.docs[0].ref;
      }

      /**
       * Time is the only thing that is unique for each addendum for a single
       * user.
       */
      const timeString = getLocalTime('+91');
      const isoDate = getISO8601Date();
      const footprints = {
        /** User === phone number */
        [user]: {
          [timeString]: {
            date: isoDate,
            distanceTravelled,
            remark: getRemark(addendumDoc),
            geopointMeta: getPlaceInformation(mapsApiResult.json.results),
            locationUrl: getLocationUrl(location),
          },
        },
      };

      console.log({
        footprints,
        initDocPath: docRef.path,
      });

      batch.set(docRef, {
        office,
        officeId,
        footprints,
        report: 'footprints',
        date: todaysDateString,
      }, {
          merge: true,
        });

      return batch.commit();
    })
    .catch((error) => JSON.stringify(error));
};
