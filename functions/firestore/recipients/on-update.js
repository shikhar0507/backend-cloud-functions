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
    status,
  } = change.after.data();

  if (status === 'CANCELLED') {
    console.log('Activity status is cancelled.');

    return Promise.resolve();
  }

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
        if (!record.email) return;
        if (!record.emailVerified) return;
        if (record.disabled) return;

        locals.messageObject.to.push({
          email: record.email,
          name: record.displayName || '',
        });
      });

      if (locals.messageObject.to.length === 0) return Promise.resolve();

      if (report === 'signUp') return require('./sign-up-report')(locals);
      if (report === 'install') return require('./install-report')(locals);
      if (report === 'footprints') return require('./footprints-report')(locals);
      if (report === 'payroll') return require('./payroll-report')(locals);

      return Promise.resolve();
    })
    .catch(console.error);
};
