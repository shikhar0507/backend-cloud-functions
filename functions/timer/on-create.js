'use strict';

const {
  db,
  users,
  rootCollections,
} = require('../admin/admin');
const sgMail = require('@sendgrid/mail');
const {
  sgMailApiKey,
} = require('../admin/env');

sgMail.setApiKey(sgMailApiKey);

const getYesterdaysDateString = () => {
  const today = new Date();

  return new Date(today.setDate(today.getDate() - 1)).toDateString();
};


const manageReports = (initDocs) => {
  console.log({
    initDocs: initDocs.size,
  });

  const date = new Date().toDateString();

  const signUpReportQueries = [];
  const installReportQueries = [];
  const footprintsReportQueries = [];
  const installsObjects = {};
  const employeesData = {};
  const footprintsObject = {};

  initDocs.forEach((doc) => {
    const {
      office,
      report,
      employeesObject,
    } = doc.data();

    console.log({
      office: doc.get('office'),
    });

    if (report === 'signUp') {
      employeesData[office] = employeesObject;

      const query = rootCollections
        .recipients
        .where('office', '==', office)
        .where('report', '==', 'signUp')
        .limit(1)
        .get();

      signUpReportQueries.push(query);
    }

    if (report === 'install') {
      installsObjects[office] = {};

      const query = rootCollections
        .recipients
        .where('office', '==', office)
        .where('report', '==', 'install')
        .limit(1)
        .get();

      installReportQueries.push(query);
    }

    if (report === 'footprints') {
      footprintsObject[office] = {};

      const query = rootCollections
        .recipients
        .where('office', '==', office)
        .where('report', '==', 'footprints')
        .limit(1)
        .get();

      footprintsReportQueries.push(query);
    }
  });

  initDocs.forEach((doc) => {
    const {
      installs,
      phoneNumber,
      office,
      report,
    } = doc.data();

    if (report !== 'install') return;

    installsObjects[office][phoneNumber] = installs;
  });

  return Promise
    .all(signUpReportQueries)
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((snapShot) => {
        console.log('signUp empty:', snapShot.empty, snapShot.size);

        snapShot.forEach((doc) => {
          batch.set(doc.ref, {
            employeesObject: employeesData[doc.get('office')],
          }, {
              merge: true,
            });
        });
      });

      console.log('signUp:', batch._writes);

      return batch.commit();
    })
    .then(() => Promise.all(installReportQueries))
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((snapShot) => {
        console.log('install empty:', snapShot.empty, snapShot.size);

        snapShot.forEach((doc) => {
          batch.set(doc.ref, {
            installsObject: installsObjects[doc.get('office')],
          }, {
              merge: true,
            });
        });
      });

      console.log('installs:', batch._writes);

      return batch.commit();
    })
    .then(() => Promise.all(footprintsReportQueries))
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((snapShot) => {
        console.log('footprints empty:', snapShot.empty, snapShot.size);

        snapShot.forEach((doc) => {
          batch.set(doc.ref, {
            date,
          }, {
              merge: true,
            });
        });
      });

      return batch.commit();
    })
    .catch(console.error);
};


module.exports = (doc) => {
  if (doc.get('sent')) {
    // Helps to check if email is sent already. Cloud functions sometimes trigger multiple times
    // For a single write.
    console.log('double trigger', 'sent', doc.get('sent'));

    return Promise.resolve();
  }

  return Promise
    .all([
      rootCollections
        .timers
        .doc(doc.id)
        .set({
          sent: true,
        }, {
            merge: true,
          }),
      rootCollections
        .recipients
        .doc('Good Morning')
        .get(),
    ])
    .then((result) => {
      const reportDoc = result[1];
      const authFetchPromises = [];

      reportDoc.get('include').forEach(
        (phoneNumber) =>
          authFetchPromises.push(users.getUserByPhoneNumber(phoneNumber))
      );

      return Promise.all(authFetchPromises);
    })
    .then((userRecords) => {
      const messages = [];

      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record.uid) return;

        const email = record.email;
        const emailVerified = record.emailVerified;
        const disabled = record.disabled;
        const displayName = record.displayName || '';

        console.log({
          email,
          emailVerified,
          disabled,
          displayName,
        });

        if (!email) return;
        if (!emailVerified) return;
        if (disabled) return;

        let html = `
        <p>Date (DD-MM-YYYY): ${doc.id}</p>
        <p>Timestamp: ${doc.get('timestamp').toDate()}</p>
        `;

        if (displayName && displayName !== '') {
          html += `<p>Hi ${displayName}</p>`;
        }

        messages.push({
          html,
          subject: 'FROM Timer function',
          to: {
            email,
            name: displayName,
          },
          from: 'gcloud@growthfile.com',
        });
      });

      console.log({ messages, });

      return sgMail.sendMultiple(messages);
    })
    .then(() => rootCollections
      .inits
      .where('date', '==', getYesterdaysDateString())
      .get()
    )
    .then((docs) => manageReports(docs))
    .catch(console.error);
};
