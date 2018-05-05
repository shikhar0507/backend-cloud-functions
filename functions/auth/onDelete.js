const {
  batch,
  rootCollections,
  serverTimestamp,
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

  batch.set(profiles.doc(phoneNumber), {
    uid: null,
  }, {
      merge: true,
    });

  batch.set(updates.doc(uid), {
    phoneNumber: null,
  }, {
      merge: true,
    });

  return batch.commit().then((error) => console.log(error));
};
