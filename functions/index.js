const functions = require('firebase-functions');

const authOnCreate = require('./auth/onCreate');
const authOnDelete = require('./auth/onDelete');

const appServer = require('./server/server');

module.exports = {
  authOnCreate: functions.auth.user().onCreate(authOnCreate),
  authOnDelete: functions.auth.user().onDelete(authOnDelete),
  app: functions.https.onRequest(appServer),
};
