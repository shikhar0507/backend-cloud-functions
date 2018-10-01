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


const getPlaceInformation = (mapsApiResult) => {
  const results = mapsApiResult.json.results;
  const firstResult = results[0];
  const addressComponents = firstResult['address_components'];
  let city = '';
  let locality = '';

  addressComponents.forEach((component) => {
    const longName = component['long_name'];
    const types = component.types;

    if (types.includes('locality') && types.includes('political')) {
      city = longName;
    }

    if (types.includes('administrative_area_level_2')) {
      locality = longName;
    }
  });

  return {
    city,
    locality,
    formattedAddress: firstResult['formatted_address'],
  };
};


const getLatLngString = (location) =>
  `${location._latitude},${location._longitude}`;


const getLocationUrl = (geopoint) =>
  `https://www.google.co.in/maps/@${getLatLngString(geopoint)}`;


const getLocalTime = (countryCode) => {
  const today = new Date();

  if (countryCode === '+91') {
    today.setHours(today.getHours() + 5);
    today.setMinutes(today.getMinutes() + 30);
  }

  return new Date(today)
    .toTimeString()
    .split(' ')[0];
};


module.exports = (addendumDoc) => {
  const {
    activityData,
    /** Location is geopoint */
    location,
    /** User is the phone number */
    user,
  } = addendumDoc.data();

  const {
    officeId,
  } = activityData;

  /** Default value for the distance is 0... */
  let distance = 0;

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .where('user', '==', user)
    .orderBy('timestamp', 'desc')
    .limit(2)
    .get()
    .then((docs) => {
      /** In the query, the doc at the position 0 will the same doc for
       * which the cloud function is triggered. Hence, the distance calculated
       * will always remain zero.
       */
      const doc = docs.docs[1];

      if (doc) {
        const geopointOne = doc.get('location');
        distance = haversineDistance(geopointOne, location);
      }

      console.log('distance:', distance);

      if (distance === 0) {
        console.log('Distance is ZERO');

        /** Distance is zero, so no logging is required since the person
         * didn't move from their previous location.
         */
        return Promise.resolve();
      }

      console.log({
        currID: addendumDoc.id,
        prevID: doc ? doc.id : null,
      });

      return googleMapsClient
        .reverseGeocode({
          latlng: getLatLngString(location),
        })
        .asPromise();
    })
    .then((mapsApiResult) => {
      const placeInformation = getPlaceInformation(mapsApiResult);

      const locationInfo = {
        date: new Date().toDateString(),
        timeString: getLocalTime('+91'),
        // remark: getRemark(addendumDoc),
        remark: '',
        distanceTravelled: distance.toFixed(2),
        locationUrl: getLocationUrl(location),
        city: placeInformation.city,
        locality: placeInformation.locality,
        formattedAddress: placeInformation.formattedAddress,
      };

      console.log({ locationInfo, });

      return db
        .doc(addendumDoc.ref.path)
        .set(locationInfo, {
          merge: true,
        });
    })
    .catch(console.error);
};
