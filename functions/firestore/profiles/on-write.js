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

const { db, rootCollections } = require('../../admin/admin');
const { sendSMS } = require('../../admin/utils');
const {
  reportNames,
  httpsActions,
  subcollectionNames,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const env = require('../../admin/env');

const manageOldCheckins = async change => {
  const batch = db.batch();
  (
    await change.after.ref
      .collection(subcollectionNames.ACTIVITIES)
      .where('template', '==', 'check-in')
      .limit(500)
      .get()
  ).forEach(doc => batch.delete(doc.ref));

  return batch.commit();
};

const manageAddendum = async change => {
  const oldFromValue = change.before.get('lastQueryFrom');
  const newFromValue = change.after.get('lastQueryFrom');

  const batch = db.batch();

  /**
   * If user has reinstalled, clear their updates collection addendums
   */
  if (newFromValue === 0 && oldFromValue !== 0) {
    (
      await rootCollections.updates
        .doc(change.after.get('uid'))
        .collection(subcollectionNames.ADDENDUM)
        .orderBy('timestamp')
        .limit(500)
        .get()
    ).forEach(doc => batch.delete(doc.ref));
  }
  /**
   * Else clear their updates collection from last timestamp (before read request)
   */
  if (newFromValue !== 0 && newFromValue > oldFromValue) {
    (
      await rootCollections.updates
        .doc(change.after.get('uid'))
        .collection(subcollectionNames.ADDENDUM)
        .where('timestamp', '<', oldFromValue)
        .orderBy('timestamp')
        .limit(500)
        .get()
    ).forEach(doc => batch.delete(doc.ref));
  }

  return batch.commit();
};

const getPotentialSameDevices = async ({ phoneNumber, uid, offices }) => {
  const result = {};
  const { latestDeviceId = null } =
    (await rootCollections.updates.doc(uid).get()).data() || {};

  if (!latestDeviceId) {
    return {};
  }

  const rolePromises = [];

  (
    await rootCollections.updates
      .where('deviceIdsArray', 'array-contains', latestDeviceId)
      .get()
  ).forEach(updatesDoc => {
    // check-in template document in subscription has the role
    offices.forEach(office => {
      rolePromises.push(
        rootCollections.profiles
          .doc(updatesDoc.get('phoneNumber'))
          .collection(subcollectionNames.SUBSCRIPTIONS)
          .where('template', '==', 'check-in')
          .where('office', '==', office)
          .limit(1)
          .get(),
      );
    });
  });

  (await Promise.all(rolePromises)).forEach(({ docs: [doc] }) => {
    console.log('rolePromises', doc);

    if (!doc) {
      return;
    }

    const { roleDoc = null, office } = doc.data();

    const phoneNumberInRole =
      roleDoc &&
      roleDoc.attachment &&
      roleDoc.attachment['Phone Number'] &&
      roleDoc.attachment['Phone Number'].value;

    if (!phoneNumberInRole || phoneNumberInRole === phoneNumber) {
      return;
    }

    result[office] = result[office] || [];
    result[office].push(phoneNumberInRole);
  });

  return result;
};

const handleSignUpAndInstall = async options => {
  const batch = db.batch();

  if (!options.hasSignedUp && !options.hasInstalled) {
    return;
  }

  const potentialSameDevices = await getPotentialSameDevices({
    phoneNumber: options.change.after.id,
    offices: options.currentOfficesList,
    uid: options.change.after.get('uid'),
  });

  const { date, months: month, years: year } = momentTz().toObject();
  const {
    docs: [initDoc],
  } = await rootCollections.inits
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('report', '==', reportNames.DAILY_STATUS_REPORT)
    .limit(1)
    .get();
  const initRef = initDoc ? initDoc.ref : rootCollections.inits.doc();
  const data = initDoc ? initDoc.data() : {};
  const { installsToday = 0 } = data;

  batch.set(
    initRef,
    Object.assign({}, data, {
      date,
      month,
      year,
      installsToday: installsToday + 1,
      report: reportNames.DAILY_STATUS_REPORT,
    }),
    { merge: true },
  );

  (
    await Promise.all(
      options.currentOfficesList.map(office =>
        rootCollections.offices
          .where('attachment.Name.value', '==', office)
          .limit(1)
          .get(),
      ),
    )
  ).forEach(({ docs: [doc] }) => {
    const officeName = doc.get('office');
    const data = {
      date,
      month,
      year,
      timestamp: Date.now(),
      user: options.phoneNumber,
      activityData: {
        office: officeName,
        officeId: options.change.after.get('employeeOf')[officeName],
      },
      potentialSameDevices: potentialSameDevices[officeName] || null,
    };

    if (options.hasInstalled) {
      data.action = httpsActions.install;
    }

    if (options.hasSignedUp) {
      data.action = httpsActions.signup;
    }

    batch.set(doc.ref.collection(subcollectionNames.ADDENDUM).doc(), data);
  });

  return batch.commit();
};

const handleCancelledSubscriptions = async change => {
  /**
   * Delete cancelled subscriptions
   */
  const profileSubscriptions = await change.after.ref
    .collection(subcollectionNames.SUBSCRIPTIONS)
    .where('status', '==', 'CANCELLED')
    .get();

  const batch = db.batch();

  profileSubscriptions.forEach(doc => {
    batch.delete(doc.ref);
  });

  return batch.commit();
};

/**
 * Deletes the addendum docs from the `Updates/(uid)/Addendum` when the
 * `lastQueryFrom` changes in the `Profiles` doc of the user.
 *
 * @Path: `Profiles/(phoneNumber)`
 * @Trigger: `onWrite`
 *
 * @param {Object} change Contains snapshot of `old` and `new` doc in `context`.
 * @returns {Promise<Batch>} Firestore `Batch` object.
 */
module.exports = async change => {
  const { before, after } = change;

  /** Only for debugging */
  if (!after.data()) {
    return;
  }

  const profileCreated = Boolean(
    !before.data() && after.data() && after.get('uid'),
  );
  const { id: phoneNumber } = after;
  const office = change.after.get('smsContext.office');
  const oldOfficesList = Object.keys(before.get('employeeOf') || {});
  const currentOfficesList = Object.keys(after.get('employeeOf') || {});
  const [newOffice] = currentOfficesList.filter(
    officeName => !oldOfficesList.includes(officeName),
  );
  const [removedOffice] = oldOfficesList.filter(
    officeName => !currentOfficesList.includes(officeName),
  );

  /**
   * The uid was `undefined` or `null` in the old state, but is available
   * after document `onWrite` event.
   */
  const hasSignedUp = Boolean(!before.get('uid') && after.get('uid'));
  /** This can be `undefined` which will returned as `false`. */
  const hasBeenRemoved = Boolean(removedOffice);
  const hasBeenAdded = Boolean(newOffice);

  /**
   * If the `lastQueryFrom` value is `0`, the user probably has installed
   * the app for the first (or has been installing it multiple) time(s).
   * We log all these events to create an `install` report based on this data
   * for all the offices this person belongs to.
   */
  const hasInstalled = Boolean(
    before.get('lastQueryFrom') &&
      before.get('lastQueryFrom') !== 0 &&
      after.get('lastQueryFrom') === 0,
  );

  const options = {
    change,
    profileCreated,
    phoneNumber,
    newOffice,
    removedOffice,
    currentOfficesList,
    oldOfficesList,
    hasSignedUp,
    hasInstalled,
    hasBeenRemoved,
    hasBeenAdded,
  };

  /**
   * What this code does...
   *
   * If has installed
   *    For each office create installs doc.
   * If has been added (to an office)
   *    For each office (added) created sign up docs with `addedOn` field
   * If uid written
   *    For each office (current) create sign up doc with `signedUpOn` field
   * Delete addendum if new `lastFromQuery` > old `lastFromQuery`.
   */

  const toSendSMS =
    !change.before.data() && change.after.data() && !change.after.get('uid');

  try {
    await handleSignUpAndInstall(options);
    await manageAddendum(change);
    await manageOldCheckins(change);
    await handleCancelledSubscriptions(change);

    if (!toSendSMS || !office) {
      return;
    }

    const smsText =
      `${office.substring(0, 20)} will use` +
      ` Growthfile for attendance and leave.` +
      ` Download now to CHECK-IN ${env.downloadUrl}`;

    return sendSMS(phoneNumber, smsText);
  } catch (error) {
    console.error(error);
  }
};
