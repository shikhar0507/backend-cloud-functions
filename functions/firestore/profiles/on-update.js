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


const manageAddendum = (change, batch) => {
  const oldFromValue = parseInt(change.before.get('lastQueryFrom'));
  const newFromValue = parseInt(change.after.get('lastQueryFrom'));

  if (newFromValue <= oldFromValue) return Promise.resolve();

  const newUid = change.after.get('uid') || '';
  const query = rootCollections
    .updates
    .doc(newUid)
    .collection('Addendum')
    .where('timestamp', '<', oldFromValue)
    .orderBy('timestamp')
    .limit(500);

  return new
    Promise(
      (resolve, reject) => purgeAddendum(query, resolve, reject)
    )
    .then(() => console.log(`Iterations: ${count}`))
    .then(() => batch.commit())
    .catch(console.error);
};

/**
 * Deletes the addendum docs from the `Updates/(uid)/Addendum` when the
 * `lastFromQuery` changes in the `Profiles` doc of the user.
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
  const oldEmployeeOf = before.get('employeeOf');
  const currentEmployeeOf = after.get('employeeOf');
  const oldOfficesList = Object.keys(oldEmployeeOf || {});
  const currentOfficesList = Object.keys(currentEmployeeOf || {});
  const addedList = currentOfficesList
    .filter((item) => oldOfficesList.indexOf(item) === -1);
  const removedList = oldOfficesList
    .filter((item) => currentOfficesList.indexOf(item) === -1);
  /** 
   * The uid was undefined or null in the old state, but is available 
   * after document update event. 
   */
  const hasSignedUp = Boolean(!oldUid && newUid);

  console.log({
    oldUid,
    newUid,
    addedList,
    removedList,
    phoneNumber,
    hasSignedUp,
    oldOfficesList,
    currentOfficesList,
  });

  addedList.forEach((officeName) => {
    // Log employee added to all newly added offices
    batch.set(rootCollections
      .inits
      .doc(), {
        phoneNumber,
        uid: newUid || null,
        office: officeName,
        officeId: currentEmployeeOf[officeName],
        addedOn: serverTimestamp,
        signedUpOn: hasSignedUp ? serverTimestamp : '',
      });
  });

  const newFromValue = change.after.get('lastQueryFrom');
  const toUpdate = [];

  currentOfficesList.forEach((officeName) => {
    // Log `install` event for all the current offices.
    if (newFromValue === '0') {
      batch.set(rootCollections
        .inits
        .doc(), {
          phoneNumber,
          uid: newUid || null,
          office: officeName,
          officeId: currentEmployeeOf[officeName],
          installedOn: serverTimestamp,
        });
    }

    if (hasSignedUp) {
      toUpdate.push(rootCollections
        .inits
        .where('phoneNumber', '==', phoneNumber)
        .where('office', '==', officeName)
        .where('signedUpOn', '==', '')
        .limit(1)
        .get());
    }
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

      return batch;
    })
    .then((batch) => batch.commit())
    .then(() => console.log('writes:', batch._writes))
    .then(() => manageAddendum(change))
    .catch(console.error);
};
