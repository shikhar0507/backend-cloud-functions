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


const {
  users,
  rootCollections,
} = require('../../admin/admin');
const {
  reportNames,
  dateFormats,
  sendGridTemplateIds,
} = require('../../admin/constants');
const env = require('../../admin/env');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const momentTz = require('moment-timezone');
const admin = require('firebase-admin');



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

  if (report === reportNames.ENQUIRY) {
    return sendGridTemplateIds.enquiry;
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

  if (include.length === 0) {
    locals.sendMail = false;

    return Promise.resolve();
  }

  // Not sending emails when someone is added to or removed from the recipients
  // list
  // if (change.before.data()
  //   && change.before.get('include').length !== change.after.get('include').length) {
  //   locals.sendMail = false;

  //   return Promise.resolve();
  // }

  console.log({ report });

  const authFetch = [];

  include
    .forEach((phoneNumber) =>
      authFetch.push(users.getUserByPhoneNumber(phoneNumber)));

  const usersWithoutEmailOrVerifiedEmail = [];
  const withNoEmail = new Set();
  const withUnverifiedEmail = new Set();

  return Promise
    .all(authFetch)
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record.uid) return;
        if (record.disabled) return;

        if (!record.email || !record.emailVerified) {
          const promise = rootCollections
            .updates
            .doc(record.uid)
            .get();

          if (!record.email) withNoEmail.add(record.uid);
          if (!record.emailVerified) withUnverifiedEmail.add(record.uid);

          usersWithoutEmailOrVerifiedEmail.push(promise);

          return;
        }

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
        return Promise.resolve(null);
      }

      if (officeDoc.get('status') === 'CANCELLED') {
        locals.sendMail = false;

        return Promise.resolve();
      }

      locals.officeDoc = officeDoc;
      locals.messageObject.templateId = getTemplateId(report);
      locals.timezone = officeDoc.get('attachment.Timezone.value');
      locals.standardDateString = momentTz()
        .utc()
        .clone()
        .tz(locals.timezone)
        .format(dateFormats.DATE);

      if (locals.messageObject.to.length === 0) {
        // No assignees, only creating data for the day, but 
        // not sending emails...
        // Applicable only to the payroll report
        locals.createOnlyData = true;
      }

      // Regardless of recipients status, data is
      // created. Emails, though are not sent.
      if (report === reportNames.PAYROLL) {
        return require('./payroll-report')(locals);
      }

      if (locals.messageObject.to.length === 0) {
        locals.sendMail = false;

        return Promise.resolve();
      }

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

      if (report === reportNames.ENQUIRY) {
        return require('./enquiry-report')(locals);
      }

      return Promise.resolve(null);
    })
    .then(() => Promise.all(usersWithoutEmailOrVerifiedEmail))
    .then((snapShot) => {
      const notifications = [];

      snapShot.forEach((doc) => {
        if (!doc.exists) return;

        const {
          registrationToken,
        } = doc.data();

        if (!registrationToken) return;

        const message = (() => {
          const part = `You have been added as a recipient for the report ${report} on Growthfile`;

          if (withNoEmail.has(doc.id)) {
            return `${part}. Please set your email to receice reports`;
          }

          return `${part}. Please verifiy your email to receive reports.`;
        })();

        const promise = admin
          .messaging()
          .sendToDevice(registrationToken, {
            data: {
              verifyEmail: '1',
            },
            notification: {
              body: message,
              title: 'Growthfile',
            },
          });

        notifications.push(promise);
      });

      return Promise.all(notifications);
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

      console.error(errorObject);
    });
};
