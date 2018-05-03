const admin = require('../admin/admin');
const utils = require('../admin/utils');
const helpers = require('../firestore/activity/helperLib');

const rootCollections = admin.rootCollections;
const updates = rootCollections.updates;
const profiles = rootCollections.profiles;

const app = (userRecord, context) => {
  const uid = userRecord.uid;
  const phoneNumber = userRecord.phoneNumber;
  const batch = admin.batch;

  batch.set(updates.doc(uid), {
    phoneNumber,
  }, {
      merge: true,
    });

  batch.set(profiles.doc(phoneNumber), {
    uid,
  }, {
      merge: true,
    });

  // profiles.doc(`${phoneNumber}/Subscriptions/subscriptions/Personal/plan`)
  batch.set(profiles.doc(phoneNumber).collection('Subscriptions')
    .doc('subscriptions').collection('Personal').doc('plan'), {
      autoIncludeOnCreate: [phoneNumber], // can possible have multiple values
      timestamp: admin.serverTimestamp,
    }, {
      merge: true,
    });

  return batch.commit().catch((error) => console.log(error));
};

module.exports = app;
