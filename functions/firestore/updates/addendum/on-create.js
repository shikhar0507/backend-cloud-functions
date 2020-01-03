'use strict';

const admin = require('firebase-admin');

const {rootCollections} = require('../../../admin/admin');

module.exports = async (snapShot, context) => {
  // Unassign notifications will go to the user when they are cancelled,
  // or removed as an assignee from an activity for some reason
  // Not sending in the case of unassign because this will trigger multiple
  // notifications to the user
  const {unassign, comment} = snapShot.data();

  if (unassign || !comment) {
    return;
  }

  // remove form include here too.

  try {
    const updatesDoc = await rootCollections.updates
      .doc(context.params.uid)
      .get();

    const {registrationToken} = updatesDoc.data();

    if (!registrationToken) {
      return;
    }

    return admin.messaging().sendToDevice(
      registrationToken,
      {
        data: {
          // Ask the client to send a request to the /read endpoint
          read: '1',
        },
        notification: {
          body: snapShot.get('comment') || '',
          tile: `Growthfile`,
        },
      },
      {
        priority: 'high',
        timeToLive: 60,
      },
    );
  } catch (error) {
    console.error(error);
  }
};
