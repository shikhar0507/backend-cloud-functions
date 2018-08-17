'use strict';

const sgMail = require('@sendgrid/mail');
const env = require('../../admin/env');

const sgMailApiKey = env.sgMailApiKey;
const to = env.to;
const from = env.from;
const replyTo = env.replyTo;

sgMail.setApiKey(sgMailApiKey);

module.exports = (doc) =>
  sgMail
    .send({
      to,
      from,
      replyTo,
      html: doc.get('html'),
      subject: doc.get('subject'),
    })
    .catch((error) => {
      console.error(error.response);

      return Promise.reject(error.response);
    });
