'use strict';


const {
  rootCollections,
  db,
} = require('../../admin/admin');

const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: require('../../admin/env').mapsApiKey,
      Promise: Promise,
    });


const haversineDistance = (geopointOne, geopointTwo) => {
  const toRad = (value) => value * Math.PI / 180;

  const RADIUS_OF_EARTH = 6371;
  const distanceBetweenLatitudes =
    toRad(
      geopointOne._latitude - geopointTwo._latitude
    );
  const distanceBetweenLongitudes =
    toRad(
      geopointOne._longitude - geopointTwo._longitude
    );

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

  console.log('distance without check:', distance);

  /** We ignore the distance if the distance is less than 1 */
  return distance > 0.5 ? distance : 0;
};


const getLocationUrl = (plusCode) => `https://plus.codes/${plusCode}`;


const getPlaceInformation = (mapsApiResult) => {
  if (!mapsApiResult) {
    return {
      url: '',
      identifier: '',
    };
  }

  const firstResult = mapsApiResult.json.results[0];
  const addressComponents = firstResult['address_components'];

  let identifier = '';

  addressComponents.forEach((component) => {
    const longName = component['long_name'];
    const types = component.types;

    if (!types.includes('political')) return;

    if (types.includes('sublocality')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('locality')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('administrative_area_level_2')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('administrative_area_level_1')) {
      identifier += ` ${longName} `;
    }
  });

  const plusCode = mapsApiResult.json['plus_code']['global_code'];

  return {
    identifier: identifier.trim(),
    url: getLocationUrl(plusCode),
  };
};


const getLatLngString = (location) =>
  `${location._latitude},${location._longitude}`;


const getLocalTime = (countryCode) => {
  const today = new Date();

  if (countryCode === '+91') {
    /** India is +5:30 hours ahead of UTC */
    today.setHours(today.getHours() + 5);
    today.setMinutes(today.getMinutes() + 30);
  }

  return new Date(today)
    .toTimeString()
    .split(' ')[0];
};

const toLog = (options) => {
  const {
    template,
    action,
  } = options;

  if (action !== 'create') return false;

  return new Set()
    .add('check-in')
    .add('leave')
    .add('tour-plan')
    .has(template);
};

const isAccurate = (addendumDoc) => {
  const checkInLocation = addendumDoc.get('activityData.venue')[0].geopoint;
  const addendumLocation = addendumDoc.get('location');

  /** Needs to be accurate upto 500m. */
  return haversineDistance(checkInLocation, addendumLocation) < 0.5;
};


module.exports = (addendumDoc) => {
  const {
    activityData,
    /** Location is geopoint */
    location,
    /** User is the phone number */
    user,
    action,
  } = addendumDoc.data();

  const {
    officeId,
    office,
    template,
  } = activityData;

  if (!toLog({ template, action, })) return Promise.resolve();

  console.log(addendumDoc.ref.path);

  const batch = db.batch();

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .where('user', '==', user)
        .orderBy('timestamp', 'desc')
        .limit(2)
        .get(),
      rootCollections
        .inits
        .where('activityData.office', '==', office)
        .where('report', '==', 'payroll')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      if (!result) return Promise.resolve();

      const [
        oldAddendumDocsQuery,
        initDocsQuery,
      ] = result;

      /**
       * In the query, the doc at the position 0 will the same doc for
       * which the cloud function is triggered. Hence, the distance calculated
       * will always remain zero.
       */
      const previousAddendum = oldAddendumDocsQuery.docs[1];

      const batch = db.batch();

      /** Default value for the distance is 0... */
      let distance = 0;
      let accumulatedDistance = 0;

      if (previousAddendum) {
        const geopointOne = previousAddendum.get('location');
        accumulatedDistance = previousAddendum.get('accumulatedDistance') || 0;

        distance = haversineDistance(geopointOne, location);

        accumulatedDistance += distance;
      }

      console.log({
        distance,
        accumulatedDistance,
      });

      const promises = [
        Promise
          .resolve({
            distance,
            accumulatedDistance,
          }),
      ];

      if (distance > 0) {
        promises.push(googleMapsClient
          .reverseGeocode({
            latlng: getLatLngString(location),
          })
          .asPromise());
      }

      return Promise
        .all(promises);
    })
    .then((result) => {
      if (!result) return Promise.resolve();

      const [
        locationData,
        mapsApiResult,
      ] = result;

      const placeInformation = getPlaceInformation(mapsApiResult);

      const today = new Date();

      batch.set(addendumDoc.ref, {
        day: today.getDay(),
        month: today.getMonth(),
        year: today.getFullYear(),
        date: today.toDateString(),
        timeString: getLocalTime('+91'),
        distanceFromPrevAddendum: locationData.distance,
        accumulatedDistance: locationData.accumulatedDistance,
        url: placeInformation.url,
        identifier: placeInformation.identifier,
        // distanceAccurate: locationData.distance < 0.5,
        distanceAccurate: isAccurate(addendumDoc),
      }, {
          merge: true,
        });

      return batch.commit();
    })
    .catch(console.error);
};
