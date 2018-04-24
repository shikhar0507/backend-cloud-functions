const admin = require('../admin/admin');

const commitBatch = (batch) => batch.commit();

const createInbox = (userRecord, context, batch, addendumDocs) => {
  let data;

  if (addendumDocs) { // array of doc refs
    Promise.all(addendumDocs).then((snapShotArray) => {
      snapShotArray.forEach((doc) => {
        batch.set(admin.collections.inboxRootRef
          .doc(userRecord.uid).collection('Addendum').doc(), {
            // activityId: doc.ref.path.split('/')[1],
            activityId: doc.get('activityId'),
            changes: doc.get('changes'),
            comment: doc.get('comment'),
            location: doc.get('location'),
            timestamp: doc.get('timestamp'),
            user: doc.get('user'),
          });
      });
      return null;
    }).catch((error) => {
      console.log(error);
    });
  }

  return commitBatch(batch);
};

const copyContactBookData = (userRecord, context, batch) => {
  const activitySubCollectionRef = admin.collections.contactBookRootRef
    .doc(mobile).collection('Activity').get();
  const contactSubCollectionRef = admin.collections.contactBookRootRef
    .doc(mobile).collection('Contact').get();

  Promise.all([activitySubCollectionRef, contactSubCollectionRef])
    .then((result) => {
      const activityDocs = result[0];
      const contactDocs = result[1];

      if (!contactDocs.empty || !activityDocs.empty) {
        if (!contactDocs.empty) {
          contactDocs.forEach((doc) => {
            // doc.ref.path.split('/')[]
            batch.set(admin.collections.contactBookRootRef
              .doc(doc.get('mobile')).collection('Contacts').doc(mobile), {
                uid,
              });
          });
        }

        let addendumDocs = [];

        if (!activityDocs.empty) {
          activityDocs.forEach((doc) => {
            // doc.ref.path
            batch.set(admin.collections.activitiesRootRef.doc(doc.id), {
              lastUpdateTime: admin.serverTimestamp,
            }, {
              merge: true,
            });

            addendumDocs.push(admin.collections.activitiesRootRef
              .doc(doc.id).collection('Addendum').get());
          });
          createInbox(userRecord, context, batch, addendumDocs);
        }
      } else {
        commitBatch(batch);
      }
      return null;
    }).catch((error) => {
      console.log(error);
    });
};

const app = (userRecord, context) => {
  const uid = userRecord.uid;
  const mobile = userRecord.phoneNumber.split('+')[1]; // without ocountry code
  const batch = admin.batch();

  return admin.collections.contactBookRootRef.doc(mobile).get()
    .then((doc) => {
      if (doc.exists) {
        batch.set(admin.collections.contactBookRootRef.doc(mobile), {
          uid, // update uid
        }, {
          merge: true,
        });

        copyContactBookData(userRecord, context, batch);
      } else {
        batch.set(admin.collections.contactBookRootRef.doc(mobile), {
          uid,
        });

        batch.set(admin.collections.profileRootRef.doc(uid), {
          personal: ['plan'],
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
