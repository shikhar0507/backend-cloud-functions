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

const getUserByPhoneNumber =
  (phoneNumber) => auth.getUserByPhoneNumber(phoneNumber);

const getUserByUid = (uid) => auth.getUser(uid);

const verifyIdToken = (idToken) => auth.verifyIdToken(idToken);

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
  enum: db.collection('Enum'),
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
