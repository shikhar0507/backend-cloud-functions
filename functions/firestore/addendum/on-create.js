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

const getLatLngString = (location) =>
  `${location._latitude},${location._longitude}`;

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

const distanceAccurate = (addendumDoc) => {
  const geopointOne = addendumDoc.get('location');
  const geopointTwo
    = addendumDoc
      .get('activityData.venue')[0]
      .geopoint;

  return haversineDistance(geopointOne, geopointTwo) < 0.5;
};

const getTimeString = (countryCode, timestamp) => {
  if (countryCode === '+91') {
    /** India is +5:30 hours ahead of UTC */
    timestamp.setHours(timestamp.getHours() + 5);
    timestamp.setMinutes(timestamp.getMinutes() + 30);
  }

  return new Date(timestamp)
    .toTimeString()
    .split(' ')[0];
};

const getDisplayText = (addendumDoc) => {
  let displayText = '';
  const status = addendumDoc.get('activityData.status');
  const template = addendumDoc.get('activityData.template');

  if (status === 'CANCELLED') {
    return deleteField();
  }

  if (template === 'leave') {
    const leaveType = addendumDoc.get('activityData.attachment.Leave Type.value');
    displayText = leaveType || 'LEAVE UNSPECIFIED';
  }

  if (template === 'tour plan') {
    displayText = 'ON DUTY';
  }

  return displayText;
};

const getPayrollObject = (addendumDoc, payrollInitDocQuery) => {
  const NUM_SECS_IN_DAY = 86400000;
  const initDoc = payrollInitDocQuery.docs[0];
  const displayText = getDisplayText(addendumDoc);
  const phoneNumber = addendumDoc.get('user');
  const schedulesArray = addendumDoc.get('activityData.schedule');

  let payrollObject = {};

  if (initDoc) {
    payrollObject = initDoc.get('payrollObject') || {};
  }

  if (!payrollObject[phoneNumber]) {
    payrollObject[phoneNumber] = {};
  }

  if (addendumDoc.get('action') === 'update') {
    const oldSchedulesArray = addendumDoc.get('activityOld.schedule');

    oldSchedulesArray.forEach((schedule) => {
      let startTime = schedule.startTime;
      let endTime = schedule.endTime;

      if (!startTime || !endTime) return;

      startTime = startTime.toDate().getTime();
      endTime = endTime.toDate().getTime();

      while (startTime <= endTime) {
        const date = new Date(startTime).getDate();
        payrollObject[phoneNumber][date] = displayText;

        startTime += NUM_SECS_IN_DAY;
      }
    });
  }

  schedulesArray.forEach((schedule) => {
    let startTime = schedule.startTime;
    let endTime = schedule.endTime;

    if (!startTime || !endTime) return;
    startTime = startTime.toDate().getTime();
    endTime = endTime.toDate().getTime();

    while (startTime <= endTime) {
      const date = new Date(startTime).getDate();
      payrollObject[phoneNumber][date] = displayText;

      startTime += NUM_SECS_IN_DAY;
    }
  });

  const nonEmptyItemsArray
    = Object
      .keys(payrollObject[phoneNumber])
      .filter((item) => item !== '');

  /**
   * When the whole object contains empty string, the recipients onUpdate
   * should query the addendumDocs for this user's day activity. Leaving this field
   * here even when it is filled with objects will make the Recipients onUpdate
   * function to skip this user.
   */
  if (nonEmptyItemsArray.length === 0) {
    payrollObject[phoneNumber] = deleteField();
  }

  return payrollObject;
};

const getDateString = (timestamp) => {
  if (!timestamp) {
    return {
      timeString: '',
      dateString: '',
    };
  }

  const dateObject = timestamp.toDate();

  return {
    timeString: dateObject.toTimeString().split(' ')[0],
    dateString: dateObject.toDateString(),
  };
};

const getVisitsObject = (addendumDoc, dsrInitDocsQuery) => {
  const visitsObject = (() => {
    if (dsrInitDocsQuery.empty) return {};

    return dsrInitDocsQuery
      .docs[0]
      .get('visitsObject');
  })();
  const activityData = addendumDoc.get('activityData');
  const [
    visitDateSchedule,
    followUpDateSchedule,
    closureDateSchedule,
  ] = activityData.schedule;
  const phoneNumber = addendumDoc.get('user');
  const visitDateObject
    = getDateString(visitDateSchedule.startTime);
  const followUpDateObject
    = getDateString(followUpDateSchedule.startTime);
  const closureDateObject
    = getDateString(closureDateSchedule.startTime);

  if (!visitsObject[phoneNumber]) {
    visitsObject[phoneNumber] = {};
  }

  if (visitDateObject.timeString) {
    visitsObject[phoneNumber][visitDateObject.timeString] = {
      visitDate: visitDateObject.dateString,
      customer: activityData.attachment.Customer.value,
      firstContact: activityData.attachment['First Contact'].value,
      secondContact: activityData.attachment['Second Contact'].value,
      product1: activityData.attachment['Product 1'].value,
      product2: activityData.attachment['Product 2'].value,
      followUpDate: followUpDateObject.dateString,
      comment: activityData.attachment.Comment.value,
    };
  }

  return visitsObject;
};

const getFollowUpObject = (addendumDoc, dsrInitDocsQuery) => {
  const followUpObject = (() => {
    if (dsrInitDocsQuery.empty) return {};

    return dsrInitDocsQuery
      .docs[0]
      .get('visitsObject');
  })();
  const activityData = addendumDoc.get('activityData');
  const [
    visitDateSchedule,
    followUpDateSchedule,
    closureDateSchedule,
  ] = activityData.schedule;
  const phoneNumber = addendumDoc.get('user');
  const visitDateObject
    = getDateString(visitDateSchedule.startTime);
  const followUpDateObject
    = getDateString(followUpDateSchedule.startTime);
  const closureDateObject
    = getDateString(closureDateSchedule.startTime);

  if (!followUpObject[phoneNumber]) {
    followUpObject[phoneNumber] = {};
  }

  if (followUpDateObject.timeString) {
    followUpObject[phoneNumber][visitDateObject.timeString] = {
      followUpDate: followUpDateObject.dateString,
      customer: activityData.attachment.Customer.value,
      firstContact: activityData.attachment['First Contact'].value,
      secondContact: activityData.attachment['Second Contact'].value,
      product1: activityData.attachment['Product 1'].value,
      product2: activityData.attachment['Product 2'].value,
      closureDate: closureDateObject.dateString,
      comment: activityData.attachment.Comment.value,
    };
  }
};

const getClosuresObject = (addendumDoc, dsrInitDocsQuery) => {
  const closuresObject = (() => {
    if (dsrInitDocsQuery.empty) return {};

    return dsrInitDocsQuery.docs[0].get('closuresObject');
  })();

  return closuresObject;
};


module.exports = (addendumDoc) => {
  const phoneNumber = addendumDoc.get('user');
  const template = addendumDoc.get('activityData.template');
  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');
  const timestamp = addendumDoc.get('timestamp').toDate();
  const action = addendumDoc.get('action');
  const day = timestamp.getDate();
  const month = timestamp.getMonth();
  const year = timestamp.getFullYear();
  const batch = db.batch();


  console.log(addendumDoc.ref.path);

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .where('user', '==', phoneNumber)
    .orderBy('timestamp', 'desc')
    .limit(2)
    .get()
    .then((docs) => {
      const previousAddendumDoc = docs.docs[1];

      const distance = () => {
        if (!previousAddendumDoc) {
          return {
            accumulated: 0,
            travelled: 0,
          };
        }

        const geopointOne = previousAddendumDoc.get('location');
        const geopointTwo = addendumDoc.get('location');
        const distanceTravelled
          = haversineDistance(geopointOne, geopointTwo);
        const accumulatedDistance
          = previousAddendumDoc.get('accumulatedDistance') || 0;

        return {
          accumulated: accumulatedDistance + distanceTravelled,
          travelled: distanceTravelled,
        };
      };

      return Promise
        .all([
          googleMapsClient
            .reverseGeocode({
              latlng: getLatLngString(addendumDoc.get('location')),
            })
            .asPromise(),
          Promise.resolve(distance()),
        ]);
    })
    .then((result) => {
      const [
        mapsApiResult,
        distance,
      ] = result;

      const placeInformation = getPlaceInformation(mapsApiResult);

      const updateObject = {
        day,
        month,
        year,
        distanceTravelled: distance.accumulated,
        timeString: getTimeString('+91', timestamp),
        dateString: new Date().toDateString(),
        url: placeInformation.url,
        identifier: placeInformation.identifier,
      };

      if (template === 'check-in') {
        updateObject.distanceAccurate = distanceAccurate(addendumDoc);
      }

      batch.set(addendumDoc.ref, updateObject, {
        merge: true,
      });

      if (!new Set([
        'leave', 'check-in', 'tour plan',
      ])
        .has(template)) return Promise.resolve();

      if (action !== httpsActions.create
        || action !== httpsActions.update) {
        return Promise.resolve();
      }

      return rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', 'payroll')
        .where('month', '==', timestamp.getMonth())
        .where('year', '==', timestamp.getFullYear())
        .limit(1)
        .get();
    })
    .then((payrollInitDocQuery) => {
      if (!payrollInitDocQuery) return Promise.resolve();

      batch.set(payrollInitDocQuery.docs[0].ref, {
        day,
        month, year,
        office,
        officeId,
        date: timestamp.toDateString(),
        payrollObject: getPayrollObject(addendumDoc, payrollInitDocQuery),
      }, {
          merge: true,
        });

      if (template !== 'dsr') return Promise.resolve();

      return rootCollections
        .inits
        .where('office', '==', office)
        .where('report', '==', 'dsr')
        .where('date', '==', timestamp.toDateString())
        .limit(1)
        .get();
    })
    .then((dsrInitDocsQuery) => {
      if (!dsrInitDocsQuery) return Promise.resolve();

      const visitsObject = getVisitsObject(addendumDoc, dsrInitDocsQuery);
      const followUpObject = getFollowUpObject(addendumDoc, dsrInitDocsQuery);
      const closureObject = getClosuresObject(addendumDoc, dsrInitDocsQuery);
      const initDocRef = (() => {
        if (dsrInitDocsQuery.empty) {
          return rootCollections.inits.doc();
        }

        return dsrInitDocsQuery.docs[0].ref;
      })();

      batch.set(initDocRef, {
        office,
        officeId,
        visitsObject,
        followUpObject,
        closureObject,
        report: 'dsr',
        date: timestamp.toDateString(),
      }, {
          merge: true,
        });

      return batch;
    })
    .then(() => batch.commit())
    .catch(console.error);
};
