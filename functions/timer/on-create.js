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
  rootCollections,
} = require('../admin/admin');
const env = require('../admin/env');

// const config = require('firebase-functions').config();
const sgMail = require('@sendgrid/mail');
// sgMail.setApiKey(config.sgmail.key);
sgMail.setApiKey(env.sgMailApiKey);

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
        .recipients
        .orderBy('activityId')
        .get(),
      doc
        .ref
        .set({
          sent: true,
        }, {
            merge: true,
          }),
    ])
    .then((result) => {
      const [
        recipientsQuery,
      ] = result;

      const messages = [];

      env
        .instantEmailRecipientEmails
        .forEach((email) => {
          const html = `
        <p>Date (DD-MM-YYYY): ${doc.id}</p>
        <p>Timestamp: ${new Date(doc.get('timestamp')).toISOString()}</p>
        `;

          messages.push({
            html,
            cc: env.systemEmail,
            subject: 'FROM Timer function',
            to: email,
            from: env.systemEmail,
          });
        });

      console.log({ messages });

      const batch = db.batch();
      const dateString = new Date().toDateString();

      recipientsQuery
        .forEach((doc) => batch.set(doc.ref, { dateString }, { merge: true }));

      return Promise
        .all([
          sgMail
            .sendMultiple(messages),
          batch
            .commit(),
        ]);
    })
    .catch(console.error);
};
