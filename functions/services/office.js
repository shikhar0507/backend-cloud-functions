const {
  // Activity,
  Creator,
  Attachment,
} = require('../admin/protos');
const {
  httpsActions,
  // timezonesSet,
  subcollectionNames,
} = require('../admin/constants');
const {
  code
} = require('../admin/responses');
const {
  db,
  getGeopointObject,
  rootCollections,
} = require('../admin/admin');
const {
  isValidDate,
  isValidGeopoint,
  isNonEmptyString,
  handleError,
  isE164PhoneNumber,
  sendResponse,
  latLngToTimezone,
  getBranchName,
  millitaryToHourMinutes,
} = require('../admin/utils');
const momentTz = require('moment-timezone');
const admin = require('firebase-admin');
const env = require('../admin/env');
// const xml2js = require('xml2js');
// const rpn = require('request-promise-native');
const googleMapsClient = require('@google/maps')
  .createClient({
    key: env.mapsApiKey,
    Promise: Promise,
  });

// const getCurrencyFromCountry = async country => {

// };


const validator = body => {
  const {
    placeId,
    name,
    firstContact,
    secondContact,
    registeredOfficeAddress,
    geopoint,
    timestamp,
  } = body;

  if (!isValidDate(timestamp)) {
    return `Invalid/missing timestamp`;
  }

  // The placeId is optional. But, if present, should be a non-empty string
  if (!isNonEmptyString(placeId)) {
    return `Field 'placeId' should be a non-empty string`;
  }

  if (!isNonEmptyString(name)) {
    return `Field 'name' should be a non-empty string`;
  }

  if (!isNonEmptyString(registeredOfficeAddress)) {
    return `Field 'registeredOfficeAddress' should be non-empty string`;
  }

  if (!firstContact ||
    !secondContact ||
    !isE164PhoneNumber(firstContact.phoneNumber) ||
    !isE164PhoneNumber(secondContact.phoneNumber)) {
    return `Both 'firstContact' and 'secondContact' should be valid phone numbers`;
  }

  if (!isValidGeopoint(geopoint, false)) {
    return `Invalid/missing geopoint`;
  }

  return null;
};

const getAddendumRef = officeId => {
  return rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();
};

const getWeekdayStartTime = firstResult => {
  const {
    'opening_hours': openingHours
  } = firstResult;

  if (!openingHours || !openingHours.periods) {
    return '';
  }

  const [openingPeriod] = openingHours.periods.filter(period => {
    return period.open && period.open.day === 1;
  });

  if (!openingPeriod) {
    return '';
  }

  return millitaryToHourMinutes(openingPeriod);
};


const getWeekdayEndTime = firstResult => {
  const {
    'opening_hours': openingHours
  } = firstResult;

  if (!openingHours || !openingHours.periods) {
    return '';
  }

  // firstResult.opening_hours.periods[0].close.day
  const [closingPeriod] = openingHours.periods.filter(period => {
    return period.close && period.close.day === 1;
  });

  if (!closingPeriod) {
    return '';
  }

  return millitaryToHourMinutes(closingPeriod);
};

const getWeeklyOff = placeApiResult => {
  const {
    opening_hours: openingHours,
  } = placeApiResult.json.result;

  if (!openingHours) {
    return '';
  }

  const {
    weekday_text: weekdayText,
  } = openingHours;

  if (!weekdayText) {
    return '';
  }

  const [closingWeekday] = weekdayText.filter(weekday => {
    return weekday.includes('Closed');
  });

  if (!closingWeekday) {
    return '';
  }

  const [weekday, status] = closingWeekday.split(':');

  if (!status) {
    return '';
  }

  return weekday.toLowerCase();
};

const placeIdToBranch = async (placeId, creator) => {
  const [branchTemplate] = (
    await rootCollections
    .activityTemplates
    .where('name', '==', 'branch')
    .limit(1)
    .get()
  ).docs;

  const placeApiResult = await googleMapsClient.place({
    placeid: placeId,
  }).asPromise();

  const placesApiResult = await googleMapsClient.places({
    query: placeApiResult.json.result.formatted_address,
  }).asPromise();

  const [firstResult] = placesApiResult.json.results;
  const attachment = new Attachment({
      'First Contact': creator.phoneNumber,
      'Second Contact': '',
      'Branch Code': '',
      'Weekday Start Time': getWeekdayStartTime(firstResult),
      'Weekday End Time': getWeekdayEndTime(firstResult),
      'Saturday Start Time': '',
      'Saturday End Time': '',
      'Weekly Off': getWeeklyOff(placeApiResult),
      Name: getBranchName(placeApiResult.json.result.address_components),
    },
    branchTemplate.get('attachment')
  );

  const branchActivity = {
    attachment: attachment.toObject(),
    template: branchTemplate.get('name'),
    timestamp: Date.now(),
    createTimestamp: Date.now(),
    placeId,
    creator,
    schedule: branchTemplate.get('schedule').map(name => {
      return {
        name,
        startTime: '',
        endTime: '',
      };
    }),
    venue: [{
      placeId,
      venueDescriptor: branchTemplate.get('venue')[0],
      address: firstResult.formatted_address,
      location: attachment.Name.value,
      geopoint: new admin.firestore.GeoPoint(
        firstResult.geometry.location.lat,
        firstResult.geometry.location.lng
      ),
    }],
  };

  return branchActivity;
};

const createOffice = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use POST`
    );
  }

  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  const {
    name: office,
    firstContact,
    secondContact,
    registeredOfficeAddress,
    placeId,
    geopoint,
  } = conn.req.body;

  const [officeDoc] = (
    await rootCollections
    .activities
    .where('office', '==', office)
    .limit(1)
    .get()
  ).docs;

  if (officeDoc) {
    return sendResponse(
      conn,
      code.conflict,
      `Office with the name '${office}' already exists`
    );
  }

  const {
    phoneNumber,
    displayName,
    photoURL
  } = conn.requester;
  const batch = db.batch();
  const template = 'office';
  const [
    templateSubcriptionQuery,
    checkInSubscriptionQuery,
  ] = await Promise.all([
    rootCollections
      .activityTemplates
      .where('name', '==', template)
      .limit(1)
      .get(),
    rootCollections
      .activities
      .where('template', '==', 'subscription')
      .where('status', '==', 'CONFIRMED')
      .where('attachment.Template.value', '==', 'check-in')
      .where('attachment.Phone Number.value', '==', 'phoneNumber')
      .limit(1)
    .get()
  ]);

  const [templateDoc] = templateSubcriptionQuery.docs;
  const [checkInSubscriptionDoc] = checkInSubscriptionQuery.docs;

  // user already has subscription of check-in
  if (checkInSubscriptionDoc) {
    return sendResponse(
      conn,
      code.conflict,
      'You already have subscription of check-in'
    );
  }

  const activityRef = rootCollections.activities.doc();
  const {
    id: activityId,
  } = activityRef;

  // This api only creates the office activity.
  const officeId = activityId;
  const activityInstance = {
    template,
    placeId: placeId || '',
    timestamp: Date.now(),
    addendumDocRef: getAddendumRef(activityId),
    activityName: `OFFICE: ${office}`,
  };

  const creator = new Creator(phoneNumber, displayName, photoURL).toObject();

  if (!registeredOfficeAddress) {
    return sendResponse(
      conn,
      code.conflict,
      `Invalid registered address: '${registeredOfficeAddress}'`
    );
  }

  const branchActivity = await placeIdToBranch(placeId, creator);
  const timezone = await latLngToTimezone(branchActivity.venue[0].geopoint);

  activityInstance.officeId = officeId;
  activityInstance.canEditRule = templateDoc.get('canEditRule');
  activityInstance.creator = creator;
  activityInstance.activityName = `Office: ${office}`;
  activityInstance.hidden = templateDoc.get('hidden');
  activityInstance.office = office;
  activityInstance.schedule = templateDoc.get('schedule').map(name => {
    return {
      name,
      startTime: '',
      endTime: ''
    };
  });
  activityInstance.status = templateDoc.get('statusOnCreate');
  activityInstance.timezone = timezone;
  activityInstance.venue = templateDoc.get('venue').map(venueDescriptor => {
    return {
      venueDescriptor,
      geopoint: {
        latitude: '',
        longitude: ''
      },
      location: '',
      address: '',
    };
  });

  activityInstance.attachment = new Attachment({
      Name: office,
      'First Contact': firstContact.phoneNumber,
      'Second Contact': secondContact.phoneNumber,
      Timezone: timezone,
      'Registered Office Address': registeredOfficeAddress,
      'Currency': 'INR',
    },
    templateDoc.get('attachment')
  ).toObject();

  const {
    date,
    months: month,
    years: year,
  } = momentTz().toObject();

  const assignees = Array.from(
    new Set([
      firstContact.phoneNumber,
      secondContact.phoneNumber,
      conn.requester.phoneNumber
    ])
  );

  const addendumData = {
    date,
    month,
    year,
    activityData: activityInstance,
    user: conn.requester.phoneNumber,
    userDisplayName: conn.requester.displayName,
    uid: conn.requester.uid,
    /**
     * Numbers from `attachment`, and all other places will always
     * be present in the `allPhoneNumbers` set. Using that instead of
     * the request body `share` to avoid some users being missed
     * in the `comment`.
     */
    share: assignees,
    action: httpsActions.create,
    template: templateDoc.get('name'),
    location: getGeopointObject(geopoint),
    timestamp: Date.now(),
    userDeviceTimestamp: conn.req.body.timestamp,
    /** The `activityId` field is required by `addendumOnCreate` */
    activityId: activityRef.id,
    activityName: activityInstance.activityName,
    isSupportRequest: conn.requester.isSupportRequest,
    geopointAccuracy: conn.req.body.geopoint.accuracy || null,
    provider: conn.req.body.geopoint.provider || null,
  };

  batch.set(
    activityRef,
    activityInstance
  );

  batch.set(
    activityInstance.addendumDocRef,
    addendumData
  );

  assignees.forEach(phoneNumber => {
    batch.set(
      activityRef
      .collection(subcollectionNames.ASSIGNEES)
      .doc(phoneNumber), {
        addToInclude: true,
      });
  });

  const branchActivityRef = rootCollections.activities.doc();
  branchActivity.addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();
  branchActivity.office = office;
  branchActivity.officeId = officeId;
  branchActivity.activityName = `BRANCH: ${branchActivity.attachment.Name.value}`;

  batch.set(
    branchActivityRef,
    branchActivity
  );

  batch.set(
    branchActivity.addendumDocRef, {
      date,
      month,
      year,
      activityId: branchActivityRef.id,
      activityData: branchActivity,
      user: conn.requester.phoneNumber,
      userDisplayName: conn.requester.displayName,
      uid: conn.requester.uid,
      share: assignees,
      action: httpsActions.create,
      template: branchActivity.template,
      location: getGeopointObject(geopoint),
      timestamp: Date.now(),
      userDeviceTimestamp: conn.req.body.timestamp,
      activityName: activityInstance.activityName,
      isSupportRequest: conn.requester.isSupportRequest,
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      provider: conn.req.body.geopoint.provider || null,
    });

  await batch.commit();

  return sendResponse(conn, code.created, 'Office created successfully');
};

module.exports = conn => {
  try {
    return createOffice(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
