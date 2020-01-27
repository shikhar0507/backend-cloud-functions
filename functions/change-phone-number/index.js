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

const { db, rootCollections } = require('../admin/admin');
const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
  getAuth,
} = require('../admin/utils');
const { httpsActions, subcollectionNames } = require('../admin/constants');
const { code } = require('../admin/responses');
const admin = require('firebase-admin');
const momentTz = require('moment-timezone');

const validator = body => {
  if (!body.hasOwnProperty('newPhoneNumber')) {
    return `Missing the field 'newPhoneNumber' from the request body.`;
  }

  if (!isE164PhoneNumber(body.newPhoneNumber)) {
    return `Invalid phone number: '${body.newPhoneNumber}'`;
  }

  return null;
};

const getCreator = creator =>
  typeof creator === 'string'
    ? { phoneNumber: creator, displayName: '', photoURL: '' }
    : creator;

const getUpdatedCreator = ({ creator, newPhoneNumber }) =>
  Object.assign({}, creator, { phoneNumber: newPhoneNumber });

const getUpdatedAttachment = ({ attachment, oldPhoneNumber, newPhoneNumber }) =>
  Object.keys(attachment).reduce((prev, field) => {
    const { value, type } = attachment[field];

    prev[field] = { value, type };

    if (value === oldPhoneNumber) {
      prev[field].value = newPhoneNumber;
    }

    return prev;
  }, {});

const singleActivityUpdateObject = ({
  activity,
  oldPhoneNumber,
  newPhoneNumber,
}) => {
  const { id: activityId } = activity;
  const {
    template,
    attachment,
    creator,
    officeId,
    timezone = 'Asia/Kolkata',
  } = activity.data();
  const { date, months: month, years: year } = momentTz()
    .tz(timezone)
    .toObject();
  const isEmployeeActivityForUser =
    template === 'employee' &&
    attachment['Phone Number'] &&
    attachment['Phone Number'].value === oldPhoneNumber;

  if (template === 'check-in') {
    // null means => delete the activity
    return null;
  }

  const activityUpdate = Object.assign({}, activity.data(), {
    addendumDocRef: null,
    timestamp: Date.now(),
    creator: getUpdatedCreator({
      creator: getCreator(creator),
      newPhoneNumber,
    }),
    attachment: getUpdatedAttachment({
      attachment,
      oldPhoneNumber,
      newPhoneNumber,
    }),
  });

  /**
   * These fields don't need to go to the `Activities/{activityId}` documents
   * So, deleting them. If required, the activityOnWrite instance triggered
   * for the appropriate activity will put the necessary values according
   * to the latest assignee list and stuff.
   */
  delete activityUpdate.customerObject;
  delete activityUpdate.canEdit;
  delete activityUpdate.activityId;
  delete activityUpdate.assignees;

  if (!isEmployeeActivityForUser) {
    return { activityUpdate };
  }

  const addendumDocData = {
    date,
    month,
    year,
    template,
    activityId,
    oldPhoneNumber,
    newPhoneNumber,
    user: newPhoneNumber,
    activityData: activityUpdate,
    timestamp: Date.now(),
    action: httpsActions.update,
    activityOld: activity.data(),
    userDeviceTimestamp: Date.now(),
    isSupportRequest: false,
    isAdminRequest: false,
    geopointAccuracy: null,
    provider: null,
    userDisplayName: '',
    location: null,
  };

  activityUpdate.addendumDocRef = rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  return { activityUpdate, addendumDocData };
};

const migrateUserData = async ({
  prevQuery,
  oldPhoneNumber,
  newPhoneNumber,
  batches,
}) => {
  const batch = db.batch();
  const MAX_ACTIVITIES_AT_ONCE = 100;
  const query =
    prevQuery ||
    rootCollections.profiles
      .doc(oldPhoneNumber)
      .collection(subcollectionNames.ACTIVITIES)
      .orderBy('__name__')
      .limit(MAX_ACTIVITIES_AT_ONCE);

  const { empty, size, docs } = await query.get();

  console.log({ size });

  if (empty) {
    return batches;
  }

  docs.forEach(activity => {
    // do stuff;
    const { id: activityId } = activity;
    const activityRef = rootCollections.activities.doc(activityId);
    const { activityUpdate, addendumDocData } = singleActivityUpdateObject({
      activity,
      newPhoneNumber,
      oldPhoneNumber,
    });

    if (!activityUpdate) {
      batch.delete(activityRef);

      return;
    }

    // unassign old number
    batch.delete(
      activityRef.collection(subcollectionNames.ASSIGNEES).doc(oldPhoneNumber),
    );

    // assign new number
    batch.set(
      activityRef.collection(subcollectionNames.ASSIGNEES).doc(newPhoneNumber),
      {},
    );

    batch.set(activityRef, activityUpdate, { merge: true });

    if (addendumDocData) {
      batch.set(activityUpdate.addendumDocRef, addendumDocData);
    }
  });

  const lastDoc = docs[size - 1];

  batches.push(batch);

  return migrateUserData({
    batches,
    oldPhoneNumber,
    newPhoneNumber,
    prevQuery: query.startAfter(lastDoc),
  });
};

const updateProfile = async ({ newPhoneNumber, oldPhoneNumbersUid: uid }) => {
  const newPhoneNumberUserRecord = await getAuth(newPhoneNumber);
  console.log('newNumberAuthFound', !!newPhoneNumberUserRecord.uid);

  if (uid) {
    await rootCollections.updates
      .doc(uid)
      .set({ phoneNumber: newPhoneNumber }, { merge: true });
  }

  if (newPhoneNumberUserRecord.uid) {
    return;
  }

  return Promise.all([
    admin.auth().updateUser(uid, { phoneNumber: newPhoneNumber }),
    rootCollections.profiles.doc(newPhoneNumber).set({ uid }, { merge: true }),
  ]);
};

module.exports = async conn => {
  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  /**
   * Old phone number is the current phone number of the user.
   */
  const { uid, phoneNumber: oldPhoneNumber } = conn.requester;
  const { newPhoneNumber } = conn.req.body;

  console.log({ uid, oldPhoneNumber, newPhoneNumber });

  try {
    await Promise.all([
      ...(
        await migrateUserData({
          prevQuery: null,
          oldPhoneNumber,
          newPhoneNumber,
          batches: [],
        })
      ).map(batch => batch.commit()),
      updateProfile({
        newPhoneNumber,
        oldPhoneNumber: uid,
      }),
      admin.auth().revokeRefreshTokens(uid),
      // Clearing registrationToken because the new phone number might not receive
      // notifications otherwise from from firebase.
      rootCollections.updates
        .doc(uid)
        .set(
          { registrationToken: admin.firestore.FieldValue.delete() },
          { merge: true },
        ),
    ]);

    return sendResponse(
      conn,
      code.accepted,
      'Phone Number change is in progress.',
    );
  } catch (error) {
    return handleError(conn, error);
  }
};
