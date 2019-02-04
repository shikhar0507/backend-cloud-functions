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
const {
  users,
  rootCollections,
} = require('../../admin/admin');
const {
  reportNames,
  dateFormats,
  sendGridTemplateIds,
} = require('../../admin/constants');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const momentTz = require('moment-timezone');

const getTemplateId = (report) => {
  if (report === reportNames.SIGNUP) {
    return sendGridTemplateIds.signUps;
  }

  if (report === reportNames.INSTALL) {
    return sendGridTemplateIds.installs;
  }

  if (report === reportNames.FOOTPRINTS) {
    return sendGridTemplateIds.footprints;
  }

  if (report === reportNames.PAYROLL) {
    return sendGridTemplateIds.payroll;
  }

  if (report === reportNames.DSR) {
    return sendGridTemplateIds.dsr;
  }

  if (report === reportNames.DUTY_ROSTER) {
    return sendGridTemplateIds.dutyRoster;
  }

  if (report === reportNames.EXPENSE_CLAIM) {
    return sendGridTemplateIds.expenseClaim;
  }

  if (report === reportNames.LEAVE) {
    return sendGridTemplateIds.leave;
  }

  return null;
};


module.exports = (change) => {
  const {
    report,
    include,
    cc,
    status,
    officeId,
  } = change.after.data();

  const locals = {
    change,
    sgMail,
    // Used for exiting early in .then() clauses if init docs query is empty.
    sendMail: true,
    messageObject: {
      cc,
      to: [],
      attachments: [],
      templateId: getTemplateId(report),
      from: {
        name: 'Growthfile',
        email: env.systemEmail,
      },
      'dynamic_template_data': {},
    },
  };

  if (status === 'CANCELLED') {
    locals.sendMail = false;
    console.log('Activity status is cancelled');

    return Promise.resolve();
  }

  console.log({ report });


  const authFetch = [];

  include
    .forEach((phoneNumber) =>
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

      return rootCollections
        .offices
        .doc(officeId)
        .get();
    })
    .then((officeDoc) => {
      if (!locals.sendMail) {
        return Promise.resolve();
      }

      locals.officeDoc = officeDoc;
      locals.timezone = officeDoc.get('attachment.Timezone.value');
      locals.standardDateString = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .format(dateFormats.DATE);

      locals.messageObject.templateId = getTemplateId(report);

      if (report === reportNames.PAYROLL) {
        if (locals.messageObject.to.length === 0) {
          // No assignees, only creating data for the day, but 
          // not sending emails...
          locals.createOnlyData = true;
        } else {
          locals.messageObject.to.push(env.loggingAccount);
          locals.messageObject.to.push(env.loggingAccount2);
        }

        return require('./payroll-report')(locals);
      }

      if (locals.messageObject.to.length === 0) {
        locals.sendMail = false;

        return Promise.resolve();
      }

      locals.messageObject.to.push(env.loggingAccount);
      locals.messageObject.to.push(env.loggingAccount2);

      if (report === reportNames.SIGNUP) {
        return require('./sign-up-report')(locals);
      }

      if (report === reportNames.INSTALL) {
        return require('./install-report')(locals);
      }

      if (report === reportNames.FOOTPRINTS) {
        return require('./footprints-report')(locals);
      }

      if (report === reportNames.DSR) {
        return require('./dsr-report')(locals);
      }

      if (report === reportNames.DUTY_ROSTER) {
        return require('./duty-roster-report')(locals);
      }

      if (report === reportNames.EXPENSE_CLAIM) {
        return require('./expense-claim-report')(locals);
      }

      if (report === reportNames.LEAVE) {
        return require('./leave-report')(locals);
      }

      return Promise.resolve();
    })
    .catch((error) => {
      const errorObject = {
        error,
        contextData: {
          office: change.after.get('office'),
          officeId: change.after.get('officeId'),
          report: change.after.get('report'),
        },
      };

      // For `sendgrid`, rejection related to their `api` is in the response property
      if (error.response) {
        errorObject.sgMail = error.toString();
      }

      console.error(errorObject);

      const instantDocRef = rootCollections.instant.doc();

      const context = {
        instantDocId: instantDocRef.id,
        data: change.after.data(),
      };

      const messageBody = `<pre>${JSON.stringify(context, ' ', 2)}</pre>`;

      return instantDocRef
        .set({
          subject: `${process.env.FUNCTION_NAME} CRASH`
            + ` ${process.env.GCLOUD_PROJECT}`,
          messageBody,
        });
    });
};
