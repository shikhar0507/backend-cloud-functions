'use strict';

const admin = require('firebase-admin');

const {
  rootCollections,
} = require('../../../admin/admin');



module.exports = (snap, context) =>
  rootCollections
    .updates
    .doc(context.params.uid)
    .get()
    .then((updatesDoc) => {
      const registrationToken = updatesDoc.get('registrationToken');

      if (!registrationToken) {
        console.log('NO REGESTRATION TOKEN FOUND. EXITING...');

        return Promise.resolve();
      }

      const payload = {
        data: {
          // test: snap.get('comment'),
          key1: 'value1',
          key2: 'value2',
        },
        notification: {
          body: snap.get('comment'),
          tile: `Growthfile`,
        },
      };
      const ONE_DAY = 60;
      const options = {
        priority: 'high',
        timeToLive: ONE_DAY,
      };

      console.log(`Notification sent to `
        + `phoneNumber=${updatesDoc.get('phoneNumber')},`
        + ` 'uid=${context.params.phoneNumber}'`, { payload });

      return admin
        .messaging()
        .sendToDevice(registrationToken, payload, options);
    })
    .then(JSON.stringify)
    .catch(console.error);
