const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../admin/admin');
const {
  sendResponse,
  isNonEmptyString,
  isValidGeopoint,
  isValidDate,
  isValidEmail,
  isE164PhoneNumber,
} = require('../admin/utils');
const momentTz = require('moment-timezone');

const {
  code,
} = require('../admin/responses');
const {
  Creator,
  Attachment,
} = require('../admin/protos');
const {
  httpsActions,
  subcollectionNames,
} = require('../admin/constants');

const validator = req => {
if (req.method !== 'POST') {
  return `${req.method} is not allowed. Use 'POST'`;
  }

  if (!isNonEmptyString(req.body.office)) {
    return `Invalid/missing office`;
  }

  if (!Array.isArray(req.body.phoneNumbers)) {
    return `Expected array of phoneNumber objects in the`
      + ` field 'phoneNumbers' ({phoneNumber, displayName, email})`;
  }

  if(!req.body.phoneNumbers.length) {
    return `Phone number cannot be empty`;
  }

  const filtered = req.body.phoneNumbers.filter(obj => {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    const { phoneNumber, displayName, email } = obj;

    if(!isE164PhoneNumber(phoneNumber)) {
      return false;
    }

    // can be a string of whatever length.
    if (typeof displayName !== 'string') {
      return false;
    }

    // email, if present should be valid
    if (email && !isValidEmail(email)) {
      return false;
    }

    return true;
  });

  if (filtered.length !== req.body.phoneNumbers.length) {
    return `Invalid phone number objects found`;
  }

  if (!isValidGeopoint(req.body.geopoint)) {
    return `Invalid/missing geopoint`;
  }

  if (!isValidDate(req.body.timestamp)) {
    return `Invalid/missing timestamp`;
  }

  return null;
};

const checkIsAdmin = (requester, office) => {
  return requester.customClaims &&
    Array.isArray(requester.customClaims.admin) &&
    requester.customClaims.admin.includes(office);
};

const getSubscriptionConflicts = async (phoneNumbers, officeId) => {
  const promises = phoneNumbers.map(obj => {
    return rootCollections
      .activities
      .where('officeId', '==', officeId)
      .where('template', '==', 'subscription')
      .where('attachment.Template.value', '==', 'check-in')
      .where('attachment.Phone Number.value', '==', obj.phoneNumber)
      .limit(1)
      .get();
  });

  const snapShots = await Promise.all(promises);
  const allSubscriptionActivities = new Map();

  snapShots.forEach(snap => {
    const [subscription] = snap.docs;

    if(!subscription) {
      return;
    }

    const { value } = subscription.get('attachment.Phone Number');

    allSubscriptionActivities.get(value, subscription);
  });

  console.log('allSubscriptionActivities', allSubscriptionActivities.size);

  return allSubscriptionActivities;
};

module.exports = async conn => {
  const v = validator(conn.req);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

    const {
      office,
  } = conn.req.body;

  if (!checkIsAdmin(conn.requester, office)) {
    return sendResponse(conn, code.forbidden, `You cannot perform this action`);
  }

  const [officeDocQuery, templateDocQuery] = await Promise.all([
    rootCollections
      .offices
      .where('office', '==', office)
      .limit(1)
      .get(),
    rootCollections
      .activityTemplates
      .where('name', '==', 'subscription')
      .limit(1)
      .get()
  ]);

  const [officeDoc] = officeDocQuery.docs;
  const [templateDoc] = templateDocQuery.docs;

  if (!officeDoc) {
    return sendResponse(conn, code.conflict, `Office '${conn.req.body.office}' not found`);
  }

  if (officeDoc.get('status') === 'CANCELLED') {
    return sendResponse(conn, code.conflict, `Office is not active`);
  }

  const batch = db.batch();
  const creator = new Creator(
    conn.requester.phoneNumber,
    conn.requester.displayName,
    conn.requester.email,
  ).toObject();
  const timezone = officeDoc.get('attachment.Timezone.value');
  const templateToSubscribe = 'check-in';
  const { date, months: month, years: year } = momentTz().toObject();
  // This is a map
  const allSubscriptionActivities = await getSubscriptionConflicts(
    conn.req.body.phoneNumbers,
    officeDoc.id
  );

  conn.req.body.phoneNumbers.forEach(object => {
    const { phoneNumber, displayName } = object;
    const oldSubscriptionDoc = allSubscriptionActivities.get(phoneNumber);

    if (oldSubscriptionDoc) {
      console.log('already exists', phoneNumber);
      // subscription activity already exists
      batch.set(
        oldSubscriptionDoc.ref, {
          timestamp: Date.now(),
          addendumDocRef: null,
          status: 'CONFIRMED',
      }, {
        merge: true,
      });

      return;
    }

    const activityRef = rootCollections.activities.doc();
    const activityData = {
      creator,
      status:templateDoc.get('statusOnCreate'),
      timezone,
      template: templateDoc.get('name'),
      addendumDocRef: officeDoc.ref.collection(subcollectionNames.ADDENDUM).doc(),
      timestamp: Date.now(),
      createTimestamp: Date.now(),
      office,
      officeId: officeDoc.id,
      attachment: new Attachment({
        'Template': templateToSubscribe,
        'Phone Number': phoneNumber,
      }, templateDoc.get('attachment'))
        .toObject(),
      activityName: `${templateDoc.get('name')} ${displayName || phoneNumber}`.toUpperCase(),
      canEditRule: templateDoc.get('canEditRule'),
      hidden: templateDoc.get('hidden'),
      schedule: templateDoc.get('schedule').map(name => {
        return { name, startTime: '', endTime: '' };
      }),
      venue: templateDoc.get('venue').map(venueDescriptor => {
        return {
          venueDescriptor,
          location: '',
          address: '',
          geopoint:{latitude: '', longitude: ''},
        };
      }),
    };

    batch.set(
      activityRef,
      activityData
    );
    batch.set(
      activityData.addendumDocRef, {
        date,
        month,
        year,
        activityData: Object.assign({}, activityData, {
          addendumDocRef: null,
        }),
        activityId: activityRef.id,
        user: conn.requester.phoneNumber,
        isAdminRequest: true,
        isSupportRequest: false,
        userDisplayName: conn.requester.displayName,
        uid: conn.requester.uid,
        location:getGeopointObject(conn.req.body.geopoint),
        action: httpsActions.create,
        geopointAccuracy: conn.req.body.geopoint.accuracy || null,
        provider: conn.req.body.geopoint.provider || null,
        timestamp: Date.now(),
        userDeviceTimestamp: conn.req.body.timestamp,
    });

    [conn.requester.phoneNumber, phoneNumber]
      .forEach(p => {
      batch.set(
        activityRef
          .collection(subcollectionNames.ASSIGNEES)
          .doc(p), {
          addToInclude: true,
        });
    });
  });

  await batch.commit();

  sendResponse(conn, code.ok, 'Activities created');
};
