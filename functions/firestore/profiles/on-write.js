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

const https = require('https');

const {
  db,
  rootCollections,
  deleteField,
} = require('../../admin/admin');

const {
  reportNames,
} = require('../../admin/constants');

const sendSMS = (change) => {
  console.log('In sendSMS');
  const {
    downloadUrl,
    smsgupshup,
    isProduction,
  } = require('../../admin/env');

  const smsContext = change.after.get('smsContext');

  // Profile doc is created and the smsContext object has been added to the profile doc.
  const toSendSMS = !change.after.data()
    && change.after.data()
    && smsContext;

  console.log({ toSendSMS, phoneNumber: change.after.id });

  if (!toSendSMS) {
    console.log('NO SMS', { toSendSMS });

    return Promise.resolve();
  }

  // Will not send sms from test project
  if (!isProduction) {
    console.log('NO SMS. NOT PROD');

    return Promise.resolve();
  }

  // Template substitutions allow 20 chars at most.
  const first20Chars = (str) => str.slice(0, 19);

  console.log('SENDING SMS', change.after.id);

  const templatedMessage = (() => {
    const {
      activityName,
      creator,
      office,
    } = smsContext;

    return `${first20Chars(creator)} from ${first20Chars(office)} has`
      + ` created ${first20Chars(activityName)} and`
      + ` included you. Download ${downloadUrl} to view more details.`;
  })();

  // Profile doc id is the phone number
  const sendTo = change.after.id;
  const encodedMessage = `${encodeURI(templatedMessage)}`;
  const host = `enterprise.smsgupshup.com`;
  const path = `/GatewayAPI/rest?method=SendMessage`
    + `&send_to=${sendTo}`
    + `&msg=${encodedMessage}`
    + `&msg_type=TEXT`
    + `&userid=${smsgupshup.userId}`
    + `&auth_scheme=plain`
    + `&password=${smsgupshup.password}`
    + `&v=1.1`
    + `&format=text`;

  const params = {
    host,
    path,
    // HTTPS port is 443
    port: 443,
  };

  return new Promise(
    (resolve, reject) => {
      const req = https.request(params, (res) => {
        // reject on bad status
        console.log('res.statusCode', res.statusCode);

        if (res.statusCode > 226) {
          reject(new Error(`statusCode=${res.statusCode}`));

          return;
        }

        // cumulate data
        let chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));

        // resolve on end
        res.on('end', () => {
          chunks = Buffer.concat(chunks).toString();

          if (chunks.includes('error')) {
            reject(new Error(chunks));

            return;
          }

          resolve(chunks);
        });
      });

      // reject on request error
      // This is not a "Second reject", just a different sort of failure
      req.on('error', (err) => {
        console.log('in err');

        return reject(new Error(err));
      });

      // IMPORTANT
      req.end();
    })
    .then(console.log)
    .catch(console.error);
};


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

      console.log('Deleted:', docs.size);

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


const manageAddendum = (change) => {
  console.log('In manageAddendum');

  const oldFromValue = change.before.get('lastQueryFrom');
  const newFromValue = change.after.get('lastQueryFrom');
  /**
   * Both old and the new values should be available
   * None should be 0.
   * The newer value should be greater than the older
   * value.
   */
  if (!oldFromValue || !newFromValue || newFromValue <= oldFromValue) {
    return Promise.resolve();
  }

  const query = rootCollections
    .updates
    .doc(change.after.get('uid'))
    .collection('Addendum')
    .where('timestamp', '<', oldFromValue)
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


const getEmployeeObject = (options) => {
  const {
    hasSignedUp,
    hasSignedUpBeforeOffice,
  } = options;

  // If `hasSignedUpBeforeOffice`, the timestamp will be the time at
  // which the person was added to the office

  const now = Date.now();

  const object = {
    addedOn: now,
    signedUpOn: '',
  };

  if (hasSignedUp) object.signedUpOn = now;
  if (hasSignedUpBeforeOffice) object.signedUpOn = now;

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

  if (!hasBeenAdded) return Promise.resolve();

  return rootCollections
    .inits
    .where('report', '==', reportNames.SIGNUP)
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

      return Promise.resolve();
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

  if (!hasBeenRemoved) return Promise.resolve();

  return Promise
    .all([
      rootCollections
        .inits
        .where('phoneNumber', '==', phoneNumber)
        .where('report', '==', reportNames.INSTALL)
        .where('office', '==', removedOffice)
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('report', '==', reportNames.SIGNUP)
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

      return Promise.resolve();
    })
    .catch(console.error);
};

const handleInstall = (change, options) => {
  const {
    phoneNumber,
    currentOfficesList,
    hasInstalled,
    batch,
    today,
  } = options;

  if (!hasInstalled) return Promise.resolve();

  const promises = [];

  currentOfficesList.forEach((office) => {
    const promise = rootCollections
      .inits
      .where('phoneNumber', '==', phoneNumber)
      .where('report', '==', reportNames.INSTALL)
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
              officeId,
              report: 'install',
              date: today.getDate(),
              month: today.getMonth(),
              year: today.getFullYear(),
              installs: [Date.now()],
            };
          }

          const {
            installs,
          } = snapShot.docs[0].data();

          installs.push(Date.now());

          return {
            installs,
            date: today.getDate(),
            month: today.getMonth(),
            year: today.getFullYear(),
          };
        })();

        console.log('installRef', ref.path, { initDocObject });

        batch.set(ref, initDocObject, { merge: true });
      });

      return Promise.resolve();
    })
    .catch(console.error);
};


const handleSignUp = (change, options) => {
  const {
    phoneNumber,
    currentOfficesList,
    hasSignedUp,
    newOffice,
    batch,
    today,
  } = options;

  if (!hasSignedUp) return Promise.resolve();

  const promises = [];

  currentOfficesList.forEach((office) => {
    const promise = rootCollections
      .inits
      .where('report', '==', reportNames.SIGNUP)
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

          return change.before.get('uid')
            && change.after.get('uid')
            && office === newOffice;
        })();

        console.log('signUpRef', ref.path);

        batch.set(ref, {
          office,
          officeId: change.after.get('employeeOf')[office],
          report: 'signup',
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

      return Promise.resolve();
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

  /** Only for debugging */
  if (!after.data()) {
    console.log('Profile Deleted');

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

  const options = {
    profileCreated,
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

  console.log({ options });

  return handleSignUp(change, options)
    .then(() => handleInstall(change, options))
    .then(() => handleRemovedFromOffice(change, options))
    .then(() => handleAddedToOffice(change, options))
    .then(() => manageAddendum(change))
    .then(() => options.batch.commit())
    .then(() => sendSMS(change))
    .catch(console.error);
};
