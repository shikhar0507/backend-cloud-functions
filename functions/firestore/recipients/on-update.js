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
  db,
} = require('../../admin/admin');
const {
  reportNames,
  dateFormats,
  sendGridTemplateIds,
} = require('../../admin/constants');
const {
  isValidDate,
  handleDailyStatusReport,
} = require('../../admin/utils');
const env = require('../../admin/env');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const momentTz = require('moment-timezone');
const admin = require('firebase-admin');

const getTemplateId = (report) => {
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
    timestamp,
  } = change.after.data();

  const valuesPolyfill = (object) => {
    return Object.keys(object).map((key) => object[key]);
  };

  if (!isValidDate(timestamp)) {
    /**
     * This check is required since writing invalid value to
     *  this function might spoil data in the `/Monthly` docs.
     */
    throw new Error('Invalid timestamp passed');
  }

  /**
   * A temporary polyfill for using `Object.values` since sendgrid has
   * probably removed support for Node 6, but the Node 8 runtime is still
   * suffering from "connection error" issue at this time.
   * Will remove this after a few days.
   *
   * @see https://github.com/sendgrid/sendgrid-nodejs/issues/929
   * @see https://github.com/firebase/firebase-functions/issues/429
   */
  Object.values = Object.values || valuesPolyfill;

  const locals = {
    change,
    sgMail,
    // Used for exiting early in .then() clauses if init docs query is empty.
    sendMail: true,
    sendNotifications: true,
    sendSMS: true,
    createOnlyData: false,
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

  console.log({ report });

  const authFetch = [];

  include
    .forEach((phoneNumber) => {
      authFetch
        .push(users.getUserByPhoneNumber(phoneNumber.trim()));
    });

  const usersWithoutEmailOrVerifiedEmail = [];
  const withNoEmail = new Set();
  const withUnverifiedEmail = new Set();
  const unverifiedOrEmailNotSetPhoneNumbers = [];
  const verificationBugCustomClaimPromises = [];
  const uidMap = new Map();
  const batch = db.batch();

  return Promise
    .all(authFetch)
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!record.uid) {
          unverifiedOrEmailNotSetPhoneNumbers.push(phoneNumber);

          return;
        }

        if (record.disabled) return;

        uidMap.set(phoneNumber, record.uid);

        if (!record.email || !record.emailVerified) {
          const promise = rootCollections
            .updates
            .doc(record.uid)
            .get();

          unverifiedOrEmailNotSetPhoneNumbers.push(phoneNumber);

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
        locals.createOnlyData = true;
      }

      // Regardless of recipients status, data is
      // created. Emails, though are not sent.
      if (report === reportNames.PAYROLL) {
        return require('./payroll-report')(locals);
      }

      if (report === reportNames.FOOTPRINTS) {
        return require('./footprints-report')(locals);
      }

      if (locals.messageObject.to.length === 0) {
        locals.sendMail = false;

        return Promise.resolve();
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
      if (!locals.sendMail) {
        return Promise.resolve(null);
      }

      const notifications = [];

      snapShot.forEach((doc) => {
        if (!doc.exists) return;

        const { registrationToken } = doc.data();

        if (!registrationToken) return;

        const message = (() => {
          const part =
            `You have been added as a recipient for the`
            + ` report ${report} on Growthfile`;

          if (withNoEmail.has(doc.id)) {
            return `${part}. Please set your email to receice reports`;
          }

          return `${part}. Please verifiy your email to receive reports.`;
        })();

        const promise = admin
          .messaging()
          .sendToDevice(registrationToken, {
            data: {
              verifyEmail: JSON.stringify({
                body: message,
                title: 'Reminder',
              }),
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
    .then(() => {
      if (!locals.sendMail) {
        return Promise.resolve(null);
      }

      const momentYesterday = momentTz().subtract(1, 'day');

      return rootCollections
        .inits
        .where('date', '==', momentYesterday.date())
        .where('month', '==', momentYesterday.month())
        .where('year', '==', momentYesterday.year())
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .limit(1)
        .get();
    })
    .then((snapShot) => {
      if (!locals.sendMail) {
        return Promise.resolve(null);
      }

      const dailyStatusDoc = snapShot.docs[0];
      const data = dailyStatusDoc.data();
      const office = locals.officeDoc.get('office');
      const expectedRecipientTriggersCount = dailyStatusDoc.get('expectedRecipientTriggersCount');
      const recipientsTriggeredToday = dailyStatusDoc.get('recipientsTriggeredToday');

      data
        .unverifiedRecipients = {
          [office]: unverifiedOrEmailNotSetPhoneNumbers,
        };
      data.recipientsTriggeredToday = recipientsTriggeredToday + 1;

      batch.set(dailyStatusDoc.ref, data, {
        merge: true,
      });

      const promises = [
        verificationBugCustomClaimPromises,
        batch
          .commit(),
      ];

      /**
       * When all recipient function instances have completed their work,
       * we trigger the daily status report. We are doing this because
       */
      if (expectedRecipientTriggersCount === recipientsTriggeredToday) {
        promises.push(handleDailyStatusReport());
      }

      return Promise.all(promises);
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
