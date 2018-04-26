const admin = require('../../admin/admin');

const activities = admin.rootCollections.activities;
const inbox = admin.rootCollections.inboxes;
const contactBook = admin.rootCollections.contactsBook;
const merge = {
  merge: true,
};

const commitBatch = (batch) => batch.commit().catch(console.log);

const getUidsFromMobileNumbers = (snap, context, mobilePromises) => {
  const uidList = [];
  const batch = admin.batch;
  let inboxDoc;
  const data = {
    timestamp: snap.timestamp,
  };

  return Promise.all(mobilePromises).then((snapShotsArray) => {
    snapShotsArray.forEach((doc) => {
      if (doc.exists) {
        // skip all the mobiles which don't have a document in
        // ContactBook
        inboxDoc = inbox.doc(doc.get('uid'));

        batch.set(inboxDoc.collection('Addendum').doc(), data, merge);
        batch.set(inboxDoc.collection('Activities').doc(), data, merge);
        batch.set(inboxDoc.collection('AllowedTemplates').doc(), data, merge);
      }
    });
    return commitBatch(batch);
  }).catch(console.log);
};

const app = (snap, context) => {
  const data = snap.data(); // data from
  const activityId = context.params.actId;
  const activityRef = activities.doc(activityId).get();
  const assignToSubCollectionRef = activities.doc(activityId)
    .collection('AssignTo').get();

  let mobilePromises = [];

  return Promise.all([activityRef, assignToSubCollectionRef])
    .then((result) => {
      snap.timestamp = result[0].get('lastUpdateTime');

      result[1].forEach((doc) => {
        mobilePromises.push(contactBook.doc(doc.id).get());
      });
      return getUidsFromMobileNumbers(snap, context, mobilePromises);
    }).catch(console.log);
};

module.exports = app;
