'use strict';

const sgMail = require('@sendgrid/mail');
const {
  sgMailApiKey,
  systemEmail,
} = require('../../admin/env');
const {
  users,
} = require('../../admin/admin');

sgMail.setApiKey(sgMailApiKey);

module.exports = (change) => {
  const {
    report,
    include,
    cc,
  } = change.after.data();

  console.log({
    report,
  });
  const locals = {
    change,
    sgMail,
    messageObject: {
      cc,
      to: [],
      attachments: [],
      from: systemEmail,
      'dynamic_template_data': {},
    },
  };

  const authFetch = [];

  include.forEach((phoneNumber) =>
    authFetch.push(users.getUserByPhoneNumber(phoneNumber)));

  return Promise
    .all(authFetch)
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record.uid) return;

        const email = record.email;
        const disabled = record.disabled;
        const emailVerified = record.emailVerified;

        if (!email) return;
        if (!emailVerified) return;
        if (disabled) return;

        locals.messageObject.to.push({
          email,
          name: record.displayName || '',
        });
      });

      if (locals.messageObject.to.length === 0) return Promise.resolve();

      if (report === 'signUp') return require('./sign-up-report')(change, sgMail);

      if (report === 'install') return require('./install-report')(change, sgMail);

      if (report === 'footprints') return require('./footprints-report')(locals);

      return Promise.resolve();
    })
    .catch((error) => JSON.stringify(error));


};
