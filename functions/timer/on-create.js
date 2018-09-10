'use strict';

const {
  rootCollections,
  users,
} = require('../admin/admin');
const sgMail = require('@sendgrid/mail');
const sgMailApiKey = require('../admin/env').sgMailApiKey;

sgMail.setApiKey(sgMailApiKey);


module.exports = (snap) =>
  rootCollections
    .reports
    .doc('systemReports')
    .collection('Recipients')
    .doc('KlQM9EzrYfTzE2cjExFp')
    .get()
    .then((doc) => {
      if (!doc.exists) return Promise.resolve();

      const include = doc.get('include');
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
    .catch(console.error);
