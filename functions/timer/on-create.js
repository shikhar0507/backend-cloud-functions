'use strict';

const {
  db,
  users,
  rootCollections,
} = require('../admin/admin');
const {
  getISO8601Date,
} = require('../admin/utils');
const sgMail = require('@sendgrid/mail');
const {
  sgMailApiKey,
} = require('../admin/env');

sgMail.setApiKey(sgMailApiKey);

const getYesterdaysDateString = () =>
  new Date(new Date().setDate(new Date().getDate() - 1)).toDateString();


// data queried from /Inits collection for yesterday.
const manageReports = (initDocs) => {
  console.log({
    initDocs: initDocs.size,
  });

  const addedReportQueries = [];
  const installReportQueries = [];
  const dataObject = {};
  const employeesData = {};

  initDocs.forEach((doc) => {
    const {
      installs,
      phoneNumber,
      office,
      report,
      employeesObject,
    } = doc.data();

    console.log({
      office: doc.get('office'),
    });

    employeesData[office] = employeesObject;

    if (report === 'added') {
      const query = rootCollections
        .recipients
        .where('office', '==', office)
        .where('report', '==', 'added')
        .get();

      addedReportQueries.push(query);
    }

    if (report === 'install') {
      dataObject[office] = {
        [phoneNumber]: installs,
      };

      const query = rootCollections
        .recipients
        .where('office', '==', office)
        .where('report', '==', 'install')
        .get();

      installReportQueries.push(query);
    }
  });

  return Promise
    .all(addedReportQueries)
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          batch.set(doc.ref, {
            employeesObject: employeesData[doc.get('office')],
          }, {
              merge: true,
            });
        });
      });

      return batch.commit();
    })
    .then(() => Promise.all(installReportQueries))
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          batch.set(doc.ref, {
            dataObject: dataObject[doc.get('office')],
          }, {
              merge: true,
            });
        });
      });

      return batch.commit();
    })
    .catch(console.error);
};


module.exports = (snap) => {
  if (snap.get('sent')) {
    // Helps to check if email is sent already. Cloud functions sometimes trigger multiple times
    // For a single write.
    console.log('double trigger', snap.get('sent'));

    return Promise.resolve();
  }

  return Promise.all([
    db
      .doc(db.doc(snap.ref.path))
      .set({
        sent: true,
      }, {
          merge: true,
        }),
    rootCollections
      .recipients
      .doc('spUi8tAiqGXCQxRvqaW7')
      .get()
  ])
    .then((result) => {
      const reportDoc = result[1];

      console.log({
        reportDoc: reportDoc.data(),
      });

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
        <p>Date (DD-MM-YYYY): ${snap.id}</p>
        <p>Timestamp: ${snap.get('timestamp').toDate()}</p>
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
