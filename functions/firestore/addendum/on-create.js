'use strict';

const {
  rootCollections,
  db,
} = require('../../admin/admin');
const {
  getISO8601Date,
} = require('../../admin/utils');

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
    office,
    officeId,
  } = activityData;

  const locals = {
    /** Default value for the distance is 0... */
    distance: 0,
    initDocRef: rootCollections.inits.doc(),
    todaysDateString: new Date().toDateString(),
  };

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .where('user', '==', user)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('office', '==', 'office')
        .where('date', '==', locals.todaysDateString)
        .where('report', '==', 'footprints')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        lastAddendumQuery,
        initDocQuery,
      ] = result;

      if (!initDocQuery.empty) {
        locals.initDocRef = initDocQuery.docs[0].ref;
      }

      /**
       * When the addendum doesn't exist for today, this simply means that
       * this person is just starting the work.
       */
      if (!lastAddendumQuery.empty) {
        const geopointOne = lastAddendumQuery.docs[0].get('location');
        locals.distance = haversineDistance(geopointOne, location);
      }

      console.log({
        lastAddendumQueryEmpty: lastAddendumQuery.empty,
        initDocQueryEmpty: initDocQuery.empty,
        geopointOne: location,
        geopointTwo: !lastAddendumQuery.empty ? lastAddendumQuery.docs[0].get('location') : null,
      });

      if (locals.distance === 0) {
        console.log('Distance is 0');

        return Promise.resolve();
      }

      const options = {
        latlng: getLatLngString(location),
      };

      return googleMapsClient
        .reverseGeocode(options)
        .asPromise();
    })
    .then((mapsApiResult) => {
      const timeString = getLocalTime('+91');
      const batch = db.batch();

      const footprints = {
        /** User === phone number */
        [user]: {
          [timeString]: {
            distanceTravelled: locals.distance,
            date: getISO8601Date(),
            remark: getRemark(addendumDoc),
            geopointMeta: getPlaceInformation(mapsApiResult),
            locationUrl: getLocationUrl(location),
          },
        },
      };

      console.log({ footprints, });

      batch.set(locals.initDocRef, {
        office,
        officeId,
        footprints,
        report: 'footprints',
        date: locals.todaysDateString,
      }, {
          merge: true,
        });

      return batch.commit();
    })
    .catch((error) => JSON.stringify(error));
};
