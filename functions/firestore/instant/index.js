'use strict';

const sgMail = require('@sendgrid/mail');

sgMail.setApiKey('');

module.exports = (doc, context) => {
  // runs on doc creation in Instant collection.
  // sends an email about the thing happened.
};
