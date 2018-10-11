/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */


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
