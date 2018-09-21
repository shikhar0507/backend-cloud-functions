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
  serverTimestamp,
  deleteField,
} = require('../../admin/admin');

const {
  getISO8601Date,
} = require('../../admin/utils');


let count = 0;

const purgeAddendum = (query, resolve, reject) =>
  query
    .get()
    .then((docs) => {
      // When there are no documents left, we are done
      if (docs.size === 0) return 0;

      // Delete documents in a batch
      const batch = db.batch();
      docs.forEach((doc) => batch.delete(doc.ref));

      /* eslint-disable */
      return batch
        .commit()
        .then(() => docs.size);
      /* eslint-enable */
    })
    .then((deleteCount) => {
      /** All docs deleted */
      if (deleteCount === 0) return resolve();

      count++;

      // Recurse on the next process tick, to avoid exploding the stack.
      return process
        .nextTick(() => purgeAddendum(query, resolve, reject));
    })
    .catch(reject);


const manageAddendum = (change) => {
  const oldFromValue = change.before.get('lastQueryFrom');
  const newFromValue = change.after.get('lastQueryFrom');

  if (!newFromValue) return Promise.resolve();
  if (!oldFromValue) return Promise.resolve();
  if (oldFromValue <= newFromValue) return Promise.resolve();

  const query = rootCollections
    .updates
    .doc(change.after.get('uid'))
    .collection('Addendum')
    .where('timestamp', '<', new Date(oldFromValue))
    .orderBy('timestamp')
    .limit(500);

  return new
    Promise(
      (resolve, reject) => purgeAddendum(query, resolve, reject)
    )
    .then(() => console.log(`Iterations: ${count}`))
    .catch(console.error);
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
module.exports = (change) => {
  const {
    before,
    after,
  } = change;

  /** Document was deleted. For debugging only... */
  if (!after.data()) return Promise.resolve();

  const batch = db.batch();
  const phoneNumber = after.id;
  const oldOfficesList = Object.keys(before.get('employeeOf') || {});
  const currentOfficesList = Object.keys(after.get('employeeOf') || {});
  /**
   * List of `offices` where this person has been added as an
   * `employee` at this instance of the cloud function `onWrite`.
   * In most cases, this array will only have a single element because
   * `activity` `onWrite` function only adds a **single** field to this object
   * at a time.
   */
  const addedList = currentOfficesList
    .filter((officeName) => oldOfficesList.indexOf(officeName) === -1);
  const removedList = oldOfficesList
    .filter((officeName) => currentOfficesList.indexOf(officeName) === -1);
  /**
   * The uid was `undefined` or `null` in the old state, but is available
   * after document `onWrite` event.
   */
  const hasSignedUp = Boolean(!before.get('uid') && after.get('uid'));
  const authDeleted = Boolean(before.get('uid') && !after.get('uid'));
  const hasInstalled = after.get('lastQueryFrom') === 0;

  addedList.forEach((office) => {
    const activityData = after.get('employeeOf')[office];
    activityData.addedOn = serverTimestamp;

    batch.set(rootCollections
      .inits
      .doc(activityData.officeId), {
        office,
        report: 'added',
        employeesObject: {
          [phoneNumber]: activityData,
        },
      }, {
        merge: true,
      });
  });

  currentOfficesList.forEach((office) => {
    // Activity with which this person was added as an employee to the office in context.
    const employeeActivity = after.get('employeeOf')[office];

    /**
     * If the `lastQueryFrom` value is `0`, the user probably has installed
     * the app for the first or ( has been installing it multiple) time.
     * We log all these events to create a report based on this data
     * for all the offices this person belongs to.
     */
    if (hasInstalled) {
      employeeActivity.installedOn = serverTimestamp;

      batch.set(rootCollections
        .inits
        .doc(employeeActivity.id), {
          office,
          report: 'install',
          date: getISO8601Date(),
          activityObjects: {
            [employeeActivity.officeId]: employeeActivity,
          },
        }, {
          merge: true,
        });
    }

    if (hasSignedUp) {
      employeeActivity.signedUpOn = serverTimestamp;

      batch.set(rootCollections
        .inits
        .doc(employeeActivity.officeId), {
          office,
          report: 'added',
          employeesObject: {
            [phoneNumber]: employeeActivity,
          },
        }, {
          merge: true,
        });
    }
  });

  removedList.forEach((office) => {
    const activityData = after.get('employeeOf')[office];

    batch.set(rootCollections
      .inits
      .doc(activityData.officeId), {
        employeesObject: {
          [phoneNumber]: deleteField(),
        },
      }, {
        merge: true,
      });

    /** The activity with which this person was added as an employee to this office */
    batch.delete(rootCollections
      .inits
      .doc(activityData.id)
    );
  });

  console.log({
    addedList,
    removedList,
    currentOfficesList,
    hasSignedUp,
    hasInstalled,
    authDeleted,
    phoneNumber,
    batch: batch._writes,
  });

  return batch
    .commit()
    .then(() => manageAddendum(change))
    .catch(console.error);
};
