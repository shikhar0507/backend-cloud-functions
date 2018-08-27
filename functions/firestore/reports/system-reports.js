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

          if (!userRecord) return;

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
