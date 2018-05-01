const functions = require('firebase-functions');

const authOnCreate = require('./auth/onCreate');

const appServer = require('./server/server');

module.exports = {
  authOnCreate: functions.auth.user().onCreate(authOnCreate),
  app: functions.https.onRequest(appServer),
};
