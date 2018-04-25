const admin = require('../admin/admin');
const stripPlusFromMobile =
  require('../firestore/activity/helpers').stripPlusFromMobile;

const commitBatch = (batch) => batch.commit();

const createInbox = (userRecord, context, batch, addendumDocs) => {
  if (addendumDocs) {
    Promise.all(addendumDocs).then((snapShotsArray) => {
      snapShotsArray.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          batch.set(admin.rootCollections.inboxes
            .doc(userRecord.uid).collection('Addendum').doc(), doc.data());
        });
      });
      return null;
    }).catch(console.log);
  }
  return commitBatch(batch);
};

const copyContactBookData = (userRecord, context, batch) => {
  const activitySubCollectionRef = admin.rootCollections.contactsBook
    .doc(mobile).collection('Activities').get();
  const contactSubCollectionRef = admin.rootCollections.contactsBook
    .doc(mobile).collection('Contacts').get();

  Promise.all([activitySubCollectionRef, contactSubCollectionRef])
    .then((result) => {
      const activityDocs = result[0];
      const contactDocs = result[1];

      if (!contactDocs.empty || !activityDocs.empty) {
        if (!contactDocs.empty) {
          contactDocs.forEach((doc) => {
            // doc.ref.path.split('/')[]
            batch.set(admin.rootCollections.contactsBook
              .doc(doc.get('mobile')).collection('Contacts').doc(mobile), {
                uid,
              });
          });
        }

        let addendumDocs = [];

        if (!activityDocs.empty) {
          activityDocs.forEach((doc) => {
            // doc.ref.path
            batch.set(admin.rootCollections.activities.doc(doc.id), {
              lastUpdateTime: admin.serverTimestamp,
            }, {
                merge: true,
              });

            addendumDocs.push(admin.rootCollections.activities
              .doc(doc.id).collection('Addendum').get());
          });
          createInbox(userRecord, context, batch, addendumDocs);
        }
      } else {
        commitBatch(batch);
      }
      return null;
    }).catch(console.log);
};

const app = (userRecord, context) => {
  const uid = userRecord.uid;
  const mobile = stripPlusFromMobile(userRecord.phoneNumber);
  const batch = admin.batch;

  return admin.rootCollections.contactsBook.doc().get()
    .then((doc) => {
      if (doc.exists) { // previous user
        batch.set(admin.rootCollections.contactsBook.doc(mobile), {
          uid,
        }, {
            merge: true, // save other data
          });

        copyContactBookData(userRecord, context, batch);
      } else {
        batch.set(admin.rootCollections.profiles.doc(uid), {
          mobile,
        });

        batch.set(admin.rootCollections.profiles.doc(uid)
          .collection('AllowedTemplates').doc('personal'), {
            template: 'plan',
          });

        batch.set(admin.rootCollections.contactsBook.doc(mobile), {
          uid,
        });

        commitBatch(batch);
      }
      return null;
    }).catch((error) => {
      console.log(error);
      return new Promise(true);
    });
};

module.exports = app;
