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


const admin = require('firebase-admin');
const serviceAccountKey = require('./key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKey),
  databaseURL: 'https://growthfilev2-0.firebaseio.com',
});

const auth = admin.auth();
const db = admin.firestore();
/** A sentinel which maps to the Firestore server timestamp when written to
 * a field in a document.
 */
const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();


/**
 * Sets claims for a user based on `uid`.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @param {Object} claims Contains Claims object.
 * @returns {Promise} A `userRecord` or an `error` object.
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
  new admin
    .firestore
    .GeoPoint(
      geopoint.latitude,
      geopoint.longitude
    );


/**
 * Updates the phone number of a user in the auth for Firebase.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @param {string} phoneNumber A E.164 phone number.
 * @returns {Object} An updated `userRecord`.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const updateUserPhoneNumberInAuth = (uid, phoneNumber) =>
  auth.updateUser(uid, {
    phoneNumber,
  });


/**
 * Creates a new user in Auth with the given userRecord.
 *
 * @param {Object} userRecord Contains the fields with user data.
 * @returns {Promise} New `userRecord` for the created user.
 */
const createUserInAuth = (userRecord) => auth.createUser(userRecord);


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
 * @returns {Object} A `userRecord` containing the `photoURL`, `displayName`
 * and the `lastSignInTime`.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const getUserByPhoneNumber = (phoneNumber) => {
  /** Could've simply returned the `userRecord` with this function, but
   * in some cases, this function is called inside a loop. So, whenever
   * there is an error, the function would crash the cloud function.
   * To avoid that, the catch() clause now handles the response in
   * a different way.
   */
  return auth.getUserByPhoneNumber(phoneNumber).then((userRecord) => {
    return {
      [phoneNumber]: userRecord,
    };
  }).catch((error) => {
    if (error.code === 'auth/user-not-found' ||
      error.code === 'auth/invalid-phone-number' ||
      error.code === 'auth/internal-error') {
      return {
        [phoneNumber]: {},
      };
    }

    console.log(error);
    return {
      [phoneNumber]: {},
    };
  });
};


/**
 * Disables the user account in auth.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @returns {Promise} Resolving to a userRecord object.
 */
const disableUser = (uid) =>
  auth.updateUser(uid, {
    disabled: true,
  });


/**
 * Returns the `userRecord` by using the `uid`.
 *
 * @param {string} uid Firebase uid string.
 * @returns {Object} Object containing the user record.
 */
const getUserByUid = (uid) => auth.getUser(uid);


/**
 * Verifies the user session and returns the uid in a callback.
 *
 * @param {string} idToken String containing the token from the request.
 * @param {boolean} checkRevoked Checks if the token has been revoked recently.
 * @returns {Object} The `userRecord` from Firebase auth.
 */
const verifyIdToken = (idToken, checkRevoked) =>
  auth.verifyIdToken(idToken, checkRevoked);


const users = {
  getUserByPhoneNumber,
  getUserByUid,
  verifyIdToken,
  createUserInAuth,
  updateUserPhoneNumberInAuth,
  revokeRefreshTokens,
  disableUser,
  setCustomUserClaims,
};


/**
 * Contains the references to all the collections which are in the
 * root of the Firestore.
 */
const rootCollections = {
  /** Collection which contains `docs` of the users with their
   * `activities` and `subscriptions` in a `subcollection` inside it.
   * @example /Profiles/(phoneNumber)/
   */
  profiles: db.collection('Profiles'),
  /** Collection which contains the `activity` docs. It also has a
   * subcollection called `Assignees` which has the docs of the users
   * who are the assignees of the activity.
   * @example /Activities/(auto-id)/
   */
  activities: db.collection('Activities'),
  /** Collection containing the `Addendum` for each time an operation
   * is performed related to the activity like `comment`, `share`, `remove`,
   * or `update`.
   * @example /Updates/(uid)/Addendum/(auto-id)
   */
  updates: db.collection('Updates'),
  /** Contains contstants used throughout the system.
   * @example /ENUM/(doc-id)/
   */
  enums: db.collection('Enum'),
  /** Contains Templates used for creating activity.
   * @example /ActivityTemplates/(auto-id)/
   */
  activityTemplates: db.collection('ActivityTemplates'),
  /** Contains a _unique_ doc for *each* `office` which has signed up for
   * the platform.
   */
  offices: db.collection('Offices'),
  /** This collection stores a document temporarily for
   * collecting the data required for an instant notification.
   * Once the notification is sent successfully, the document in context
   * is deleted by an auto-triggering function in Firestore.
   * @example /Instant(auto-id)/
   */
  instant: db.collection('Instant'),
  dailySignUps: db.collection('DailySignUps'),
  dailyInits: db.collection('DailyInits'),
  dailyActivities: db.collection('DailyActivities'),
  dailyDisabled: db.collection('DailyDisabled'),
  dailyPhoneNumberChanges: db.collection('DailyPhoneNumberChanges'),
};


module.exports = {
  db,
  users,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
};
