'use strict';

const admin = require('firebase-admin');

const {
  db,
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
          test: snap.get('comment'),
        },
        notification: {
          body: snap.get('comment'),
          tile: `Growthfile`,
        },
      };
      const ONE_DAY = 60 * 60 * 24;
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
    .then((result) => {
      if (!result) {
        console.log('No result...', result);

        return Promise.resolve();
      }

      console.log('str', JSON.stringify(result));

      return db.collection('FCMTEST').doc().set({
        object: result,
      });
    })
    .catch(console.error);
