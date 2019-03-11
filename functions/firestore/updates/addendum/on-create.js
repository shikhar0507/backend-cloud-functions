'use strict';

const admin = require('firebase-admin');

const {
  rootCollections,
} = require('../../../admin/admin');



module.exports = (snapShot, context) => {
  // Unassign notifications will go to the user when they are cancelled, 
  // or removed as an assignee from an activity for some reason
  // Not sending in the case of unassign because this will trigger multiple 
  // notifications to the user
  if (snapShot.get('unassign')) {
    return Promise.resolve();
  }

  return rootCollections
    .updates
    .doc(context.params.uid)
    .get()
    .then((updatesDoc) => {
      const registrationToken = updatesDoc.get('registrationToken');

      if (!registrationToken) {
        return Promise.resolve();
      }

      const payload = {
        data: {
          // Ask the client to send a request to the /read endpoint
          read: '1',
        },
        notification: {
          body: snapShot.get('comment'),
          tile: `Growthfile`,
        },
      };
      const ONE_MINUTE = 60;
      const options = {
        priority: 'high',
        timeToLive: ONE_MINUTE,
      };

      return admin
        .messaging()
        .sendToDevice(registrationToken, payload, options);
    })
    .catch((error) => console.error({
      error,
      params: context.params,
    }));
};
