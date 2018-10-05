'use strict';

const {
  db,
  users,
  rootCollections,
} = require('../admin/admin');
const sgMail = require('@sendgrid/mail');
const {
  sgMailApiKey,
  systemEmail,
} = require('../admin/env');

sgMail.setApiKey(sgMailApiKey);


module.exports = (doc) => {
  if (doc.get('sent')) {
    // Helps to check if email is sent already. Cloud functions sometimes trigger multiple times
    // For a single write.
    console.log('double trigger', 'sent', doc.get('sent'));

    return Promise.resolve();
  }

  return Promise
    .all([
      db
        .doc(doc.ref.path)
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

        if (displayName) {
          html += `<p>Hi ${displayName}</p>`;
        }

        messages.push({
          html,
          subject: 'FROM Timer function',
          to: {
            email,
            name: displayName,
          },
          from: systemEmail,
        });
      });

      console.log({ messages, });

      return sgMail.sendMultiple(messages);
    })
    .then(() => rootCollections
      .recipients
      .get()
    )
    .then((docs) => {
      const batch = db.batch();
      const date = new Date().toDateString();

      docs
        .forEach(
          (doc) => batch.set(doc.ref, {
            date,
          }, {
              merge: true,
            })
        );

      return batch.commit();
    })
    .catch(console.error);
};
