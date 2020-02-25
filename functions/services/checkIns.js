/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const { db, rootCollections, getGeopointObject } = require('../admin/admin');
const {
  sendResponse,
  isNonEmptyString,
  isValidGeopoint,
  isValidDate,
  isValidEmail,
  isE164PhoneNumber,
} = require('../admin/utils');
const momentTz = require('moment-timezone');
const { code } = require('../admin/responses');
const { Creator, Attachment } = require('../admin/protos');
const { httpsActions, subcollectionNames } = require('../admin/constants');

const validator = req => {
  if (req.method !== 'POST') {
    return `${req.method} is not allowed. Use 'POST'`;
  }

  if (!isNonEmptyString(req.body.office)) {
    return `Invalid/missing office`;
  }

  if (!Array.isArray(req.body.phoneNumbers)) {
    return (
      `Expected array of phoneNumber objects in the` +
      ` field 'phoneNumbers' ({phoneNumber, displayName, email})`
    );
  }

  if (!req.body.phoneNumbers.length) {
    return `Phone number cannot be empty`;
  }

  const filtered = req.body.phoneNumbers.filter(obj => {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    const { phoneNumber, displayName, email } = obj;

    if (!isE164PhoneNumber(phoneNumber)) {
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

const checkIsAdmin = (requester, office) =>
  requester.customClaims &&
  Array.isArray(requester.customClaims.admin) &&
  requester.customClaims.admin.includes(office);

const getSubscriptionConflicts = async (phoneNumbers, officeId) => {
  const allSubscriptionActivities = new Map();
  const snapShots = await Promise.all(
    phoneNumbers.map(obj =>
      rootCollections.activities
        .where('officeId', '==', officeId)
        .where('template', '==', 'subscription')
        .where('attachment.Template.value', '==', 'check-in')
        .where('attachment.Phone Number.value', '==', obj.phoneNumber)
        .limit(1)
        .get(),
    ),
  );

  snapShots.forEach(({ docs: [subscription] }) => {
    if (!subscription) {
      return;
    }

    const { value } = subscription.get('attachment.Phone Number');

    allSubscriptionActivities.get(value, subscription);
  });

  return allSubscriptionActivities;
};

module.exports = async conn => {
  const v = validator(conn.req);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  const { office } = conn.req.body;

  if (!checkIsAdmin(conn.requester, office)) {
    return sendResponse(conn, code.forbidden, `You cannot perform this action`);
  }

  const [
    {
      docs: [officeDoc],
    },
    {
      docs: [templateDoc],
    },
  ] = await Promise.all([
    rootCollections.offices
      .where('office', '==', office)
      .limit(1)
      .get(),
    rootCollections.activityTemplates
      .where('name', '==', 'subscription')
      .limit(1)
      .get(),
  ]);

  if (!officeDoc) {
    return sendResponse(
      conn,
      code.conflict,
      `Office '${conn.req.body.office}' not found`,
    );
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
    officeDoc.id,
  );

  conn.req.body.phoneNumbers.forEach(({ phoneNumber, displayName }) => {
    const oldSubscriptionDoc = allSubscriptionActivities.get(phoneNumber);

    if (oldSubscriptionDoc) {
      // subscription activity already exists
      batch.set(
        oldSubscriptionDoc.ref,
        {
          timestamp: Date.now(),
          addendumDocRef: null,
          status: 'CONFIRMED',
        },
        { merge: true },
      );

      return;
    }

    const activityRef = rootCollections.activities.doc();
    const activityData = {
      creator,
      timezone,
      office,
      status: templateDoc.get('statusOnCreate'),
      template: templateDoc.get('name'),
      addendumDocRef: officeDoc.ref
        .collection(subcollectionNames.ADDENDUM)
        .doc(),
      timestamp: Date.now(),
      createTimestamp: Date.now(),
      officeId: officeDoc.id,
      attachment: new Attachment(
        {
          Template: templateToSubscribe,
          'Phone Number': phoneNumber,
        },
        templateDoc.get('attachment'),
      ).toObject(),
      activityName: `${templateDoc.get('name')} ${displayName ||
        phoneNumber}`.toUpperCase(),
      canEditRule: templateDoc.get('canEditRule'),
      hidden: templateDoc.get('hidden'),
      schedule: templateDoc.get('schedule').map(name => {
        return { name, startTime: '', endTime: '' };
      }),
      venue: templateDoc.get('venue').map(venueDescriptor => ({
        venueDescriptor,
        location: '',
        address: '',
        geopoint: { latitude: '', longitude: '' },
      })),
    };

    batch.set(activityRef, activityData);
    batch.set(activityData.addendumDocRef, {
      date,
      month,
      year,
      activityData: Object.assign({}, activityData, { addendumDocRef: null }),
      activityId: activityRef.id,
      user: conn.requester.phoneNumber,
      isAdminRequest: true,
      isSupportRequest: false,
      userDisplayName: conn.requester.displayName,
      uid: conn.requester.uid,
      location: getGeopointObject(conn.req.body.geopoint),
      action: httpsActions.create,
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      provider: conn.req.body.geopoint.provider || null,
      timestamp: Date.now(),
      userDeviceTimestamp: conn.req.body.timestamp,
    });

    [conn.requester.phoneNumber, phoneNumber].forEach(p => {
      batch.set(activityRef.collection(subcollectionNames.ASSIGNEES).doc(p), {
        addToInclude: true,
      });
    });
  });

  await batch.commit();

  return sendResponse(conn, code.ok, 'Activities created');
};
