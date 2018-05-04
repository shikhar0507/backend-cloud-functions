const functions = require('firebase-functions');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://contactform-1b262.firebaseio.com',
});

const auth = admin.auth();
const db = admin.firestore();
const batch = db.batch();
const runTransaction = db.runTransaction;
const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

const getGeopointObject = (lat, lng) => new admin.firestore.GeoPoint(lat, lng);

/**
 * Returns the user record object using the phone number.
 *
 * @param {string} phoneNumber Firebase user's phone number.
 */
const getUserByPhoneNumber =
  (phoneNumber) => auth.getUserByPhoneNumber(phoneNumber);

/**
 * Returns the user record by using the uid.
 *
 * @param {string} uid Firebase uid string.
 */
const getUserByUid = (uid) => auth.getUser(uid);

/**
 * Verifies the user session and returns the uid in a callback.
 *
 * @param {string} idToken String containing the token from the request.
 */
const verifyIdToken = (idToken) => auth.verifyIdToken(idToken);

/**
 * Returns the user records of all the from the array of phone numbers.
 *
 * @param {Array} phoneNumbers An array of phone numbers.
 */
const getMultipleUsersByPhoneNumber = (phoneNumbers) => {
  const phoneNumberPromisesArray = [];

  phoneNumbers.forEach((phoneNumber) => phoneNumberPromisesArray
    .push(getUserByPhoneNumber(phoneNumber)));

  return Promise.all(phoneNumberPromisesArray)
    .then((userRecordsArray) => userRecordsArray)
    .catch((error) => {
      console.log(error);
      return phoneNumberPromisesArray;
    });
};

/**
 * Returns the user records for all the users in an array.
 *
 * @param {Array} uidsArray An array of uid strings.
 * @returns {Array} UserRecordsArray Contains the user records.
 */
const getMultipleUsersByUid = (uidsArray) => {
  const uidPromisesArray = [];

  uidsArray.forEach((uid) => uidPromisesArray.push(getUserByUid(uid)));

  return Promise.all(uidPromisesArray)
    .then((userRecordsArray) => userRecordsArray)
    .catch((error) => {
      console.log(error);
      return uidPromisesArray;
    });
};

const users = {
  getUserByPhoneNumber,
  getUserByUid,
  getMultipleUsersByUid,
  getMultipleUsersByPhoneNumber,
  verifyIdToken,
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
  users,
  batch,
  runTransaction,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
};
