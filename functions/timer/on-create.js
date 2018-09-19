'use strict';

const {
  db,
  users,
  serverTimestamp,
  rootCollections,
} = require('../admin/admin');
const sgMail = require('@sendgrid/mail');
const moment = require('moment');
const sgMailApiKey = require('../admin/env').sgMailApiKey;

sgMail.setApiKey(sgMailApiKey);

module.exports = (snap) =>
  db
    .doc('/Recipients/spUi8tAiqGXCQxRvqaW7')
    .get()
    .then((reportDoc) => {
      if (!reportDoc.exists) {
        console.log('No mails send. Doc does not exist');

        return Promise.resolve();
      }

      const include = reportDoc.get('include');
      const authFetchPromises = [];

      include.forEach(
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

        if (!userRecord) return;

        const email = record.email;
        const emailVerified = record.emailVerified;
        const disabled = record.disabled;
        const displayName = record.displayName || '';

        console.log({ email, emailVerified, disabled, displayName, });

        if (!email) return;
        if (!emailVerified) return;
        if (disabled) return;

        const html = `
        <p>Date (DD-MM-YYYY): ${snap.id}</p>
        <p>Timestamp: ${snap.get('timestamp').toDate()}</p>
        `;

        messages.push({
          html,
          subject: 'FROM Timer function',
          to: {
            email,
            name: displayName,
          },
          from: 'help@growthfile.com',
        });
      });

      console.log({ messages, });

      return sgMail.sendMultiple(messages);
    })
    .then(() => Promise.all([
      rootCollections
        .inits
        .where('event', '==', 'added')
        .where('date', '<', moment().subtract(1, 'day').format('DD-MM-YYYY'))
        .get(),
      rootCollections
        .inits
        .where('event', '==', 'install')
        .where('date', '==', moment().subtract(1, 'day').format('DD-MM-YYYY'))
        .get(),
    ]))
    .then((docs) => {
      const [
        addedDocs,
        installDocs,
      ] = docs;
      const queries = [];

      addedDocs.forEach((doc) => {
        queries.push(rootCollections
          .reports
          .where('report', '==', 'added')
          .where('office', '==', doc.get('office'))
          .get());
      });

      installDocs.forEach((doc) => {
        queries.push(rootCollections
          .reports
          .where('report', '==', 'install')
          .where('office', '==', doc.get('office'))
          .get());
      });

      return Promise.all(queries);
    })
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          batch.set(doc.ref, {
            timestamp: serverTimestamp,
          });
        });
      });

      return batch.commit();
    })
    .catch(console.error);
