const functions = require('firebase-functions');

const onAuth = require('./auth/onAuth');
const appServer = require('./server/server');

module.exports = {
  onAuth: functions.auth.user().onCreate(onAuth),
  app: functions.https.onRequest(appServer),
};
