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


const admin = require('firebase-admin');
const process = require('process');
const serviceAccountKey = require('./service_account');
const credential = admin.credential.cert(serviceAccountKey);

admin.initializeApp({ credential, });

const auth = admin.auth();
const db = admin.firestore();

db.settings({ timestampsInSnapshots: true, });

/** A `sentinel` which maps to the Firestore server timestamp when written to
 * a field in a document.
 */
const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

/** For the worst cases where there is an omission of a `catch()` block. */
process
  .on('unhandledRejection', console.log);

process
  .on('uncaughtException', console.log);


/**
 * Sets claims for a user based on `uid`.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @param {Object} claims Contains Claims object.
 * @returns {Promise <Object>} A `userRecord` or an `error` object.
 */
const setCustomUserClaims = (uid, claims) =>
  auth.setCustomUserClaims(uid, claims);


/**
 * Returns a sentinel containing the GeoPoint object for writing a
 * geopoint type in Firestore.
 *
 * @param {Object} geopoint Contains lat, lng value pair.
 * @returns {Object} A `sentinel` which *maps* to a `geopoint` object
 * on writing to the Firestore.
 */
const getGeopointObject = (geopoint) =>
  new admin.firestore.GeoPoint(
    geopoint._latitude,
    geopoint._longitude
  );


/**
 * Deletes the field from Firestore that field is set equal to
 * this function's return value.
 *
 * @returns {Object} Firestore FieldValue Object.
 */
const deleteField = () => admin.firestore.FieldValue.delete();


/**
 * Updates the phone number of a user in the auth for Firebase.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @param {string} phoneNumber A E.164 phone number.
 * @returns {Promise <Object>} Resolving to an updated `userRecord`.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const updateUserPhoneNumberInAuth = (uid, phoneNumber) =>
  auth.updateUser(uid, { phoneNumber, });


/**
 * Creates a new user in Auth with the given userRecord.
 *
 * @param {Object} userRecord Contains the fields with user data.
 * @returns {Promise <Object>} New `userRecord` for the created user.
 */
const createUserInAuth = (userRecord) => auth.createUser(userRecord);


/**
 * Deletes the user from auth.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @returns {Promise <Object>} Resolving to a `userRecord` object who's auth was deleted.
 */
const deleteUserFromAuth = (uid) => auth.deleteUser(uid);

/**
 * Revokes the token of the a user in order to end their login session.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @returns {Promise} The `userRecord` of user who's `idToken` was revoked.
 * @see https://firebase.google.com/docs/auth/admin/manage-sessions#revoke_refresh_token
 */
const revokeRefreshTokens = (uid) => auth.revokeRefreshTokens(uid);


/**
 * Returns the user record object using the phone number.
 *
 * @param {string} phoneNumber Firebase user's phone number.
 * @returns {Promise <Object>} Resolving to a `userRecord` object containing
 * the `photoURL`, `displayName` and the `lastSignInTime`.
 * @description Could've simply returned the `userRecord` with this function, but
 * in some cases, this function is called inside a loop. So, whenever
 * there is an error, the function would crash the cloud function.
 * To avoid that, the catch() clause now handles the response in
 * a different way.
 * Here, this function will return an empty object even in the case when
 * the input `phoneNumber` is in does not confirm to the E.164 phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const getUserByPhoneNumber = (phoneNumber) =>
  auth.getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      return {
        [phoneNumber]: userRecord,
      };
    })
    .catch((error) => {
      /** @see https://firebase.google.com/docs/auth/admin/errors */
      if (error.code === 'auth/user-not-found'
        || error.code === 'auth/invalid-phone-number'
        || error.code === 'auth/internal-error') {
        return {
          [phoneNumber]: {},
        };
      }

      /**
       * Any other cases except the ones handled above should be
       * noted by the developers.
       */
      console.error(error);

      /** This function relies on the user input, so chances are
       * that all three conditions checked above may not cover
       * all the cases. Returning a usable object regardless,
       * so the clients can work correctly.
       */
      return {
        [phoneNumber]: {},
      };
    });


/**
 * Disables the user account in auth.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @returns {Promise <Object>} Resolving to a userRecord object.
 */
const disableUser = (uid) => auth.updateUser(uid, { disabled: true, });


/**
 * Returns the `userRecord` by using the `uid`.
 *
 * @param {string} uid Firebase uid string.
 * @returns {Promise <Object>} Resolving to a `userRecord` object.
 */
const getUserByUid = (uid) => auth.getUser(uid);


/**
 * Verifies the user session and returns the uid in a callback.
 *
 * @param {string} idToken String containing the token from the request.
 * @param {boolean} checkRevoked Checks if the token has been revoked recently.
 * @returns {Promise <Object>} Resolves to an object with the user's
 * `uid`, `exp`, `iat`, `aud`, `iss`, `sub` and `auth_time`.
 * @see https://firebase.google.com/docs/auth/admin/verify-id-tokens
 */
const verifyIdToken = (idToken, checkRevoked) =>
  auth.verifyIdToken(idToken, checkRevoked);


/**
 * Contains the references to all the collections which are in the
 * root of the Firestore.
 *
 * **Note**: Brackets `()` in the string means that the string inside
 * them is either a variable.
 */
const rootCollections = {
  /** Collection which contains `docs` of the users with their
   * `activities` and `subscriptions` in a `sub-collection` inside it.
   * @example `/Profiles/(phoneNumber)`
   */
  profiles: db.collection('Profiles'),
  /** Collection which contains the `activity` docs. It also has a
   * sub-collection called `Assignees` which has the docs of the users
   * who are the assignees of the activity.
   * @example `/Activities/(auto-id)`
   */
  activities: db.collection('Activities'),
  /** Collection containing the `Addendum` for each time an operation
   * is performed related to the activity like `comment`, `share`, `remove`,
   * or `update`.
   * @example `/Updates/(uid)/Addendum/(auto-id)`
   */
  updates: db.collection('Updates'),
  /** Contains constants used throughout the system.
   * @example `/ENUM/(doc-id)/`
   */
  enums: db.collection('Enum'),
  /** Contains Templates used for creating activity.
   * @example `/ActivityTemplates/(auto-id)`
   */
  activityTemplates: db.collection('ActivityTemplates'),
  /** Stores all the data for creating templates and emails
   * along with their recipients and email timings.
   * @example `/ReportTemplates/(report-name)`
   */
  reportTemplates: db.collection('ReportTemplates'),
  /** Contains a _unique_ doc for *each* `office` which has signed up for
   * the platform.
   * @example `/Offices/(autoId)'
   */
  offices: db.collection('Offices'),
  /** Stores documents temporarily for sending an instant email
   * notification to any recipient. Once the report is sent,
   * the document here is deleted by the same cloud function
   * for which a document was created here.
   * @example `/Instant/(auto-id)`
   */
  instant: db.collection('Instant'),
  /** Contains the Docs of all the users who have signed up on
   * a particular day.
   * @example `/DailySignUps/(DD-MM-YYYY)`
   */
  dailySignUps: db.collection('DailySignUps'),
  /** A Log of all the users who have **initialized** the app first
   * time on their devices.
   * @example `/DailyInits/(DD-MM-YYYY)`
   */
  dailyInits: db.collection('DailyInits'),
  /** Stores the users who are disabled on a day
   * @example `/DailyDisabled/(DD-MM-YYYY)`
   */
  dailyDisabled: db.collection('DailyDisabled'),
  /** Contains the list of users who have changed their phone numbers
   * for each day.
   * @example `/DailyPhoneNumberChanges/(DD-MM-YYYY)`
   */
  dailyPhoneNumberChanges: db.collection('DailyPhoneNumberChanges'),
  phoneNumberUpdates: db.collection('PhoneNumberUpdates'),
  reports: db.collection('Reports'),
};


const users = {
  disableUser,
  getUserByUid,
  verifyIdToken,
  createUserInAuth,
  deleteUserFromAuth,
  setCustomUserClaims,
  revokeRefreshTokens,
  getUserByPhoneNumber,
  updateUserPhoneNumberInAuth,
};


module.exports = {
  db,
  auth,
  users,
  deleteField,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
};
