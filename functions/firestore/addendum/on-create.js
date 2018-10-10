'use strict';


const {
  rootCollections,
  db,
  deleteField,
} = require('../../admin/admin');

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

  return distance;
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

const isAccurate = (addendumDoc) => {
  const checkInLocation = addendumDoc.get('activityData.venue')[0].geopoint;
  const addendumLocation = addendumDoc.get('location');

  /** Needs to be accurate upto 500m. */
  return haversineDistance(checkInLocation, addendumLocation) < 0.5;
};


const getPayrollObject = (addendumDoc, initDocsQuery) => {
  const initDoc = initDocsQuery.docs[0];
  let payrollObject = {};

  if (initDoc) {
    payrollObject = initDoc.get('payrollObject') || {};
  }

  const schedulesArray = addendumDoc.get('activityData.schedule');

  let displayText = '';

  if (addendumDoc.get('activityData.template') === 'leave') {
    displayText
      = addendumDoc
        .get('activityData.attachment.Leave Type.value')
      || 'LEAVE UNSPECIFIED';
  }

  if (addendumDoc.get('activityData.template') === 'tour plan') {
    displayText = 'ON DUTY';
  }

  /**
   * BUG: If the endTime is updated to something that is before
   * the previous endTime, the entries in the init doc will remain
   * outdated.
   */
  if (addendumDoc.get('activityData.status') === 'CANCELLED') {
    displayText = '';
  }

  const NUM_SECS_IN_DAY = 86400000;

  if (!payrollObject[addendumDoc.get('user')]) {
    payrollObject[addendumDoc.get('user')] = {};
  }

  if (addendumDoc.get('action') === 'update') {
    const oldSchedulesArray = addendumDoc.get('updatedFields.activityBody.schedule');

    oldSchedulesArray.forEach((schedule) => {
      let startTime = schedule.startTime;
      let endTime = schedule.endTime;

      if (!startTime || !endTime) return;

      startTime = startTime.toDate().getTime();
      endTime = endTime.toDate().getTime();

      while (startTime <= endTime) {
        payrollObject[addendumDoc.get('user')][new Date(startTime).getDate()] = deleteField();

        startTime += NUM_SECS_IN_DAY;
      }
    });
  }

  console.log('displayText', displayText);

  /** FIX: Addendum onCreate doesn't know the old state of the activity doc,
   * so, it can't delete the schedules from the old values in the object
   * when in an update.
   *
   * TODO: If the `endTime` extends to the next month, multiple init docs should
   * be created for this user.
   */
  schedulesArray.forEach((schedule) => {
    let startTime = schedule.startTime;
    let endTime = schedule.endTime;

    if (!startTime || !endTime) return;

    startTime = startTime.toDate().getTime();
    endTime = endTime.toDate().getTime();

    while (startTime <= endTime) {
      payrollObject[addendumDoc.get('user')][new Date(startTime).getDate()] = displayText;

      startTime += NUM_SECS_IN_DAY;
    }
  });

  console.log('payrollObject', payrollObject);

  return payrollObject;
};


module.exports = (addendumDoc) => {
  const locals = {
    batch: db.batch(),
    distanceFromPrevAddendum: 0,
    accumulatedDistance: 0,
    today: new Date(),
  };

  console.log(addendumDoc.ref.path);

  if (!new Set()
    .add(httpsActions.create)
    .add(httpsActions.changeStatus)
    .add(httpsActions.update)
    .has(addendumDoc.get('action'))) {
    console.log('Only create and change-status are logged...');

    return Promise.resolve();
  }

  return Promise
    .all([
      rootCollections
        .offices
        .doc(addendumDoc.get('activityData.officeId'))
        .collection('Addendum')
        .where('user', '==', addendumDoc.get('user'))
        .orderBy('timestamp', 'desc')
        .limit(2)
        .get(),
      rootCollections
        .inits
        .where('office', '==', addendumDoc.get('activityData.office'))
        .where('report', '==', 'payroll')
        .where('month', '==', locals.today.getMonth())
        .where('year', '==', locals.today.getFullYear())
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        oldAddendumDocsQuery,
        initDocsQuery,
      ] = result;

      console.log(
        'oldAddendumDocsQuery',
        oldAddendumDocsQuery.size,
        'initDocsQuery',
        initDocsQuery.size
      );

      locals.initDocsQuery = initDocsQuery;

      if (!initDocsQuery.empty) {
        locals.initDoc = initDocsQuery.docs[0].ref;
      } else {
        locals.initDoc = rootCollections.inits.doc();
      }

      console.log('locals.initDoc', locals.initDoc.ref);

      /**
       * In the query, the doc at the position 0 will the same doc for
       * which the cloud function is triggered. Hence, the distance calculated
       * will always remain zero.
       */
      const previousAddendum = oldAddendumDocsQuery.docs[1];

      if (previousAddendum) {
        const geopointOne = previousAddendum.get('location');
        locals.accumulatedDistance =
          previousAddendum.get('accumulatedDistance') || 0;

        locals.distanceFromPrevAddendum =
          haversineDistance(geopointOne, addendumDoc.get('location'));

        locals.accumulatedDistance += locals.distanceFromPrevAddendum;
      }

      return googleMapsClient
        .reverseGeocode({
          latlng: getLatLngString(addendumDoc.get('location')),
        })
        .asPromise();
    })
    .then((mapsApiResult) => {
      const placeInformation = getPlaceInformation(mapsApiResult);

      if (addendumDoc.get('activityData.template') === 'check-in') {
        // Data for check-in
        const updatedData = {
          day: locals.today.getDay(),
          month: locals.today.getMonth(),
          year: locals.today.getFullYear(),
          date: locals.today.toDateString(),
          timeString: getLocalTime('+91'),
          distanceFromPrevAddendum: locals.distanceFromPrevAddendum,
          accumulatedDistance: locals.accumulatedDistance,
          url: placeInformation.url,
          identifier: placeInformation.identifier,
          distanceAccurate: isAccurate(addendumDoc),
        };

        console.log({ updatedData, });

        locals.batch.set(addendumDoc.ref, updatedData, {
          merge: true,
        });
      }

      if (new Set()
        .add('leave')
        .add('tour plan')
        .add('check-in')
        .has(addendumDoc.get('activityData.template'))) {
        locals.batch.set(locals.initDoc, {
          day: locals.today.getDay(),
          month: locals.today.getMonth(),
          year: locals.today.getFullYear(),
          date: locals.today.toDateString(),
          report: 'payroll',
          office: addendumDoc.get('activityData.office'),
          officeId: addendumDoc.get('activityData.officeId'),
          payrollObject: getPayrollObject(addendumDoc, locals.initDocsQuery),
        }, {
            merge: true,
          });
      }

      return locals.batch.commit();
    })
    .catch(console.error);
};
