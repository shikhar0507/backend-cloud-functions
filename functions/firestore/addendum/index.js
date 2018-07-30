'use strict';

const { rootCollections, db, } = require('../../admin/admin');

module.exports = (snap, context) =>
  rootCollections
    .activities
    .doc(snap.get('activityId'))
    .collection('Assignees')
    .get()
    .then((snapShot) => {
      const promises = [];

      snapShot.forEach((doc) => {
        const phoneNumber = doc.id;

        promises.push(rootCollections
          .profiles
          .doc(phoneNumber)
          .get()
        );
      });

      return promises;
    })
    .then((promises) => Promise.all(promises))
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((doc) => {
        if (!doc.exists) return;
        if (!doc.get('uid')) return;

        const uid = doc.get('uid');

        batch.set(rootCollections
          .updates
          .doc(uid)
          .collection('Addendum')
          .doc(),
          snap
        );
      });

      return batch;
    })
    .then((batch) => batch.commit())
    .catch(console.error);
