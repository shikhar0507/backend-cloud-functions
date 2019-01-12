'use strict';

const admin = require('firebase-admin');

const {
  rootCollections,
} = require('../../../admin/admin');

module.exports = (change, context) => {
  console.log(`IN SEND NOTIFICATION FUNCTION`);

  const activityData = change.after.data();

  return rootCollections
    .updates
    .where('phoneNumber', '==', context.params.phoneNumber)
    .limit(1)
    .get()
    .then((snapShot) => {
      if (snapShot.empty) {
        return Promise.resolve();
      }

      const registrationToken = snapShot.docs[0].get('registrationToken');

      if (!registrationToken) {
        console.log('NO REGESTRATION TOKEN FOUND. EXITING...');

        return Promise.resolve();
      }

      const payload = {
        data: {},
        notification: {
          body: 'TESTING GROWTHFILE NOTIFICATIONS',
          tile: `Growthfile`,
        },
      };
      const ONE_DAY = 60 * 60 * 24;
      const options = {
        priority: 'high',
        timeToLive: ONE_DAY,
      };

      console.log(`Notification sent to `
        + `'${context.params.phoneNumber}'`, { payload });

      return admin
        .messaging()
        .sendToDevice(registrationToken, payload, options);
    })
    .then(console.log)
    .catch(console.error);
};
