'use strict';

const sgMail = require('@sendgrid/mail');
const {
  sgMailApiKey,
} = require('../../admin/env');

sgMail.setApiKey(sgMailApiKey);

module.exports = (change) => {
  const {
    report,
  } = change.after.data();

  console.log({
    report,
  });

  if (report === 'signUp') return require('./sign-up-report')(change, sgMail);

  if (report === 'install') return require('./install-report')(change, sgMail);

  return Promise.resolve();
};
