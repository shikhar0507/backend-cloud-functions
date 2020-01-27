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

const { rootCollections, db } = require('../../admin/admin');
const {
  reportNames,
  dateFormats,
  sendGridTemplateIds,
} = require('../../admin/constants');
const {
  getAuth,
  isValidDate,
  handleDailyStatusReport,
} = require('../../admin/utils');
const env = require('../../admin/env');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const momentTz = require('moment-timezone');

const getTemplateId = report => {
  if (report === reportNames.FOOTPRINTS) {
    return sendGridTemplateIds.footprints;
  }

  if (report === reportNames.PAYROLL) {
    return sendGridTemplateIds.payroll;
  }

  if (report === reportNames.REIMBURSEMENT) {
    return sendGridTemplateIds.reimbursement;
  }

  if (report === reportNames.PAYROLL_MASTER) {
    return sendGridTemplateIds.payrollMaster;
  }

  return null;
};

const getSubject = (report, office, dateString) => {
  let start = '';

  if (report === 'footprints') {
    start += 'Footprints';
  }

  if (report === 'payroll') {
    start += 'Payroll';
  }

  if (report === 'reimbursement') {
    start += `Reimbursement`;
  }

  return `${start} Report_${office}_${dateString}`;
};

module.exports = async change => {
  const {
    cc,
    report,
    office,
    include,
    officeId,
    timestamp,
  } = change.after.data();
  const unverifiedRecipients = [];
  const uidMap = new Map();
  const batch = db.batch();

  if (!isValidDate(timestamp)) {
    /**
     * This check is required since writing invalid value to
     *  this function might spoil data in the `/Monthly` docs.
     */
    return;
  }

  const todaysPlus1DayEnd = momentTz()
    .add(1, 'day')
    .endOf('day');

  if (momentTz(timestamp).isAfter(todaysPlus1DayEnd) || include.length === 0) {
    console.log('is after +1 day');

    return;
  }

  try {
    const officeDoc = await rootCollections.offices.doc(officeId).get();

    if (officeDoc.get('status') === 'CANCELLED') {
      return;
    }

    const timezone = officeDoc.get('attachment.Timezone.value');
    const fmtDate = momentTz(timestamp)
      .tz(timezone)
      .format(dateFormats.DATE);
    const authPromises = [];
    const locals = {
      change,
      sgMail,
      officeDoc,
      templateId: getTemplateId(report),
      messageObject: {
        cc,
        to: [],
        replyTo: env.mailReplyTo,
        attachments: [],
        templateId: getTemplateId(report),
        /** For sendGrid data collection */
        customArgs: {
          office: change.after.get('office'),
          recipientId: change.after.id,
          reportName: change.after.get('report'),
          emailSentAt: Date.now(),
        },
        from: { name: 'Growthfile', email: env.systemEmail },
        dynamic_template_data: {
          office: change.after.get('office'),
          subject: getSubject(report, office, fmtDate),
          date: fmtDate,
        },
      },
    };

    include.forEach(phoneNumber => authPromises.push(getAuth(phoneNumber)));

    (await Promise.all(authPromises)).forEach(
      ({ uid, phoneNumber, email, emailVerified, disabled, displayName }) => {
        if (!uid) {
          unverifiedRecipients.push(phoneNumber);

          return;
        }

        if (disabled) {
          return;
        }

        uidMap.set(phoneNumber, uid);

        if (!email || !emailVerified) {
          unverifiedRecipients.push(phoneNumber);

          return;
        }

        locals.messageObject.to.push({ email, name: displayName || '' });
      },
    );

    if (report === reportNames.FOOTPRINTS) {
      await require('./footprints-report')(locals);
    }

    if (report === reportNames.PAYROLL) {
      await require('./payroll-report')(locals);
    }

    if (report === reportNames.REIMBURSEMENT) {
      await require('./reimbursements')(locals);
    }

    if (!env.isProduction) {
      return;
    }

    const momentYesterday = momentTz().subtract(1, 'day');
    const {
      docs: [dailyStatusDoc],
    } = await rootCollections.inits
      .where('date', '==', momentYesterday.date())
      .where('month', '==', momentYesterday.month())
      .where('year', '==', momentYesterday.year())
      .where('report', '==', reportNames.DAILY_STATUS_REPORT)
      .limit(1)
      .get();

    // const {
    //   docs: [dailyStatusDoc],
    // } = dailyStatusDocQueryResult;
    const data = dailyStatusDoc.data();
    const expectedRecipientTriggersCount = dailyStatusDoc.get(
      'expectedRecipientTriggersCount',
    );
    const recipientsTriggeredToday = dailyStatusDoc.get(
      'recipientsTriggeredToday',
    );

    data.unverifiedRecipients = { [office]: unverifiedRecipients };
    data.recipientsTriggeredToday = recipientsTriggeredToday + 1;

    batch.set(dailyStatusDoc.ref, data, { merge: true });

    /**
     * When all recipient function instances have completed their work,
     * we trigger the daily status report.
     */
    if (expectedRecipientTriggersCount === recipientsTriggeredToday) {
      await handleDailyStatusReport();
    }

    return batch.commit();
  } catch (error) {
    return console.error({
      error,
      contextData: {
        recipientId: change.after.id,
        office: change.after.get('office'),
        officeId: change.after.get('officeId'),
        report: change.after.get('report'),
      },
    });
  }
};
