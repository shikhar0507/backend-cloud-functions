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

      const regestrationToken = snapShot.docs[0].get('regestrationToken');

      if (!regestrationToken) {
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

      const options = {
        priority: 'high',
        // 1 day
        timeToLive: 60 * 60 * 24,
      };

      console.log(`Notification sent to `
        + `'${context.params.phoneNumber}'`, { payload });

      return admin
        .messaging()
        .sendToDevice(regestrationToken, payload, options);
    })
    .then(console.log)
    .catch(console.error);
};
