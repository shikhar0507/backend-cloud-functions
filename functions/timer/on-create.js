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
const {
  getISO8601Date,
} = require('../admin/utils');

sgMail.setApiKey(sgMailApiKey);

module.exports = (snap) =>
  db
    .doc('/Recipients/spUi8tAiqGXCQxRvqaW7')
    .get()
    .then((reportDoc) => {
      if (!reportDoc.exists) return Promise.resolve();

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

        console.log({ email, emailVerified, disabled, displayName, });

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
          from: 'help@growthfile.com',
        });
      });

      console.log({ messages, });

      return sgMail.sendMultiple(messages);
    })
    .then(() => rootCollections
      .inits
      .where(
        'date',
        '==',
        moment().subtract(1, 'day').format('DD-MM-YYYY')
      )
      .get()
    )
    .then((docs) => {
      const queries = [];

      docs.forEach((doc) => {
        queries
          .push(rootCollections
            .reports
            .where('office', '==', doc.get('office'))
            .where('report', '==', doc.get('report'))
            /** Office and report combination is unique */
            .limit(1)
            .get()
          );
      });

      return Promise.all(queries);
    })
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        batch.set(snapShot
          .docs[0]
          .ref, {
            date: getISO8601Date(),
          });
      });

      return batch.commit();
    })
    .catch(console.error);
