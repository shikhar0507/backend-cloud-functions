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
  deleteField,
} = require('../../admin/admin');


const purgeAddendum = (query, resolve, reject, count) =>
  query
    .get()
    .then((docs) => {
      count++;

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
      if (deleteCount === 0) return resolve(count);

      // Recurse on the next process tick, to avoid exploding the stack.
      return process
        .nextTick(() => purgeAddendum(query, resolve, reject, count));
    })
    .catch(reject);


const manageAddendum = (change, batch) => {
  console.log('In manageAddendum');

  const oldFromValue = change.before.get('lastQueryFrom');
  const newFromValue = change.after.get('lastQueryFrom');
  /**
   * Both old and the new values should be available
   * None should be 0.
   * The newer value should be greater than the older
   * value.
   *
   * If any of the conditions fail, don't delete the docs.
   */
  // if (!oldFromValue) return Promise.resolve();
  // if (!newFromValue) return Promise.resolve();
  // if (newFromValue <= oldFromValue) return Promise.resolve();

  if (!oldFromValue || !newFromValue || newFromValue <= oldFromValue) {
    return batch
      .commit()
      .catch(console.error);
  }

  const query = rootCollections
    .updates
    .doc(change.after.get('uid'))
    .collection('Addendum')
    .where('timestamp', '<', new Date(oldFromValue))
    .orderBy('timestamp')
    .limit(500);

  const count = 0;

  return new
    Promise(
      (resolve, reject) => purgeAddendum(query, resolve, reject, count)
    )
    .then((count) => console.log(`Rounds:`, count))
    .catch(console.error);
};

const getLocaleFromTimestamp = (countryCode, timestamp) => {
  if (timestamp) {
    // This value comes from Firestore.
    timestamp = timestamp.toDate();
  } else {
    timestamp = new Date();
  }

  if (countryCode === '+91') {
    timestamp.setHours(timestamp.getHours() + 5);
    timestamp.setMinutes(timestamp.getMinutes() + 30);
    const offset = new Date(timestamp);

    return `${offset.toDateString()} ${offset.toTimeString()}`.split(' GMT')[0];
  }

  return `${timestamp.toDateString()} ${timestamp.toTimeString()}`;
};

const getEmployeeObject = (options) => {
  const {
    hasSignedUp,
    hasSignedUpBeforeOffice,
  } = options;

  // addedOn --> Time at which user is added to the Office.
  // signedUpOn --> User created auth.
  // But

  const localTime = getLocaleFromTimestamp('+91');

  const object = {
    addedOn: localTime,
    signedUpOn: '',
  };

  if (hasSignedUp) object.signedUpOn = localTime;
  if (hasSignedUpBeforeOffice) object.signedUpOn = localTime;

  return object;
};

const handleAddedToOffice = (change, options) => {
  console.log('In handleAddedToOffice');

  const {
    phoneNumber,
    newOffice,
    hasSignedUp,
    hasBeenAdded,
    batch,
    today,
  } = options;

  if (!hasBeenAdded) return manageAddendum(change, batch);

  return rootCollections
    .inits
    .where('report', '==', 'signup')
    .where('office', '==', newOffice)
    .limit(1)
    .get()
    .then((snapShot) => {
      const ref = (() => {
        if (snapShot.empty) return rootCollections.inits.doc();

        return snapShot.docs[0].ref;
      })();

      const officeId = change.after.get('employeeOf')[newOffice];

      batch.set(ref, {
        officeId,
        office: newOffice,
        dateString: today.toDateString(),
        date: today.getDate(),
        month: today.getMonth(),
        year: today.getFullYear(),
        report: 'signup',
        employeesObject: {
          [phoneNumber]: getEmployeeObject({
            hasSignedUp,
          }),
        },
      }, {
          merge: true,
        });

      console.log('addedToOfficeRef', ref.path);

      return manageAddendum(change, batch);
    })
    .catch(console.error);
};


const handleRemovedFromOffice = (change, options) => {
  console.log('in handleRemovedFromOffice');

  const {
    phoneNumber,
    removedOffice,
    hasBeenRemoved,
    batch,
    today,
  } = options;

  if (!hasBeenRemoved) return handleAddedToOffice(change, options);

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', 'install')
        .where('office', '==', removedOffice)
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('report', '==', 'signup')
        .where('office', '==', removedOffice)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        installDocQuery,
        signUpDocQuery,
      ] = result;

      console.log({
        installDocQuery: installDocQuery.size,
        signUpDocQuery: signUpDocQuery.size,
      });

      if (!installDocQuery.empty) {
        batch.delete(installDocQuery.docs[0].ref);
      }

      if (!signUpDocQuery.empty) {
        batch.set(signUpDocQuery.docs[0].ref, {
          dateString: today.toDateString(),
          date: today.getDate(),
          month: today.getMonth(),
          year: today.getFullYear(),
          employeesObject: {
            [phoneNumber]: deleteField(),
          },
        }, {
            merge: true,
          });
      }

      return handleAddedToOffice(change, options);
    })
    .catch(console.error);
};

const handleInstall = (change, options) => {
  console.log('in handleInstall');

  const {
    phoneNumber,
    currentOfficesList,
    hasInstalled,
    batch,
    today,
  } = options;

  if (!hasInstalled) return handleRemovedFromOffice(change, options);

  const promises = [];

  currentOfficesList.forEach((office) => {
    const promise = rootCollections
      .inits
      .where('report', '==', 'install')
      .where('office', '==', office)
      .limit(1)
      .get();

    promises.push(promise);
  });

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        const ref = (() => {
          if (snapShot.empty) return rootCollections.inits.doc();

          return snapShot.docs[0].ref;
        })();

        const initDocObject = (() => {
          const office = currentOfficesList[index];
          const officeId = change.after.get('employeeOf')[office];

          if (snapShot.empty) {
            return {
              office,
              phoneNumber,
              report: 'install',
              officeId,
              dateString: today.toDateString(),
              date: today.getDate(),
              month: today.getMonth(),
              year: today.getFullYear(),
              installs: [
                getLocaleFromTimestamp('+91'),
              ],
            };
          }

          const {
            installs,
          } = snapShot.docs[0].data();

          installs.push(getLocaleFromTimestamp('+91'));

          return {
            installs,
            dateString: today.toDateString(),
            date: today.getDate(),
            month: today.getMonth(),
            year: today.getFullYear(),
          };
        })();

        console.log('installRef', ref.path, { initDocObject });

        batch.set(ref, initDocObject, { merge: true });
      });

      return handleRemovedFromOffice(change, options);
    })
    .catch(console.error);
};


const handleSignUp = (change, options) => {
  console.log('In handleSignUp');

  const {
    phoneNumber,
    currentOfficesList,
    hasSignedUp,
    newOffice,
    batch,
    today,
  } = options;

  if (!hasSignedUp) return handleInstall(change, options);

  /**
   * If has signed-up, get all current offices
   * For each office, fetch init doc with the report signup
   * If doc exists:
   *  update the init doc
   *  with employeesObject[phoneNumber] = {
   *  addedOn,
   * signedUpOn,
   * }
   *
   * Else create doc with the data
   */

  const promises = [];

  currentOfficesList.forEach((office) => {
    const promise = rootCollections
      .inits
      .where('report', '==', 'signup')
      .where('office', '==', office)
      .limit(1)
      .get();

    promises.push(promise);
  });

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        const ref = (() => {
          if (snapShot.empty) return rootCollections.inits.doc();

          return snapShot.docs[0].ref;
        })();

        const office = currentOfficesList[index];

        const hasSignedUpBeforeOffice = (() => {
          // profile exists before being added to the office
          //

          return change.before.get('uid')
            && change.after.get('uid')
            && office === newOffice;
        })();

        console.log('signUpRef', ref.path);

        batch.set(ref, {
          office,
          officeId: change.after.get('employeeOf')[office],
          report: 'signup',
          dateString: today.toDateString(),
          date: today.getDate(),
          month: today.getMonth(),
          year: today.getFullYear(),
          employeesObject: {
            [phoneNumber]: getEmployeeObject({
              hasSignedUp,
              hasSignedUpBeforeOffice,
            }),
          },
        }, {
            merge: true,
          });
      });

      return handleInstall(change, options);
    })
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

  if (!after.data()) {
    console.log('Profile Deleted');

    return Promise.resolve();
  }

  const batch = db.batch();

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
  const authDeleted = Boolean(before.get('uid') && !after.get('uid'));
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

  const today = new Date();

  const toGetInit =
    hasSignedUp
    || authDeleted
    || hasInstalled
    || hasBeenAdded
    || hasBeenRemoved;

  if (!toGetInit) return manageAddendum(change, batch);

  const options = {
    phoneNumber,
    newOffice,
    removedOffice,
    currentOfficesList,
    oldOfficesList,
    hasSignedUp,
    authDeleted,
    hasInstalled,
    hasBeenRemoved,
    hasBeenAdded,
    batch,
    today,
  };

  /**
   * What this code does...
   *
   * If has installed
   *    For each office create installs doc.
   * If has been added
   *    For each office (added) created sign up docs with `addedOn` field
   * If uid written
   *    For each office (current) create sign up doc with `signedUpOn` field
   * Delete addendum if new `lastFromQuery` > old `lastFromQuery`.
   *
   */

  console.log({ options });

  return handleSignUp(change, options);
};
