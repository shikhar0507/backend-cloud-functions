const functions = require('firebase-functions');

const authOnCreate = require('./auth/onCreate');
const authOnDelete = require('./auth/onDelete');

const appServer = require('./server/server');

const inboxUpdater = require('./firestore/inbox/updater');

module.exports = {
  authOnCreate: functions.auth.user().onCreate(authOnCreate),
  authOnDelete: functions.auth.user().onDelete(authOnDelete),
  inboxUpdater: functions.firestore
    .document('Activities/{actId}/Addendum/{docId}').onCreate(inboxUpdater),
  app: functions.https.onRequest(appServer),
};
