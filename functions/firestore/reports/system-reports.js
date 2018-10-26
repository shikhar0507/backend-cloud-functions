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


const { users } = require('../../admin/admin');
const sgMail = require('@sendgrid/mail');
const env = require('../../admin/env');

sgMail.setApiKey(env.sgMailApiKey);


module.exports = (instantDoc) => {
  const promises = [];

  env
    .internalUsers
    .forEach(
      (phoneNumber) => promises.push(users.getUserByPhoneNumber(phoneNumber))
    );

  const messages = [];

  return Promise
    .all(promises)
    .then((userRecords) => {
      const { subject, messageBody } = instantDoc.data();

      userRecords
        .forEach((userRecord) => {
          const phoneNumber = Object.keys(userRecord)[0];
          const record = userRecord[`${phoneNumber}`];

          if (!record.uid) return;

          const email = record.email;
          const emailVerified = record.emailVerified;
          const disabled = record.disabled;
          const name = record.displayName || '';

          if (!email) return;
          if (!emailVerified) return;
          if (disabled) return;

          messages.push({
            subject,
            cc: '',
            html: messageBody,
            to: { email, name },
            from: env.systemEmail,
          });
        });

      /**
       * No emails to be sent since none of the assignees have
       * `email` in their `auth` or all of them are `disabled`.
       */
      if (messages.length === 0) return Promise.resolve();

      console.log({ messages });

      return sgMail.sendMultiple(messages);
    })
    .catch(console.error);
};
