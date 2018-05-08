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


const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const auth = admin.auth();
const db = admin.firestore();
const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();


/**
 * Returns a sentinel containing the GeoPoint object for writing a
 * geopoint type in Firestore.
 *
 * @param {number} lat A valid latitude.
 * @param {number} lng A valid longitude.
 */
const getGeopointObject = (lat, lng) => new admin.firestore.GeoPoint(lat, lng);


/**
 * Updates the phone number of a user in the auth for Firebase.
 *
 * @param {string} uid A 30 character alpha-numeric string.
 * @param {string} phoneNumber A E.164 phone number.
 */
const updateUserPhoneNumberInAuth = (uid, phoneNumber) => {
  return auth.updateUser(uid, {
    phoneNumber,
  });
};


/**
 * Creates a new user in Auth with the given userRecord.
 *
 * @param {Object} userRecord Contains the fields with user data.
 */
const createUserInAuth = (userRecord) => auth.createUser(userRecord);


/**
 * Returns the user record object using the phone number.
 *
 * @param {string} phoneNumber Firebase user's phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 * @returns {Object} A userRecord containing the photoURL, displayName
 * and the lastSignInTime.
 */
const getUserByPhoneNumber = (phoneNumber) => {
  return auth.getUserByPhoneNumber(phoneNumber).then((userRecord) => {
    return {
      [phoneNumber]: {
        photoURL: userRecord.photoURL || null,
        displayName: userRecord.displayName || null,
        lastSignInTime: userRecord.metadata.lastSignInTime,
      },
    };
  }).catch((error) => {
    if (error.code === 'auth/user-not-found' ||
      error.code === 'auth/invalid-phone-number') {
      return {
        [phoneNumber]: {},
      };
    }
    console.log(error);
    return null;
  });
};


/**
 * Returns the user record by using the uid.
 *
 * @param {string} uid Firebase uid string.
 * @returns {Object} Object containing the user record.
 */
const getUserByUid = (uid) => auth.getUser(uid);


/**
 * Verifies the user session and returns the uid in a callback.
 *
 * @param {string} idToken String containing the token from the request.
 * @returns {Object} The userRecord from Firebase auth.
 */
const verifyIdToken = (idToken) => auth.verifyIdToken(idToken);


const users = {
  getUserByPhoneNumber,
  getUserByUid,
  verifyIdToken,
  createUserInAuth,
  updateUserPhoneNumberInAuth,
};


const rootCollections = {
  profiles: db.collection('Profiles'),
  activities: db.collection('Activities'),
  updates: db.collection('Updates'),
  enums: db.collection('Enum'),
  activityTemplates: db.collection('ActivityTemplates'),
  offices: db.collection('Offices'),
};


module.exports = {
  db,
  users,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
};
