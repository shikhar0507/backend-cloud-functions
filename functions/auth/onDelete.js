const admin = require('../admin/admin');
const process = require('process');

const stripPlusFromMobile =
  require('../firestore/activity/helpers').stripPlusFromMobile;
const inbox = admin.rootCollections.inboxes;
const contactsBook = admin.rootCollections.contactsBook;

const merge = {
  merge: true,
};

const commitBatch = (batch) => batch.commit().catch(console.log);

const deleteInbox = (userRecord, context, batch) => {
  const uid = userRecord.uid;
  const uidDoc = inbox.doc(uid);

  const addendumCollectionRef = uidDoc.collection('Addendum').get();
  const activitiesCollectionRef = uidDoc.collection('Activities').get();
  const allowedTemplates = uidDoc.collection('AllowedTemplates').get();

  Promise.all([
    addendumCollectionRef,
    activitiesCollectionRef,
    allowedTemplates,
  ]).then((snapShotsArray) => {
    const addendumSnapShot = snapShotsArray[0];
    const activitiesSnapShot = snapShotsArray[1];
    const allowedTemplatesSnapShot = snapShotsArray[2];

    if (!addendumSnapShot.empty) {
      addendumSnapShot.forEach((doc) => {
        batch.delete(doc.ref);
      });
    }

    if (!activitiesSnapShot.empty) {
      activitiesSnapShot.forEach((doc) => {
        batch.delete(doc.ref);
      });
    }

    if (!allowedTemplatesSnapShot.empty) {
      allowedTemplatesSnapShot.forEach((doc) => {
        batch.delete(doc.ref);
      });
    }

    return commitBatch(batch);
  }).catch(console.log);
};

const setUidToNullForUser = (userRecord, context, contactDocumentPromises) => {
  const mobile = stripPlusFromMobile(userRecord.phoneNumber);
  const batch = admin.batch;

  return Promise.all(contactDocumentPromises).then((snapShot) => {
    snapShot.forEach((doc) => {
      // doc --> user's contact document
      batch.set(contactsBook.doc(doc.id).collection('Contacts').doc(mobile), {
        uid: null,
      }, merge);
    });
    return deleteInbox(userRecord, context, batch);
  });
};

const app = (userRecord, context) => {
  const mobile = stripPlusFromMobile(userRecord.phoneNumber);

  let contactDocumentPromises = [];
  return contactsBook.doc(mobile).collection('Contacts').get()
    .then((snapShot) => {
      snapShot.forEach((doc) => {
        contactDocumentPromises.push(contactsBook.doc(doc.id)
          .collection('Contacts').get());
      });
      return setUidToNullForUser(userRecord, context, contactDocumentPromises);
    });
};

module.exports = app;
