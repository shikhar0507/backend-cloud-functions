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


const { rootCollections, users, } = require('../../admin/admin');
const sgMail = require('@sendgrid/mail');
const sgMailApiKey = require('../../admin/env').sgMailApiKey;

sgMail.setApiKey(sgMailApiKey);


const sendMails = (recipientsDoc, instantDoc) => {
  const { include, cc, } = recipientsDoc.data();
  const { subject, messageBody, } = instantDoc.data();

  const promises = [];

  include.forEach(
    (phoneNumber) => promises.push(users.getUserByPhoneNumber(phoneNumber))
  );

  const messages = [];

  return Promise
    .all(promises)
    .then((userRecords) => {
      userRecords
        .forEach((userRecord) => {
          const phoneNumber = Object.keys(userRecord)[0];
          const record = userRecord[`${phoneNumber}`];

          if (!record) return;

          const email = record.email;
          const emailVerified = record.emailVerified;
          const disabled = record.disabled;
          const displayName = record.displayName || '';

          if (!email) return;
          if (!emailVerified) return;
          if (disabled) return;

          messages.push({
            cc,
            subject,
            html: messageBody,
            to: {
              email,
              name: displayName,
            },
            from: cc,
          });
        });

      /**
       * No emails to be sent since none of the assignees have
       * `email` in their `auth` or all of them are `disabled`.
       */
      if (messages.length === 0) return Promise.resolve();

      console.log({ messages, });

      return sgMail.sendMultiple(messages);
    })
    .catch(console.error);
};


module.exports = (instantDoc) =>
  rootCollections
    .reports
    .doc('systemReports')
    .collection('Recipients')
    .doc('KlQM9EzrYfTzE2cjExFp')
    .get()
    .then((recipientsDoc) => sendMails(recipientsDoc, instantDoc))
    .catch(console.error);
