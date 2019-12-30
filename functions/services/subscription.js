const {
  Attachment,
  Creator,
} = require('../admin/protos');
const {
  rootCollections,
  getGeopointObject,
  db,
} = require('../admin/admin');
const {
  httpsActions,
  subcollectionNames,
} = require('../admin/constants');
const {
  isValidEmail,
  isValidDate,
  isNonEmptyString,
  sendResponse,
  isValidGeopoint,
  handleError,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');
const momentTz = require('moment-timezone');

const grantSubscription = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. use 'POST'`
    );
  }

  const {
    phoneNumber,
    displayName,
    photoURL,
    uid,
  } = conn.requester;
  const {
    office,
    geopoint,
    timestamp,
    share,
  } = conn.req.body;

  if (!isValidDate(timestamp)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Invalid/missing 'timestamp'`
    );
  }

  if (!isNonEmptyString(office)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Field 'office' is required`
    );
  }

  if (!isValidGeopoint(geopoint, false)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Invalid/missing geopoint`
    );
  }

  if (!Array.isArray(share)) {
    return sendResponse(
      conn,
      code.badRequest,
      `Field share should be an array of objects ({phoneNumber, displayName, email})`
    );
  }

  const validItems = share.filter(item => {
    const {
      phoneNumber,
      displayName,
      email
    } = item;

    if (!isNonEmptyString(phoneNumber)) {
      return false;
    }

    if (typeof displayName === 'undefined') {
      return false;
    }

    if (email && !isValidEmail(email)) {
      return false;
    }

    return true;
  });

  if (validItems.length !== share.length) {
    return sendResponse(
      conn,
      code.badRequest,
      `Field share should be an array of objects ({phoneNumber, displayName, email})`
    );
  }

  const [
    subcriptionDocQuery,
    officeDocQuery,
    templateDocQuery,
    employeeQuery,
  ] = await Promise.all([
    rootCollections
      .activities
      .where('template', '==', 'subscription')
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .where('attachment.Template.value', '==', 'check-in')
      .get(),
    rootCollections
      .offices
      .where('office', '==', office)
      .limit(1)
      .get(),
    rootCollections
      .activityTemplates
      .where('name', '==', 'subscription')
      .limit(1)
      .get(),
    rootCollections
      .activities
      .where('office', '==', office)
      .where('attachment.Phone Number.value', '==', phoneNumber)
    .get(),
  ]);

  const [officeDoc] = officeDocQuery.docs;
  const [templateDoc] = templateDocQuery.docs;
  // const [subscriptionDoc] = subcriptionDocQuery.docs;

  const checkInSubscriptionsMap = new Map();

  subcriptionDocQuery.forEach(doc => {
    checkInSubscriptionsMap.set(office, doc.id);
  });

  const [roleDoc] = employeeQuery.docs.filter(doc => {
    const {
      template,
      status,
    } = doc.data();

    return template !== 'subscription' &&
      template !== 'admin' &&
      status !== 'CANCELLED';
  });

  if (!officeDoc) {
    return sendResponse(
      conn,
      code.conflict,
      `Office '${office} does not exist'`
    );
  }

  if (officeDoc.get('status') === 'CANCELLED') {
    return sendResponse(
      conn,
      code.conflict,
      `Office: '${office}' is inactive`
    );
  }

  if (checkInSubscriptionsMap.size > 1) {
    // user already has subscription of check-in
    return sendResponse(
      conn,
      code.conflict,
      `You already have check-in subscription`,
    );
  }

  if (checkInSubscriptionsMap.has(office)) {
    const activityId = checkInSubscriptionsMap.get(office);
    const ref = rootCollections.activities.doc(activityId);

    await ref.set({
      timestamp: Date.now(),
      status: 'CONFIRMED',
      addendumDocRef: null,
    }, {
      merge: true
    });

    return sendResponse(
      conn,
      code.created,
      'Check-in subscription created.'
    );
  }

  const oldShare = [
    phoneNumber,
    ...share.map(item => item.phoneNumber)
  ];

  if (roleDoc) {
    const {
      attachment
    } = roleDoc.data();

    Object.keys(attachment).forEach(field => {
      const {
        value,
        type
      } = attachment[field];

      if (type === 'phoneNumber') {
        share.push(value);
      }
    });
  }

  const timezone = officeDoc.get('attachment.Timezone.value');
  const activityRef = rootCollections.activities.doc();
  const addendumDocRef = officeDoc
    .ref
    .collection(subcollectionNames.ADDENDUM)
    .doc();
  const batch = db.batch();
  const momentNow = momentTz().tz(timezone);
  const {
    date,
    months: month,
    years: year,
  } = momentNow.toObject();

  const allAssignees = Array.from(oldShare.filter(Boolean));

  console.log('activityRef', activityRef.id);

  allAssignees.forEach(phoneNumber => {
    batch.set(
      activityRef
      .collection(subcollectionNames.ASSIGNEES)
      .doc(phoneNumber), {
        addToInclude: true,
      });
  });

  const activityData = {
    office,
    timezone,
    addendumDocRef,
    officeId: officeDoc.id,
    timestamp: Date.now(),
    creator: new Creator(
      phoneNumber,
      displayName,
      photoURL
    ).toObject(),
    template: templateDoc.get('name'),
    status: templateDoc.get('statusOnCreate'),
    canEditRule: templateDoc.get('canEditRule'),
    activityName: `Subscription ${displayName || phoneNumber}`,
    hidden: templateDoc.get('hidden'),
    createTimestamp: Date.now(),
    venue: templateDoc.get('venue'),
    schedule: templateDoc.get('schedule'),
    report: templateDoc.get('report') || null,
    isCancelled: false,
    attachment: new Attachment({
        'Phone Number': phoneNumber,
        Template: 'check-in',
      },
      templateDoc.get('attachment')
    ).toObject(),
  };

  batch.set(
    activityRef,
    activityData
  );

  batch.set(
    addendumDocRef, {
      date,
      month,
      year,
      uid,
      activityData,
      user: phoneNumber,
      timestamp: Date.now(),
      userDeviceTimestamp: timestamp,
      userDisplayName: displayName,
      share: allAssignees,
      action: httpsActions.create,
      location: getGeopointObject(geopoint),
      isSupportRequest: false,
      activityId: activityRef.id,
      activityName: activityData.activityName,
      geopointAccuracy: geopoint.accuracy || null,
      provider: geopoint.provider || null,
    });

  console.log(activityData);
  console.log('batch', batch._ops.length);

  await batch.commit();

  return sendResponse(
    conn,
    code.created,
    'Check-in subscription created'
  );
};

module.exports = async conn => {
  try {
    return grantSubscription(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
