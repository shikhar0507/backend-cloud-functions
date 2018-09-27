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

const calculateDistance = (geopointOne, geopointTwo) => {
  const toRad = (value) => value * Math.PI / 180;

  const RADIUS_OF_EARTH = 6371; // km
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

  /** We ignore the distance if the distance is less than 1 */
  return distance < 0 ? 0 : distance;
};


const getRemark = (addendumDoc) => {
  const activityData = addendumDoc.get('activityData');
  const template = activityData.template;

  let remark = '';

  if (template === 'check-in' || template === 'dsr' || template === 'tour plan') {
    remark = activityData.attachment.Comment.value;
  }

  if (template === 'expense' || template === 'leave') {
    remark = activityData.attachment.Reason.value;
  }

  return remark;
};

const getPlaceInformation = (result) => {
  const addressComponents = result[0]['address_components'];
  const locality = addressComponents[0];
  const city = addressComponents[1];

  return {
    city: city['long_name'],
    locality: locality['long_name'],
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
  } = addendumDoc.data();

  const {
    office,
    officeId,
  } = activityData;

  const batch = db.batch();

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
        .where('date', '==', new Date().toDateString())
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
        distanceTravelled = calculateDistance(lastLocation, location);
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
      const footprints = {
        /** User === phone number */
        [user]: {
          [timeString]: {
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
        date: new Date().toDateString(),
      }, {
          merge: true,
        });

      return batch.commit();
    })
    .catch((error) => JSON.stringify(error));
};
