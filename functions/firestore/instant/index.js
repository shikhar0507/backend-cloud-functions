'use strict';

const sgMail = require('@sendgrid/mail');
const constants = require('../../admin/attachment-types');

const env = require('../../admin/env');

const templateId = constants.sgMailTemplateIds.get('instantEmails');
const substitutionWrappers = constants.substitutionWrappers;

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
      templateId,
      substitutionWrappers,
      substitutions: {
        subject: doc.get('subject'),
        body: doc.get('body'),
      },
    })
    .catch((error) => {
      console.error(error.response);

      return Promise.reject(error.response);
    });
