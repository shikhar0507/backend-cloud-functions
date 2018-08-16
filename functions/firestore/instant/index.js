'use strict';

const sgMail = require('@sendgrid/mail');
const env = require('../../admin/env');

const sgMailApiKey = env.sgMailApiKey;
const to = env.to;
const from = env.from;

sgMail.setApiKey(sgMailApiKey);

module.exports = (doc) =>
  sgMail
    .send({
      to,
      from,
      subject: doc.get('subject'),
      html: doc.get('html'),
    })
    .catch((error) => {
      console.error(error.response);

      return Promise.reject(error.response);
    });
