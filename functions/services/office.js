const {
  // Activity,
  Creator,
  Attachment,
} = require('../admin/protos');
const {
  httpsActions,
  timezonesSet,
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
} = require('../admin/utils');
const momentTz = require('moment-timezone');

const validator = body => {
  const {
    placeId,
    name,
    firstContact,
    secondContact,
    registeredOfficeAddress,
    timezone,
    geopoint,
    timestamp,
  } = body;

  if (!isValidDate(timestamp)) {
    return `Invalid/missing timestamp`;
  }


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

  if (!timezonesSet.has(timezone)) {
    return `Missing or invalid timezone ${timezone}`;
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
    name,
    timezone,
    firstContact,
    secondContact,
    registeredOfficeAddress,
    // placeId,
    geopoint,
  } = conn.req.body;

  const [officeDoc] = (
    await rootCollections
    .activities
    .where('office', '==', name)
    .limit(1)
    .get()
  ).docs;

  if (officeDoc) {
    return sendResponse(
      conn,
      code.conflict,
      `Office with the name '${name}' already exists`
    );
  }

  const [templateDoc] = (
    await rootCollections
    .activityTemplates
    .where('name', '==', 'office')
    .limit(1)
    .get()
  ).docs;

  const batch = db.batch();
  const activityRef = rootCollections.activities.doc();
  const {
    id: activityId,
  } = activityRef;
  const addendumDocRef = getAddendumRef(activityId);
  const activityInstance = {
    template: 'office',
    timestamp: Date.now()
  };
  const {
    phoneNumber,
    displayName,
    photoURL
  } = conn.requester;

  activityInstance.officeId = activityRef.id;
  activityInstance.canEditRule = templateDoc.get('canEditRule');
  activityInstance.creator = new Creator(phoneNumber, displayName, photoURL).toObject();
  activityInstance.activityName = `Office: ${name}`;
  activityInstance.hidden = templateDoc.get('hidden');
  activityInstance.office = name;
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
      Name: name,
      'First Contact': firstContact.phoneNumber,
      'Second Contact': secondContact.phoneNumber,
      Timezone: timezone,
      'Registered Office Address': registeredOfficeAddress,
      'Currency': 'INR',
    },
    templateDoc.get('attachment')
  ).toObject();

  console.log('activityInstance', activityInstance);

  activityInstance.addendumDocRef = addendumDocRef;

  const {
    date,
    months: month,
    years: year,
  } = momentTz().toObject();

  const assignees = Array.from(
    new Set([firstContact.phoneNumber, secondContact.phoneNumber, conn.requester.phoneNumber])
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
    template: conn.req.body.template,
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
    addendumDocRef,
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
