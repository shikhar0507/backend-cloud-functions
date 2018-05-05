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

const updateUserInAuth = (userRecord) => {
  if (userRecord.phoneNumber) {
    const {
      phoneNumber,
      email,
      displayName,
      photoURL,
    } = userRecord;

    return auth.updateUser(conn.creator.uid, {
      phoneNumber: phoneNumber,
      email: email || null,
      displayName: displayName || null,
      photoURL: photoURL || null,
    }).catch((error) => {
      return;
    });
  } else {
    return;
  }
};

const createUserInAuth = (userRecord) => {
  return auth.createUser({
    phoneNumber: userRecord.phoneNumber,
    displayName: userRecord.displayName || null,
    email: userRecord.email || null,
    photoURL: userRecord.photoURL || null,
  }).catch((error) => {
    console.log(error);
    throw new Error('error/user-not-created');
  });
};


/**
 * Returns the user record object using the phone number.
 *
 * @param {string} phoneNumber Firebase user's phone number.
 */
const getUserByPhoneNumber = (phoneNumber) => {
  return auth.getUserByPhoneNumber(phoneNumber).then((userRecord) => {
    return {
      [phoneNumber]:
        {
          photoUrl: userRecord.photoURL || null,
          displayName: userRecord.displayName || null,
        },
    };
  }).catch((error) => {
    if (error.code === 'auth/user-not-found' ||
      error.code === 'auth/invalid-phone-number') {
      return {
        [phoneNumber]: {},
      };
    }
  });
};


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


const users = {
  getUserByPhoneNumber,
  getUserByUid,
  verifyIdToken,
  createUserInAuth,
  updateUserInAuth,
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
