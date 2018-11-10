'use strict';


const {
  rootCollections,
  db,
  deleteField,
} = require('../../admin/admin');

const {
  httpsActions,
} = require('../../admin/constants');
const {
  haversineDistance,
} = require('../activity/helper');

const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: require('../../admin/env').mapsApiKey,
      Promise: Promise,
    });

const getDateAndTimeStrings = (timestamp) => {
  if (!timestamp) {
    return {
      timeString: '',
      dateString: '',
    };
  }

  const dateObject = new Date(timestamp);

  return {
    timeString: dateObject.toTimeString().split(' ')[0],
    dateString: dateObject.toDateString(),
  };
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
    displayText = (() => {
      const leaveType =
        addendumDoc.get('activityData.attachment.Leave Type.value');

      if (leaveType) return `LEAVE - ${leaveType}`;

      return `LEAVE`;
    })();
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

  if (addendumDoc.get('action') === httpsActions.update) {
    console.log('inside update');

    const oldSchedulesArray = addendumDoc.get('activityOld.schedule');

    oldSchedulesArray.forEach((schedule) => {
      let startTime = schedule.startTime;
      const endTime = schedule.endTime;

      if (!startTime || !endTime) return;

      while (startTime <= endTime) {
        const date = new Date(startTime).getDate();
        // payrollObject[phoneNumber][date] = displayText;
        delete payrollObject[phoneNumber][date];

        startTime += NUM_SECS_IN_DAY;
      }
    });
  }

  schedulesArray.forEach((schedule) => {
    let startTime = schedule.startTime;
    const endTime = schedule.endTime;

    if (!startTime || !endTime) return;

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

  if (addendumDoc.get('action') === httpsActions.changeStatus
    && addendumDoc.get('activityData.status') === 'CANCELLED') {
    schedulesArray.forEach((schedule) => {
      let startTime = schedule.startTime;
      const endTime = schedule.endTime;

      if (!startTime || !endTime) return;

      while (startTime <= endTime) {
        const date = new Date(startTime).getDate();
        /** Leave CANCELLED, so not reflecting that in the final payroll report */
        payrollObject[phoneNumber][date] = deleteField();

        startTime += NUM_SECS_IN_DAY;
      }
    });
  }

  /**
   * When the whole object contains empty string, the recipients onUpdate
   * should query the addendumDocs for this user's day activity. Leaving this field
   * here even when it is filled with objects will make the Recipients onUpdate
   * function to skip this user.
   */
  if (nonEmptyItemsArray.length === 0) {
    delete payrollObject[phoneNumber];
  }

  return payrollObject;
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
    // closureDateSchedule,
  ] = activityData.schedule;
  const phoneNumber = addendumDoc.get('user');
  const visitDateObject
    = getDateAndTimeStrings(visitDateSchedule.startTime);
  const followUpDateObject
    = getDateAndTimeStrings(followUpDateSchedule.startTime);

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

const getFollowUpsObject = (addendumDoc, dsrInitDocsQuery) => {
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
    = getDateAndTimeStrings(visitDateSchedule.startTime);
  const followUpDateObject
    = getDateAndTimeStrings(followUpDateSchedule.startTime);
  const closureDateObject
    = getDateAndTimeStrings(closureDateSchedule.startTime);

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

  return followUpObject;
};


const getClosureObject = (addendumDoc, dsrInitDocsQuery) => {
  const closureObject = (() => {
    if (dsrInitDocsQuery.empty) return {};

    return dsrInitDocsQuery.docs[0].get('closureObject');
  })();
  const activityData = addendumDoc.get('activityData');
  const [
    visitDateSchedule,
    followUpDateSchedule,
    closureDateSchedule,
  ] = activityData.schedule;
  const phoneNumber = addendumDoc.get('user');
  const visitDateObject
    = getDateAndTimeStrings(visitDateSchedule.startTime);
  const followUpDateObject
    = getDateAndTimeStrings(followUpDateSchedule.startTime);
  const closureDateObject
    = getDateAndTimeStrings(closureDateSchedule.startTime);

  if (!closureObject[phoneNumber]) {
    closureObject[phoneNumber] = {};
  }

  if (followUpDateObject.timeString) {
    closureObject[phoneNumber][visitDateObject.timeString] = {
      visitDate: visitDateObject.dateString,
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

  return closureObject;
};

const getDutyRosterObject = (addendumDoc, dutyRosterInitDocsQuery) => {
  const dutyRosterObject = (() => {
    if (dutyRosterInitDocsQuery.empty) return {};

    return dutyRosterInitDocsQuery.docs[0].get('dutyRosterObject');
  })();

  const user = addendumDoc.get('user');
  const action = addendumDoc.get('action');
  const timestamp = new Date(addendumDoc.get('timestamp'));
  const status = addendumDoc.get('activityData.status');
  const schedule = addendumDoc.get('activityData.schedule')[0];
  const venue = addendumDoc.get('activityData.venue')[0];
  const activityId = addendumDoc.get('activityId');
  const dutyType = addendumDoc.get('activityData.attachment.Duty Type.value');
  const description = addendumDoc.get('activityData.attachment.Description.value');
  const reportingTime = (() => {
    if (!schedule.startTime) return '';

    // Sorry. Lazyness got me. :(
    // Returns time in HH:MM format
    return new Date(schedule.startTime)
      .toTimeString()
      .split(' GMT')[0]
      .slice(0, 5);
  })();

  if (!dutyRosterObject[activityId]) dutyRosterObject[activityId] = {};

  dutyRosterObject[activityId].status = status;
  dutyRosterObject[activityId].dutyType = dutyType;
  dutyRosterObject[activityId].description = description;
  dutyRosterObject[activityId].reportingTime = reportingTime;
  dutyRosterObject[activityId].reportingLocation = venue.address;
  dutyRosterObject[activityId].reportingTimeStart =
    new Date(schedule.startTime).getTime();
  dutyRosterObject[activityId].reportingTimeEnd =
    new Date(schedule.endTime).getTime();

  if (action === httpsActions.create) {
    const createdBy = (() => addendumDoc.get('user'))();
    const createdOn = (() => timestamp.toDateString())();

    dutyRosterObject[activityId].createdBy = createdBy;
    dutyRosterObject[activityId].createdOn = createdOn;
  }

  const place = '';
  const when = (() => timestamp.toDateString())();

  if (action === httpsActions.changeStatus) {
    dutyRosterObject[activityId].when = when;
    dutyRosterObject[activityId].user = user;
    dutyRosterObject[activityId].place = place;
  }

  console.log({ dutyRosterObject });

  return dutyRosterObject;
};

const getRef = (snapShot) => {
  if (snapShot.empty) return rootCollections.inits.doc();

  return snapShot.docs[0].ref;
};


const handleDutyRosterReport = (addendumDoc, batch) => {
  if (addendumDoc.get('template') !== 'duty roster') {
    return batch;
  }

  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', 'duty roster')
        .where('office', '==', office)
        .where('month', '==', new Date().getMonth())
        .limit(1)
        .get(),
      rootCollections
        .activities
        .doc(addendumDoc.get('activityId'))
        .collection('Assignees')
        .get(),
    ])
    .then((result) => {
      const [
        dutyRosterInitDocsQuery,
        assigneesSnapshot,
      ] = result;

      const ref = getRef(dutyRosterInitDocsQuery);

      const dutyRosterObject
        = getDutyRosterObject(addendumDoc, dutyRosterInitDocsQuery);

      dutyRosterObject.assignees = assigneesSnapshot.docs.map((doc) => doc.id);

      batch.set(ref, {
        office,
        officeId,
        dutyRosterObject,
        report: 'duty roster',
        month: new Date().getMonth(),
      }, {
          merge: true,
        });

      return batch;
    })
    .catch(console.error);
};

const handleDsrReport = (addendumDoc, batch) => {
  if (addendumDoc.get('template') !== 'dsr') {
    return handleDutyRosterReport(addendumDoc, batch);
  }

  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');
  const timestamp = new Date(addendumDoc.get('timestamp'));
  const schedulesArray = addendumDoc.get('activityData.schedule');

  const promises = [];

  schedulesArray.forEach((scheduleObject) => {
    const {
      startTime,
    } = scheduleObject;

    const dateString = startTime ? new Date(startTime).toDateString() : '';

    const promise = rootCollections
      .inits
      .where('report', '==', 'dsr')
      .where('office', '==', office)
      .where('dateString', '==', dateString)
      .limit(1)
      .get();

    promises.push(promise);
  });

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        const ref = getRef(snapShot);
        const filters = snapShot._query._fieldFilters;
        /** The dateString should be the same in this doc as
         * of the schedule.startTime for which the query was executed.
         */
        const dateString = filters[2]._value;

        const initDocData = (() => {
          if (snapShot.empty) {
            return {
              office,
              officeId,
              dateString,
              report: 'dsr',
              month: timestamp.getMonth(),
              year: timestamp.getFullYear(),
              visitsObject: {},
              followUpsObject: {},
              closureObject: {},
            };
          }

          return snapShot.docs[0].data();
        })();

        if (index === 0) {
          initDocData.visitsObject = getVisitsObject(addendumDoc, snapShot);
        }

        if (index === 1) {
          initDocData.followUpsObject
            = getFollowUpsObject(addendumDoc, snapShot);
        }

        if (index === 2) {
          initDocData.closureObject = getClosureObject(addendumDoc, snapShot);
        }

        // FIXME: This `ref` is undefined sometimes.
        batch.set(ref,
          initDocData, {
            merge: true,
          });
      });

      return handleDutyRosterReport(addendumDoc, batch);
    })
    .catch(console.error);
};


const handlePayrollReport = (addendumDoc, batch) => {
  const template = addendumDoc.get('activityData.template');

  if (!new Set()
    .add('leave')
    .add('check-in')
    .add('tour plan')
    .has(template)) {
    return handleDsrReport(addendumDoc, batch);
  }

  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');
  const timestamp = new Date(addendumDoc.get('timestamp'));

  return rootCollections
    .inits
    .where('office', '==', office)
    .where('report', '==', 'payroll')
    .where('month', '==', timestamp.getMonth())
    .where('year', '==', timestamp.getFullYear())
    .limit(1)
    .get()
    .then((payrollInitDocQuery) => {
      const ref = getRef(payrollInitDocQuery);

      batch.set(ref, {
        office,
        officeId,
        date: timestamp.getDate(),
        month: timestamp.getMonth(),
        year: timestamp.getFullYear(),
        dateString: timestamp.toDateString(),
        payrollObject: getPayrollObject(addendumDoc, payrollInitDocQuery),
      }, {
          merge: true,
        });

      return handleDsrReport(addendumDoc, batch);
    })
    .catch(console.error);
};


module.exports = (addendumDoc) => {
  const phoneNumber = addendumDoc.get('user');
  const officeId = addendumDoc.get('activityData.officeId');
  const timestamp = new Date(addendumDoc.get('timestamp'));
  const date = timestamp.getDate();
  const month = timestamp.getMonth();
  const year = timestamp.getFullYear();
  const batch = db.batch();

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .where('user', '==', phoneNumber)
    .where('dateString', '==', new Date().toDateString())
    .orderBy('timestamp', 'desc')
    .limit(2)
    .get()
    .then((docs) => {
      const previousAddendumDoc = docs.docs[1];

      const distance = (() => {
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
          = Number(previousAddendumDoc.get('accumulatedDistance') || 0);

        return {
          accumulated: accumulatedDistance + distanceTravelled,
          travelled: distanceTravelled,
        };
      })();

      /**
       * Distance travelled 0 means that user is in the same location.
       * Not hitting Google Maps api since that is wasteful.
       */
      if (Math.floor(Math.round(distance.travelled)) === 0) {
        return [null, null];
      }

      return Promise
        .all([
          googleMapsClient
            .reverseGeocode({
              latlng: getLatLngString(addendumDoc.get('location')),
            })
            .asPromise(),
          Promise
            .resolve(distance),
        ]);
    })
    .then((result) => {
      const [
        mapsApiResult,
        distance,
      ] = result;

      const placeInformation = getPlaceInformation(mapsApiResult);

      console.log('distance accumulated', distance ? distance.accumulated : distance);

      const url = (() => {
        if (!addendumDoc.exists) return '';

        if (!result) return addendumDoc.get('url');

        return placeInformation.url;
      })();

      const identifier = (() => {
        if (!addendumDoc.exists) return '';

        if (!result) return addendumDoc.get('identifier');

        return placeInformation.identifier;
      })();

      const updateObject = {
        date,
        month,
        year,
        url,
        identifier,
        accumulatedDistance: distance.accumulated.toFixed(2),
        distanceTravelled: distance.travelled,
        timeString: getTimeString('+91', timestamp),
        dateString: timestamp.toDateString(),
      };

      batch.set(addendumDoc.ref, updateObject, {
        merge: true,
      });

      return handlePayrollReport(addendumDoc, batch);
    })
    .then((batch) => batch.commit())
    .catch(console.error);
};
