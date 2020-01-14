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

const env = require('../../admin/env');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(env.sgMailApiKey);

module.exports = instantDoc => {
  const messages = [];
  const {subject, messageBody} = instantDoc.data();

  env.instantEmailRecipientEmails.forEach(recipientObject => {
    messages.push({
      subject,
      html: `<pre>${messageBody}</pre>`,
      to: {
        name: recipientObject.name,
        email: recipientObject.email,
      },
      from: env.systemEmail,
    });
  });

  return sgMail.sendMultiple(messages).catch(error => {
    if (error.response) {
      console.error(error.response.body.errors);
    } else {
      console.error(error);
    }
  });
};
