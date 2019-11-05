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


const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  sendSMS,
} = require('../../admin/utils');
const {
  reportNames,
  httpsActions,
  addendumTypes,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const env = require('../../admin/env');


const manageOldCheckins = async change => {
  const oldFromValue = change.before.get('lastQueryFrom');
  const newFromValue = change.after.get('lastQueryFrom');

  /**
   * Both old and the new values should be available
   * None should be 0.
   * The newer value should be greater than the older
   * value.
   */
  if (!oldFromValue
    || !newFromValue
    || newFromValue <= oldFromValue) {
    return;
  }

  const batch = db.batch();
  const docs = await change
    .after
    .ref
    .collection('Activities')
    .where('template', '==', 'check-in')
    .where('timestamp', '<', oldFromValue)
    .limit(500)
    .get();

  docs
    .forEach(doc => batch.delete(doc.ref));

  return batch
    .commit();
};



const manageAddendum = async change => {
  const oldFromValue = change.before.get('lastQueryFrom');
  const newFromValue = change.after.get('lastQueryFrom');
  /**
   * Both old and the new values should be available
   * None should be 0.
   * The newer value should be greater than the older
   * value.
   */
  if (!oldFromValue
    || !newFromValue
    || (newFromValue <= oldFromValue)) {
    return Promise.resolve();
  }

  const docs = await rootCollections
    .updates
    .doc(change.after.get('uid'))
    .collection('Addendum')
    .where('timestamp', '<', oldFromValue)
    .orderBy('timestamp')
    .limit(500)
    .get();

  const batch = db.batch();
  const momentHundredDaysAgo = momentTz()
    .subtract(100, 'days')
    .startOf('day');

  docs
    .forEach(doc => {
      const {
        timestamp,
        _type,
      } = doc.data();
      const momentNow = momentTz(timestamp);
      const isHundredDaysOld = momentNow
        .isBefore(momentHundredDaysAgo);

      /**
       * `Attendance`, `Payments` and `Reimbursements`
       * are stored for 100 days.
       */
      const isSkippable = _type === addendumTypes.REIMBURSEMENT
        || _type === addendumTypes.ATTENDANCE
        || _type === addendumTypes.PAYMENT;

      if (isSkippable) {
        return;
      }

      console.log('deleting', doc.ref.path, _type);

      batch
        .delete(doc.ref);
    });

  return batch
    .commit();
};


const handleSignUpAndInstall = (options) => {
  const promises = [];

  if (!options.hasSignedUp
    && !options.hasInstalled) {
    return Promise.resolve();
  }

  options
    .currentOfficesList
    .forEach(office => {
      const promise = rootCollections
        .offices
        .where('office', '==', office)
        .limit(1)
        .get();

      promises.push(promise);
    });

  const momentToday = momentTz().toObject();

  return rootCollections
    .inits
    .where('report', '==', reportNames.DAILY_STATUS_REPORT)
    .where('date', '==', momentToday.date)
    .where('month', '==', momentToday.months)
    .where('year', '==', momentToday.years)
    .limit(1)
    .get()
    .then(snapShot => {
      const docRef = (() => {
        if (snapShot.empty) {
          return rootCollections.inits.doc();
        }

        return snapShot.docs[0].ref;
      })();

      const installsToday = (() => {
        if (snapShot.empty) {
          return 1;
        }

        /**
         * Doc might be created by some other event, and
         * thus may not have the field `installsToday`.
         */
        return snapShot.docs[0].get('installsToday') || 1;
      })();

      options.batch.set(docRef, {
        installsToday,
        report: reportNames.DAILY_STATUS_REPORT,
        date: momentToday.date,
        month: momentToday.months,
        year: momentToday.years,
      }, {
        merge: true,
      });

      return Promise
        .all(promises);
    })
    .then(snapShots => {
      snapShots.forEach(snapShot => {
        const doc = snapShot.docs[0];
        const officeName = doc.get('office');

        const data = {
          timestamp: Date.now(),
          activityData: {
            officeId: options.change.after.get('employeeOf')[officeName],
            office: officeName,
          },
          user: options.phoneNumber,
        };

        if (options.hasInstalled) {
          data.action = httpsActions.install;
        }

        if (options.hasSignedUp) {
          data.action = httpsActions.signup;
        }

        options
          .batch
          .set(doc
            .ref
            .collection('Addendum')
            .doc(), data);
      });

      return options.batch.commit();
    })
    .catch(console.error);
};

const handleCancelledSubscriptions = async change => {
  const oldFromValue = change.before.get('lastQueryFrom');
  const newFromValue = change.after.get('lastQueryFrom');

  if (!oldFromValue || !newFromValue || newFromValue <= oldFromValue) {
    return Promise.resolve();
  }

  const profileSubscriptions = await change
    .after
    .ref
    .collection('Subscriptions')
    .where('timestamp', '<', oldFromValue)
    .get();

  const batch = db.batch();

  profileSubscriptions
    .forEach(doc => {
      if (doc.get('status') !== 'CANCELLED') {
        return;
      }

      batch
        .delete(doc.ref);
    });

  return batch
    .commit();
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
  const {
    before,
    after,
  } = change;

  /** Only for debugging */
  if (!after.data()) {
    return Promise.resolve();
  }

  const batch = db.batch();
  const profileCreated = Boolean(!before.data() && after.data() && after.get('uid'));
  const phoneNumber = after.id;
  const oldOfficesList = Object.keys(before.get('employeeOf') || {});
  const currentOfficesList = Object.keys(after.get('employeeOf') || {});
  const newOffice = currentOfficesList
    .filter((officeName) => !oldOfficesList.includes(officeName))[0];
  const removedOffice = oldOfficesList
    .filter((officeName) => !currentOfficesList.includes(officeName))[0];
  /**
   * The uid was `undefined` or `null` in the old state, but is available
   * after document `onWrite` event.
   */
  const hasSignedUp = Boolean(!before.get('uid') && after.get('uid'));
  // const authDeleted = Boolean(before.get('uid') && !after.get('uid'));
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
    before.get('lastQueryFrom')
    && before.get('lastQueryFrom') !== 0
    && after.get('lastQueryFrom') === 0
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
    batch,
    today: new Date(),
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

  const toSendSMS = !change.before.data()
    && change.after.data()
    && !change.after.get('uid');

  try {
    await handleSignUpAndInstall(options);
    await manageAddendum(change);
    await manageOldCheckins(change);
    await handleCancelledSubscriptions(change);

    const office = change.after.get('smsContext.office');
    if (!toSendSMS || !office) return;

    const smsText = `${office.substring(0, 20)} will use`
      + ` Growthfile for attendance and leave.`
      + ` Download now to CHECK-IN ${env.downloadUrl}`;

    return sendSMS(phoneNumber, smsText);
  } catch (error) {
    console.error(error);
  }
};
