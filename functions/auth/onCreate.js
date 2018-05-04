const {
  batch,
  rootCollections,
} = require('../admin/admin');

const {
  updates,
  profiles,
} = rootCollections;

const app = (userRecord, context) => {
  const {
    uid,
    phoneNumber,
  } = userRecord;

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

  batch.set(profiles.doc(phoneNumber).collection('Subscriptions')
    .doc(), {
      office: 'personal',
      template: 'plan',
      autoIncludeOnCreate: [phoneNumber],
      timestamp: admin.serverTimestamp,
    }, {
      merge: true,
    });

  return batch.commit().catch((error) => console.log(error));
};

module.exports = app;
