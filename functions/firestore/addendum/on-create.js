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
  const RADIUS_OF_EARTH = 6371;

  const x1 = lat2 - lat1;

  const dLat = toRad(x1);
  const x2 = lon2 - lon1;
  const dLon = toRad(x2)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = RADIUS_OF_EARTH * c;

  return dist;
};

module.exports = (addendumDoc) => {
  const {
    geopoint,
    activityData,
  } = addendumDoc.data();

  const locals = {
    'latlng': getLatLngString(geopoint),
  };

  return Promise.resolve();
};
