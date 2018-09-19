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
} = require('../../admin/admin');

const {
  reportingActions,
} = require('../../admin/constants');


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
  if (newFromValue <= oldFromValue) return Promise.resolve();

  const newUid = change.after.get('uid') || '';
  const query = rootCollections
    .updates
    .doc(newUid)
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
  const { before, after, } = change;
  const batch = db.batch();
  const phoneNumber = after.id;
  const oldUid = before.get('uid');
  const newUid = after.get('uid');
  const newFromValue = change.after.get('lastQueryFrom');
  const oldOfficesList = Object.keys(before.get('employeeOf') || {});
  const currentOfficesList = Object.keys(after.get('employeeOf') || {});
  const addedList = currentOfficesList
    .filter((officeName) => oldOfficesList.indexOf(officeName) === -1);
  const removedList = oldOfficesList
    .filter((officeName) => currentOfficesList.indexOf(officeName) === -1);
  /**
   * The uid was undefined or null in the old state, but is available
   * after document update event.
   */
  const hasSignedUp = Boolean(!oldUid && newUid);
  const authDeleted = Boolean(oldUid && !newUid);
  const hasInstalled = newFromValue === 0;

  /**
   * Old and the new uid don't match. Currently no code does this.
   * Logging this event in case this happens.
   */
  const uidChanged = oldUid !== null
    && newUid !== null
    && oldUid !== newUid;

  if (uidChanged) {
    const messageBody = `
    <p>
      phoneNumber: ${phoneNumber},
      <br>
      newUid: ${newUid}
      <br>
      oldUid: ${oldUid}
      <br>
    </p>`;

    batch.set(rootCollections
      .instant
      .doc(), {
        messageBody,
        subject: `${phoneNumber}'s auth has changed`,
        action: reportingActions.authChanged,
      });
  }

  const toUpdate = [];

  currentOfficesList.forEach((officeName) => {
    // Log `install` event for all the current offices.
    if (hasInstalled) {
      batch.set(rootCollections
        .inits
        .doc(), {
          phoneNumber,
          office: officeName,
          officeId: after.get('employeeOf')[officeName],
          installedOn: serverTimestamp,
          event: 'install',
        });
    }

    if (hasSignedUp) {
      toUpdate.push(rootCollections
        .inits
        .where('phoneNumber', '==', phoneNumber)
        .where('office', '==', officeName)
        .where('event', '==', 'added')
        .limit(1)
        .get());
    }

    if (authDeleted) {
      toUpdate.push(rootCollections
        .inits
        .where('phoneNumber', '==', phoneNumber)
        .where('office', '==', officeName)
        .where('signedUpOn', '==', '')
        .limit(1)
        .get());
    }
  });

  addedList.forEach((officeName) => {
    // Log employee added to all newly added offices
    batch.set(rootCollections
      .inits
      .doc(), {
        phoneNumber,
        office: officeName,
        officeId: after.get('employeeOf')[officeName],
        addedOn: serverTimestamp,
        signedUpOn: hasSignedUp ? serverTimestamp : '',
        event: 'added',
      });
  });


  const toDelete = [];

  removedList.forEach((officeName) => {
    toDelete.push(rootCollections
      .inits
      .where('phoneNumber', '==', phoneNumber)
      .where('office', '==', officeName)
      .limit(1)
      .get());
  });

  return Promise
    .all(toUpdate)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];

        batch.set(doc.ref, {
          signedUpOn: serverTimestamp,
        }, {
            merge: true,
          });
      });

      return Promise.all(toDelete);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];

        batch.delete(doc.ref);
      });

      return batch;
    })
    .then((batch) => batch.commit())
    .then(() => console.log({
      // Temporary logging
      oldUid,
      newUid,
      toDelete,
      toUpdate,
      addedList,
      uidChanged,
      hasSignedUp,
      removedList,
      phoneNumber,
      oldOfficesList,
      currentOfficesList,
      writes: batch._writes,
      oldFromValue: change.before.get('lastQueryFrom'),
      newFromValue: change.after.get('lastQueryFrom'),
    }))
    .then(() => manageAddendum(change))
    .catch(console.error);
};
