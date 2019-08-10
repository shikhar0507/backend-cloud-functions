'use strict';

const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  httpsActions,
  reportNames,
} = require('../../admin/constants');
const {
  haversineDistance,
} = require('../activity/helper');
const {
  adjustedGeopoint,
} = require('../../admin/utils');
const {
  vowels,
} = require('../../admin/constants');
const {
  toMapsUrl,
} = require('../recipients/report-utils');
const momentTz = require('moment-timezone');
const env = require('../../admin/env');
const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: require('../../admin/env').mapsApiKey,
      Promise: Promise,
    });


const initDocRef = (snapShot) => {
  if (snapShot.empty) {
    return rootCollections.inits.doc();
  }

  return snapShot.docs[0].ref;
};

const getLocalityCityState = (components) => {
  let locality = '';
  let city = '';
  let state = '';

  components.forEach((component) => {
    if (component.types.includes('locality')) {
      locality = component.long_name;
    }

    if (component.types.includes('administrative_area_level_2')) {
      city = component.long_name;
    }

    if (component.types.includes('administrative_area_level_1')) {
      state = component.long_name;
    }
  });

  return { locality, city, state };
};

const getLatLngString = (location) =>
  `${location._latitude},${location._longitude}`;

const getLocationUrl = (plusCode) => `https://plus.codes/${plusCode}`;

const getPlaceInformation = (mapsApiResult, geopoint) => {
  const value = toMapsUrl(geopoint);

  if (!mapsApiResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const firstResult = mapsApiResult.json.results[0];

  if (!firstResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const plusCode = mapsApiResult.json['plus_code']['global_code'];

  return {
    identifier: firstResult['formatted_address'],
    url: getLocationUrl(plusCode),
  };
};

const handleDailyStatusReport = (addendumDoc, locals) => {
  if (!env.isProduction) {
    return Promise.resolve();
  }

  const batch = db.batch();

  const getValue = (snap, field) => {
    if (snap.empty) {
      return 0;
    }

    return snap.docs[0].get(field) || 0;
  };

  const office = addendumDoc.get('activityData.office');
  const action = addendumDoc.get('action');
  const isSupportRequest = addendumDoc.get('isSupportRequest');
  const isAdminRequest = addendumDoc.get('isAdminRequest');
  const isAutoGenerated = addendumDoc.get('isAutoGenerated');
  const template = addendumDoc.get('activityData.template');
  const momentToday = momentTz().toObject();

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', momentToday.date)
        .where('month', '==', momentToday.months)
        .where('year', '==', momentToday.years)
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('report', '==', reportNames.COUNTER)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        todayInitQuery,
        counterDocsQuery,
      ] = result;

      const initDoc = initDocRef(todayInitQuery);
      let totalActivities = counterDocsQuery.docs[0].get('totalActivities');
      let totalCreatedWithAdminApi = counterDocsQuery.docs[0].get('totalCreatedWithAdminApi');
      let totalCreatedWithClientApi = counterDocsQuery.docs[0].get('totalCreatedWithClientApi');
      let totalCreatedWithSupport = counterDocsQuery.docs[0].get('totalCreatedWithSupport');
      const supportMap = counterDocsQuery.docs[0].get('supportMap');
      const autoGeneratedMap = counterDocsQuery.docs[0].get('autoGeneratedMap');
      const totalByTemplateMap = counterDocsQuery.docs[0].get('totalByTemplateMap');
      const adminApiMap = counterDocsQuery.docs[0].get('adminApiMap');

      let activitiesAddedToday = getValue(todayInitQuery, 'activitiesAddedToday');
      let withAdminApi = getValue(todayInitQuery, 'withAdminApi');
      let autoGenerated = getValue(todayInitQuery, 'autoGenerated');
      let withSupport = getValue(todayInitQuery, 'withSupport');
      let createApi = getValue(todayInitQuery, 'createApi');
      let updateApi = getValue(todayInitQuery, 'updateApi');
      let changeStatusApi = getValue(todayInitQuery, 'changeStatusApi');
      let shareApi = getValue(todayInitQuery, 'shareApi');
      let commentApi = getValue(todayInitQuery, 'commentApi');

      const createCountByOffice = (() => {
        if (todayInitQuery.empty) {
          return {};
        }

        return todayInitQuery.docs[0].get('createCountByOffice') || {};
      })();

      if (action === httpsActions.create) {
        totalActivities++;
        activitiesAddedToday++;
        createApi++;

        if (!isSupportRequest && !isAdminRequest) {
          totalCreatedWithClientApi++;
        }

        if (totalByTemplateMap[template]) {
          totalByTemplateMap[template]++;
        } else {
          totalByTemplateMap[template] = 1;
        }

        if (createCountByOffice[office]) {
          createCountByOffice[office]++;
        } else {
          createCountByOffice[office] = 1;
        }
      }

      if (action === httpsActions.update) {
        updateApi++;
      }

      if (action === httpsActions.changeStatus) {
        changeStatusApi++;
      }

      if (action === httpsActions.share) {
        shareApi++;
      }

      if (action === httpsActions.comment) {
        commentApi++;
      }

      if (isSupportRequest) {
        withSupport++;
        totalCreatedWithSupport++;

        if (supportMap[template]) {
          supportMap[template]++;
        } else {
          supportMap[template] = 1;
        }
      }

      if (isAutoGenerated) {
        autoGenerated++;

        if (autoGeneratedMap[template]) {
          autoGeneratedMap[template]++;
        } else {
          autoGeneratedMap[template] = 1;
        }
      }

      if (isAdminRequest && !isSupportRequest) {
        // Support requests on admin resource does not count
        // towards this count.
        withAdminApi++;
        totalCreatedWithAdminApi++;

        if (adminApiMap[template]) {
          adminApiMap[template]++;
        } else {
          adminApiMap[template] = 1;
        }
      }

      const dataObject = (() => {
        if (todayInitQuery.empty) return {};

        return todayInitQuery.docs[0].data() || {};
      })();

      dataObject.totalActivities = totalActivities;
      dataObject.activitiesAddedToday = activitiesAddedToday;
      dataObject.withAdminApi = withAdminApi;
      dataObject.autoGenerated = autoGenerated;
      dataObject.withSupport = withSupport;
      dataObject.createApi = createApi;
      dataObject.updateApi = updateApi;
      dataObject.changeStatusApi = changeStatusApi;
      dataObject.shareApi = shareApi;
      dataObject.commentApi = commentApi;
      dataObject.report = reportNames.DAILY_STATUS_REPORT;
      dataObject.date = locals.dateObject.getDate();
      dataObject.month = locals.dateObject.getMonth();
      dataObject.year = locals.dateObject.getFullYear();
      dataObject.createCountByOffice = createCountByOffice;

      if (!dataObject.templateUsageObject) {
        dataObject.templateUsageObject = {};
      }

      if (!dataObject.templateUsageObject[template]) {
        dataObject.templateUsageObject[template] = {};
      }

      if (!dataObject.templateUsageObject[template][action]) {
        dataObject.templateUsageObject[template][action] = 0;
      }

      dataObject.templateUsageObject[template][action] =
        dataObject.templateUsageObject[template][action] + 1;

      batch.set(initDoc, dataObject, { merge: true });

      // Counter always exists because it has been created manually
      // for storing counts of stuff...
      batch.set(counterDocsQuery.docs[0].ref, {
        totalActivities,
        adminApiMap,
        autoGeneratedMap,
        supportMap,
        totalByTemplateMap,
        totalCreatedWithAdminApi,
        totalCreatedWithClientApi,
        totalCreatedWithSupport,
      }, {
          merge: true,
        });

      return batch.commit();
    })
    .catch(console.error);
};

const logLocations = (addendumDoc, locals) => {
  const geopointAccuracy = addendumDoc.get('geopointAccuracy');

  // Only user app sends `geopointAccuracy`;
  if (!geopointAccuracy || geopointAccuracy < 350) {
    return Promise.resolve();
  }

  const message = 'lowGeopointAccuracy';
  const isPoor = geopointAccuracy > 350 && geopointAccuracy < 1200;
  const isBad = geopointAccuracy > 1200;
  const date = locals.momentWithOffset.date();
  const month = locals.momentWithOffset.month();
  const year = locals.momentWithOffset.year();

  return rootCollections
    .errors
    .where('message', '==', message)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((docs) => {
      const ref = (() => {
        if (docs.empty) {
          return rootCollections.errors.doc();
        }

        return docs.docs[0].ref;
      })();

      const accuracyType = (() => {
        if (isPoor) {
          return 'poor';
        }

        return 'bad';
      })();

      const docRefsArray = (() => {
        if (docs.empty) {
          return [];
        }

        return docs.docs[0].get('docRefsArray') || [];
      })();

      docRefsArray.push(addendumDoc.ref.path);

      return ref
        .set({
          message,
          date,
          month,
          isPoor,
          isBad,
          year,
          accuracyType,
          docRefsArray,
          // No need in the report because these are simply
          // paths to the docs.
          skipFromErrorReport: true,
          timestamp: Date.now(),
        }, {
            merge: true,
          });
    })
    .catch(console.error);
};

const getAccuracyTolerance = accuracy => {
  if (accuracy && accuracy < 350) {
    return 500;
  }

  return 1000;
};

const checkDistanceAccurate = (addendumDoc, activityDoc) => {
  /** User's current location */
  const geopointOne = {
    _latitude: addendumDoc.get('location')._latitude,
    _longitude: addendumDoc.get('location')._longitude,
    accuracy: addendumDoc.get('geopointAccuracy'),
  };
  const venue = addendumDoc.get('activityData.venue')[0];
  const distanceTolerance = getAccuracyTolerance(geopointOne.accuracy);

  if (venue && venue.location) {
    /** Location that the user selected */
    const geopointTwo = {
      _latitude: venue.geopoint._latitude,
      _longitude: venue.geopoint._longitude,
    };

    const distanceBetween = haversineDistance(geopointOne, geopointTwo);

    return distanceBetween < distanceTolerance;
  }

  // Activity created from an unknown location
  if (!activityDoc) {
    return false;
  }

  const venueFromActivity = activityDoc.get('venue')[0];
  const geopointTwo = {
    _latitude: venueFromActivity.geopoint._latitude,
    _longitude: venueFromActivity.geopoint._longitude,
  };

  const distanceBetween = haversineDistance(geopointOne, geopointTwo);

  return distanceBetween < distanceTolerance;
};

const getUpdatedScheduleNames = (newSchedule, oldSchedule) => {
  const updatedFields = [];

  oldSchedule.forEach((item, index) => {
    const name = item.name;
    /** Request body ===> Update API request body. */
    const newStartTime = newSchedule[index].startTime;
    const newEndTime = newSchedule[index].endTime;
    const oldStartTime = item.startTime;
    const oldEndTime = item.endTime;

    if (newEndTime === oldEndTime && newStartTime === oldStartTime) {
      return;
    }

    updatedFields.push(name);
  });

  return updatedFields;
};

const getUpdatedVenueDescriptors = (newVenue, oldVenue) => {
  const updatedFields = [];

  oldVenue.forEach((venue, index) => {
    const venueDescriptor = venue.venueDescriptor;
    const oldLocation = venue.location;
    const oldAddress = venue.address;
    const oldGeopoint = venue.geopoint;
    const oldLongitude = oldGeopoint._longitude;
    const oldLatitude = oldGeopoint._latitude;
    const newLocation = newVenue[index].location;
    const newAddress = newVenue[index].address;
    const newGeopoint = newVenue[index].geopoint;
    const newLatitude = newGeopoint.latitude;
    const newLongitude = newGeopoint.longitude;

    if (oldLocation === newLocation
      && oldAddress === newAddress
      && oldLatitude === newLatitude
      && oldLongitude === newLongitude) return;

    updatedFields.push(venueDescriptor);
  });

  return updatedFields;
};

const getUpdatedAttachmentFieldNames = (newAttachment, oldAttachment) => {
  const updatedFields = [];

  Object
    .keys(newAttachment)
    .forEach((field) => {
      /** Comparing the `base64` photo string is expensive. Not doing it. */
      if (newAttachment[field].type === 'photo') return;

      const oldFieldValue = oldAttachment[field].value;
      const newFieldValue = newAttachment[field].value;
      const isUpdated = oldFieldValue !== newFieldValue;

      if (!isUpdated) return;

      updatedFields.push(field);
    });

  return updatedFields;
};

const getUpdatedFieldNames = (options) => {
  const {
    before: activityOld,
    after: activityNew,
  } = options;
  const oldSchedule = activityOld.schedule;
  const oldVenue = activityOld.venue;
  const oldAttachment = activityOld.attachment;
  const newSchedule = activityNew.get('schedule');
  const newVenue = activityNew.get('venue');
  const newAttachment = activityNew.get('attachment');

  const allFields = [
    ...getUpdatedScheduleNames(newSchedule, oldSchedule),
    ...getUpdatedVenueDescriptors(newVenue, oldVenue),
    ...getUpdatedAttachmentFieldNames(newAttachment, oldAttachment),
  ];

  let commentString = '';

  if (allFields.length === 1) return commentString += `${allFields[0]}`;

  allFields
    .forEach((field, index) => {
      if (index === allFields.length - 1) {
        commentString += `& ${field}`;

        return;
      }

      commentString += `${field}, `;
    });

  return commentString;
};

const getPronoun = (locals, recipient) => {
  const addendumCreator = locals.addendumDoc.get('user');
  const assigneesMap = locals.assigneesMap;
  /**
   * People are denoted with their phone numbers unless
   * the person creating the addendum is the same as the one
   * receiving it.
   */
  let pronoun = addendumCreator;

  if (addendumCreator === recipient) {
    pronoun = 'You';
  }

  if (pronoun !== 'You'
    && assigneesMap.get(addendumCreator)
    && assigneesMap.get(addendumCreator).displayName) {
    pronoun = assigneesMap.get(addendumCreator).displayName;
  }

  if (!assigneesMap.get(addendumCreator)
    && !locals.addendumCreatorInAssignees) {
    pronoun = locals.addendumCreator.displayName;
  }

  return pronoun;
};

const getCreateActionComment = (template, pronoun, locationFromVenue) => {
  const templateNameFirstCharacter = template[0];
  const article = vowels.has(templateNameFirstCharacter) ? 'an' : 'a';

  if (template === 'check-in'
    && locationFromVenue) {
    return `${pronoun} checked in from ${locationFromVenue}`;
  }

  return `${pronoun} created ${article} ${template}`;
};

const getChangeStatusComment = (status, activityName, pronoun) => {
  /** `PENDING` isn't grammatically correct with the comment here. */
  if (status === 'PENDING') status = 'reversed';

  return `${pronoun} ${status.toLowerCase()} ${activityName}`;
};

const getCommentString = (locals, recipient) => {
  const action = locals.addendumDoc.get('action');
  const pronoun = getPronoun(locals, recipient);
  const creator = locals.addendumDoc.get('user');
  const activityName = locals.addendumDoc.get('activityName');
  const template = locals.addendumDoc.get('activityData.template');

  if (action === httpsActions.create) {
    if (locals.addendumDoc.get('activityData.template') === 'duty roster') {
      if (recipient === creator) {
        return getCreateActionComment(template, pronoun);
      }

      const creatorName = (() => {
        if (locals.assigneesMap.get('creator')
          && locals.assigneesMap.get('creator').displayName) {
          return locals.assigneesMap.get('creator').displayName;
        }

        return creator;
      })();

      return `${creatorName} assigned you a duty "${activityName}"`;
    }

    const locationFromVenue = (() => {
      if (template !== 'check-in') return null;

      if (locals.addendumDocData.activityData
        && locals.addendumDocData.activityData.venue
        && locals.addendumDocData.activityData.venue[0]
        && locals.addendumDocData.activityData.venue[0].location) {
        return locals.addendumDocData.activityData.venue[0].location;
      }

      if (locals.addendumDocData.venueQuery) {
        return locals.addendumDocData.venueQuery.location;
      }

      return locals.addendumDocData.identifier;
    })();

    return getCreateActionComment(template, pronoun, locationFromVenue);
  }

  if (action === httpsActions.changeStatus) {
    const status = locals.addendumDoc.get('status');

    return getChangeStatusComment(status, activityName, pronoun);
  }

  if (action === httpsActions.share) {
    const share = locals.addendumDoc.get('share');
    let str = `${pronoun} added`;

    if (share.length === 1) {
      let name = locals.assigneesMap.get(share[0]).displayName || share[0];

      if (share[0] === recipient) {
        name = 'you';
      }

      return str += ` ${name}`;
    }

    /** The `share` array will never have the `user` themselves */
    share.forEach((phoneNumber, index) => {
      let name = locals
        .assigneesMap.get(phoneNumber).displayName || phoneNumber;
      if (phoneNumber === recipient) {
        name = 'you';
      }

      if (share.length - 1 === index) {
        str += ` & ${name}`;

        return;
      }

      str += ` ${name}, `;
    });

    return str;
  }

  if (action === httpsActions.update) {
    const options = {
      before: locals.addendumDoc.get('activityOld'),
      after: locals.activityNew,
    };

    return `${pronoun} updated ${getUpdatedFieldNames(options)}`;
  }

  if (action === httpsActions.updatePhoneNumber) {
    const doc = locals.addendumDoc;

    return `Phone number`
      + ` '${doc.get('oldPhoneNumber')} was`
      + ` changed to ${doc.get('newPhoneNumber')}`;
  }

  /** Action is `comment` */
  return locals.addendumDoc.get('comment');
};

const getAuth = phoneNumber => {
  return require('firebase-admin')
    .auth()
    .getUserByPhoneNumber(phoneNumber)
    .catch(error => {
      if (error.code === 'auth/user-not-found') {
        return {};
      }

      console.error(error);
    });
};

const createComments = async (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.hidden') === 1) {
    return Promise.resolve();
  }

  // Fetch activity assignees
  const activityId = addendumDoc.get('activityId');
  locals.addendumDoc = addendumDoc;
  locals.assigneesMap = new Map();
  const newPhoneNumbers = [];

  try {
    const [assignees, activityNew] = await Promise
      .all([
        rootCollections
          .activities
          .doc(activityId)
          .collection('Assignees')
          .get(),
        rootCollections
          .activities
          .doc(activityId)
          .get(),
      ]);

    locals.activityNew = activityNew;

    const batch = db.batch();
    const assigneeAuthPromises = [];

    assignees.forEach(assignee => {
      const phoneNumber = assignee.id;
      const authFetch = getAuth(phoneNumber);

      assigneeAuthPromises.push(authFetch);
    });

    assigneeAuthPromises
      .push(getAuth(locals.addendumDoc.get('user')));

    const assigneeAuthResults = await Promise.all(assigneeAuthPromises);

    assigneeAuthResults.forEach(userRecord => {
      if (!userRecord.uid) return;

      locals
        .assigneesMap
        .set(userRecord.phoneNumber, userRecord);

      if (userRecord.phoneNumber === locals.addendumDoc.get('user')) {
        locals
          .addendumCreatorInAssignees = true;
      }
    });

    assignees.forEach(assignee => {
      const phoneNumber = assignee.id;
      const auth = locals.assigneesMap.get(phoneNumber);

      if (!auth) {
        newPhoneNumbers.push(phoneNumber);

        return;
      }

      const ref = rootCollections
        .updates
        .doc(auth.uid)
        .collection('Addendum')
        .doc(addendumDoc.id);

      const comment = addendumDoc.get('cancellationMessage')
        || getCommentString(locals, phoneNumber);
      /**
       * Checks if the action was a comment.
       * @param {string} action Can be one of the activity actions from HTTPS functions.
       * @returns {number} 0 || 1 depending on whether the action was a comment or anything else.
       */
      const isComment = action => {
        // Making this a closure since this function is not going to be used anywhere else.
        if (action === httpsActions.comment) return 1;

        return 0;
      };

      batch.set(ref, {
        comment,
        activityId,
        isComment: isComment(locals.addendumDoc.get('action')),
        timestamp: addendumDoc.get('userDeviceTimestamp'),
        location: addendumDoc.get('location'),
        user: addendumDoc.get('user'),
      });
    });

    return batch.commit();
  } catch (error) {
    console.error(error);
  }
};


module.exports = addendumDoc => {
  const action = addendumDoc.get('action');
  const phoneNumber = addendumDoc.get('user');
  const officeId = addendumDoc.get('activityData.officeId');
  const timezone = addendumDoc.get('activityData.timezone') || 'Asia/Kolkata';
  const locals = {
    dateObject: new Date(),
    momentWithOffset: momentTz().tz(timezone),
  };

  let previousGeopoint;
  let currentGeopoint;
  let activityDoc;

  const isSkippableEvent = action === httpsActions.install
    || action === httpsActions.signup
    || action === httpsActions.branchView
    || action === httpsActions.productView
    || action === httpsActions.videoPlay
    || action === httpsActions.updatePhoneNumber;

  if (isSkippableEvent) {
    return addendumDoc
      .ref
      .set({
        date: locals.momentWithOffset.date(),
        month: locals.momentWithOffset.month(),
        year: locals.momentWithOffset.year(),
      }, {
          merge: true,
        });
  }

  const geopoint = addendumDoc.get('location');
  const gp = adjustedGeopoint(geopoint);
  const batch = db.batch();

  return Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .where('user', '==', phoneNumber)
        .orderBy('timestamp', 'desc')
        .limit(2)
        .get(),
      rootCollections
        .activities
        // Branch, and customer
        .where('office', '==', addendumDoc.get('activityData.office'))
        .where('status', '==', 'CONFIRMED')
        .where('adjustedGeopoints', '==', `${gp.latitude},${gp.longitude}`)
        .limit(1)
        .get()
    ])
    .then(result => {
      const [addendumQuery, activityQuery] = result;
      activityDoc = activityQuery.docs[0];

      locals
        .previousAddendumDoc = (() => {
          if (addendumQuery.docs[0]
            && addendumQuery.docs[0].id !== addendumDoc.id) {
            return addendumQuery.docs[0];
          }

          return addendumQuery.docs[1];
        })();

      currentGeopoint = addendumDoc.get('location');

      const promises = [
        googleMapsClient
          .reverseGeocode({
            latlng: getLatLngString(currentGeopoint),
          })
          .asPromise(),
      ];

      if (locals.previousAddendumDoc) {
        /** Could be undefined for install or signup events in the previous addendum */
        previousGeopoint = locals.previousAddendumDoc.get('location');

        if (!previousGeopoint) {
          previousGeopoint = currentGeopoint;
        }

        promises
          .push(googleMapsClient
            .distanceMatrix({
              /**
               * Ordering is important here. The `legal` distance
               * between A to B might not be the same as the legal
               * distance between B to A. So, do not mix the ordering.
               */
              origins: getLatLngString(previousGeopoint),
              destinations: getLatLngString(currentGeopoint),
              units: 'metric',
            })
            .asPromise());
      }

      return Promise.all(promises);
    })
    .then(result => {
      const [
        mapsApiResult,
        distanceMatrixApiResult,
      ] = result;

      locals
        .placeInformation = getPlaceInformation(
          mapsApiResult,
          currentGeopoint
        );

      if (mapsApiResult.json.results.length > 0) {
        const components = mapsApiResult.json.results[0].address_components;
        const { city, state, locality } = getLocalityCityState(components);

        locals.city = city;
        locals.state = state;
        locals.locality = locality;
      }

      const distanceData = (() => {
        if (!locals.previousAddendumDoc) {
          return {
            accumulatedDistance: 0,
            distanceTravelled: 0,
          };
        }

        const value = (() => {
          const distanceData = distanceMatrixApiResult
            .json
            .rows[0]
            .elements[0]
            .distance;

          // maps api result in meters
          if (distanceData) {
            return distanceData.value / 1000;
          }

          const result = haversineDistance(previousGeopoint, currentGeopoint);

          // in KM
          return result;
        })();

        const accumulatedDistance = Number(
          locals.previousAddendumDoc.get('accumulatedDistance') || 0
        )
          // value is in meters
          + value;

        return {
          accumulatedDistance: accumulatedDistance.toFixed(2),
          distanceTravelled: value,
        };
      })();

      const updateObject = {
        city: locals.city,
        state: locals.state,
        locality: locals.locality,
        url: locals.placeInformation.url,
        identifier: locals.placeInformation.identifier,
        distanceTravelled: distanceData.distanceTravelled,
        date: locals.momentWithOffset.date(),
        month: locals.momentWithOffset.month(),
        year: locals.momentWithOffset.year(),
        adjustedGeopoint: adjustedGeopoint(addendumDoc.get('location')),
        distanceAccurate: checkDistanceAccurate(
          addendumDoc,
          activityDoc
        ),
      };

      if (activityDoc
        && activityDoc.get('venue')[0]
        && activityDoc.get('venue')[0].location) {
        updateObject
          .venueQuery = activityDoc.get('venue')[0];

        if (addendumDoc.get('activityData.venue')
          && addendumDoc.get('activityData.venue')[0]
          && addendumDoc.get('activityData.venue')[0].location === '') {
          const phoneNumber = addendumDoc.get('user');
          const ref = rootCollections.profiles.doc(phoneNumber);

          batch
            .set(ref, {
              lastLocationMapUpdateTimestamp: Date.now(),
            }, {
                merge: true,
              });
        }
      }

      locals
        .addendumDocData = Object.assign({}, addendumDoc.data(), updateObject);

      console.log(JSON.stringify({
        phoneNumber,
        updateObject,
        currPath: addendumDoc
          .ref
          .path,
        prevPath: locals
          .previousAddendumDoc ? locals
            .previousAddendumDoc
            .ref
            .path : null,
      }, ' ', 2));

      /**
       * Seperating this part out because handling even a single crash
       * with `addendumOnCreate` cloud function messes up whole data for the user
       * after the time of the crash.
       */
      batch.set(addendumDoc.ref, updateObject, {
        merge: true,
      });

      return batch.commit();
    })
    .then(() => createComments(addendumDoc, locals))
    .then(() => handleDailyStatusReport(addendumDoc, locals))
    .then(() => logLocations(addendumDoc, locals))
    .catch(error => {
      const context = {
        error,
        docPath: addendumDoc.ref.path,
      };

      console.error('Context:', context);

      return Promise.resolve();
    });
};
