'use strict';

const {
  rootCollections,
  db,
} = require('../../admin/admin');

const googleMapsClient = require('@google/maps')
  .createClient({
    key: require('../../admin/env').mapsApiKey,
  });

const getLatLngString = (geopoint) =>
  `${geopoint._latitude},${geopoint._longitude}`;

const getLocationUrl = (geopoint) =>
  `https://www.google.co.in/maps/@${getLatLngString(geopoint)}`;


const haversineDistance = (coords1, coords2) => {
  const toRad = (x) => x * Math.PI / 180;

  const lon1 = coords1[0];
  const lat1 = coords1[1];
  const lon2 = coords2[0];
  const lat2 = coords2[1];
  /** In KM */
  const RADIUS_OF_EARTH = 6371;

  const x1 = lat2 - lat1;

  const dLat = toRad(x1);
  const x2 = lon2 - lon1;
  const dLon = toRad(x2);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
    * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = RADIUS_OF_EARTH * c;

  return dist;
};

const getUpdateData = (addendumDoc) => {

};

const getDocData = (addendumDoc) => {

};


module.exports = (addendumDoc, context) => {
  const {
    user,
    location,
    activityData,
  } = addendumDoc.data();
  const batch = db.batch();

  const locals = {
    'latlng': getLatLngString(location),
  };

  console.log('context:', context);
  console.log('getLocationUrl:', getLocationUrl(location));

  return rootCollections
    .inits
    .where('office', '==', activityData.office)
    .where('date', '==', new Date().toDateString())
    .limit(1)
    .get()
    .then((docs) => {
      if (docs.empty) {
        batch.set(rootCollections.inits.doc(), {
          [user]: getUpdateData(addendumDoc),
        }, {
            merge: true,
          });

        return batch.commit();
      }

      batch.set(docs.docs[0].ref, {
        [user]: getDocData(addendumDoc),
      }, {
          merge: true,
        });

      return batch.commit();
    })
    .catch(console.error);
};
