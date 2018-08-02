'use strict';

const {
  rootCollections,
  db,
} = require('../../admin/admin');

// assignee on write

module.exports = (change, context) => {
  const batch = db.batch();

  const newDocRef = change.after.exists ? change.after : null;

  const activityId = context.params.activityId;
  const phoneNumber = context.params.phoneNumber;

  const userProfile = rootCollections.profiles.doc(phoneNumber);

  /** A user has been unassigned from the activity.
   * Remove the activity doc from their profile.
   */
  if (!newDocRef) {
    batch.delete(userProfile
      .collection('Activities')
      .doc(activityId)
    );

    return batch.commit().catch(console.error);
  } else {
    /** A new user has been assigned to this activity.
     * Add the doc with the id, canEdit and timestamp
     * to their profile.
     */
    return userProfile
      .get()
      .then((doc) => {
        if (!doc.exists) {
          batch.set(userProfile, { uid: null, });
        }

        batch.set(userProfile
          .collection('Activities')
          .doc(activityId), {
            canEdit: newDocRef.get('canEdit'),
            timestamp: newDocRef.createTime,
          });

        return batch.commit();
      })
      .catch(console.error);
  }
};
