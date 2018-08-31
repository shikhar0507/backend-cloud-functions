'use strict';

const { httpsActions, } = require('../../admin/constants');
const {
  db,
  rootCollections,
} = require('../../admin/admin');

module.exports = (snapShot, context) => {
  const activityId = context.params.docId;
  const activityRef = rootCollections.activities.doc(activityId);

  return activityRef
    .get()
    .then((doc) => {
      const batch = db.batch();
      const officeId = doc.get('officeId');
      const attachment = doc.get('attachment');
      const userDeviceTimestamp = snapShot.get('userDeviceTimestamp');
      const updatedPhoneNumber = snapShot.get('updatedPhoneNumber');
      const timestamp = snapShot.get('timestamp');
      const location = snapShot.get('location');
      const user = snapShot.get('user');
      const canEdit = snapShot.get('canEdit');
      const isSupportRequest = snapShot.get('isSupportRequest');

      batch.set(rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .doc(), {
          user,
          action: httpsActions.updatePhoneNumber,
          location,
          timestamp,
          userDeviceTimestamp,
          activityId,
          updatedPhoneNumber,
          isSupportRequest,
        });

      batch.delete(activityRef
        .collection('Assignees')
        .doc(user)
      );

      batch.set(activityRef
        .collection('Assignees')
        .doc(updatedPhoneNumber), {
          canEdit,
        });

      const newAttachment = attachment;

      Object
        .keys(attachment)
        .forEach((key) => {
          const item = attachment[key];
          const value = item.value;
          const type = item.type;

          if (type !== 'phoneNumber') return;
          if (value === '') return;
          if (value !== user) return;

          newAttachment[value] = updatedPhoneNumber;
        });

      batch.set(activityRef, {
        timestamp,
        attachment: newAttachment,
      }, {
          merge: true,
        });

      return batch.commit();
    })
    .catch(console.error);
};
