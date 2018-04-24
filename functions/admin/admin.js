const functions = require('firebase-functions');
const admin = require('firebase-admin');
const serviceAccount = require('./key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://growthfilev2-0.firebaseio.com',
});

const auth = admin.auth();
const db = admin.firestore();
const batch = db.batch();
const runTransaction = db.runTransaction;
const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

const getGeopointObject = (lat, lng) => new admin.firestore.GeoPoint(lat, lng);

// https://firebase.google.com/docs/auth/admin/manage-users
const createUserInAuth = (userData) => auth.createUser(userData);
const updateUserInAuth = (uid, updates) => auth.updateUser(uid, updates);
const deleteUserByUid = (uid) => auth.deleteUser(uid);
const getUserByPhoneNumber = (mobile) => auth.getUserByPhoneNumber(mobile);
const getUserByUid = (uid) => auth.getUser(uid);
const verifyUserByIdToken = (idToken) => auth.verifyIdToken(idToken);

const manageUsers = {
  createUserInAuth,
  updateUserInAuth,
  deleteUserByUid,
  getUserByPhoneNumber,
  getUserByUid,
  verifyUserByIdToken,
};

// --> merged public, private, system
const profiles = db.collection('UserData');
const inboxes = db.collection('Inbox');
const contactsBook = db.collection('ContactBook'); // previously -> map
const activities = db.collection('Activities');
const templates = db.collection('ActivityTemplates');
const enums = db.collection('Enum');
const offices = db.collection('Office');


const rootCollections = {
  profiles,
  inboxes,
  contactsBook,
  activities,
  templates,
  enums,
  offices,
};


module.exports = {
  getGeopointObject,
  serverTimestamp,
  rootCollections,
  runTransaction,
  manageUsers,
  batch,
  db,
};
