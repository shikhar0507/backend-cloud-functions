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


const env = require('../../admin/env');
const {
  users,
  rootCollections,
} = require('../../admin/admin');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);


module.exports = (change) => {
  const {
    report,
    include,
    cc,
    status,
  } = change.after.data();

  if (status === 'CANCELLED') {
    console.log('Activity status is cancelled');

    return Promise.resolve();
  }

  console.log({ report });

  const locals = {
    change,
    sgMail,
    messageObject: {
      cc,
      to: [],
      attachments: [],
      from: {
        name: 'Growthfile',
        email: env.systemEmail,
      },
      'dynamic_template_data': {},
    },
  };

  const authFetch = [];

  include
    .forEach((phoneNumber) =>
      authFetch.push(users.getUserByPhoneNumber(phoneNumber)));

  return Promise
    .all(authFetch)
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record.uid) return;
        if (!record.email) return;
        if (!record.emailVerified) return;
        if (record.disabled) return;

        locals.messageObject.to.push({
          email: record.email,
          name: record.displayName || '',
        });
      });

      if (locals.messageObject.to.length === 0) {
        console.log('No recipients with email OR email verified', report);

        return Promise.resolve();
      }

      if (!env.isProduction) {
        locals.messageObject.to = env.internalUsers;
      }

      // Temporary
      locals.messageObject.to.push(env.loggingAccount);

      if (report === 'signup') return require('./sign-up-report')(locals);
      if (report === 'install') return require('./install-report')(locals);
      if (report === 'footprints') return require('./footprints-report')(locals);
      if (report === 'payroll') return require('./payroll-report')(locals);
      if (report === 'dsr') return require('./dsr-report')(locals);
      if (report === 'duty roster') return require('./duty-roster-report')(locals);
      // if (report === 'leave') return require('./leave-report')(locals);

      console.log('No reports sent');

      return Promise.resolve();
    })
    .catch((error) => {
      if (error.response) {
        console.log(error.response.body.errors);
      } else {
        console.error(error);
      }

      const instantDocRef = rootCollections.instant.doc();

      const context = {
        instantDocId: instantDocRef.id,
        data: change.after.data(),
      };

      const messageBody = `<pre>${JSON.stringify(context, ' ', 2)}</pre>`;

      return instantDocRef
        .set({
          subject: `${process.env.FUNCTION_NAME} CRASH`
            + ` ${process.env.GCLOUD_PROJECT}`,
          messageBody,
        });
    });
};
