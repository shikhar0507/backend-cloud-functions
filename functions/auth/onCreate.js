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

  batch.set(updates.doc(phoneNumber), {
    uid,
  }, {
      merge: true,
    });

  batch.set(updates.doc(phoneNumber).collection('AllowedTemplates')
    .doc('office'), {
      template: 'plan',
      timestamp: admin.serverTimestamp,
    }, {
      merge: true,
    });

  batch.set(updates.doc(uid), {
    phoneNumber,
  });

  return batch.commit().catch((error) => console.log(error));
};

module.exports = app;
