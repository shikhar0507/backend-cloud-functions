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

const { db, rootCollections } = require('../admin/admin');
const { reportNames, dateFormats } = require('../admin/constants');
const moment = require('moment');
const env = require('../admin/env');
const sgMail = require('@sendgrid/mail');
const momentTz = require('moment-timezone');
const rpn = require('request-promise-native');
const url = require('url');
const SERVICE_NAME = `[timer][on-create]`;

sgMail.setApiKey(env.sgMailApiKey);

const sendErrorReport = async () => {
  try {
    const today = momentTz().subtract(1, 'days');

    const getHTMLString = (doc, index) => {
      return `
    <h2>${index + 1}. Error message: ${doc.get('message')} | ${doc.id}</h2>
    <h3>First Occurrance: ${doc.createTime.toDate()}</h3>
    <h3>Last Occurrance: ${doc.updateTime.toDate()}</h3>
    <h3>Affected Users</h3>
    <p>${Object.keys(doc.get('affectedUsers'))}</p>
    <h3>Error Body</h3>
    <p><pre>${JSON.stringify(doc.get('bodyObject'), ' ')}</pre></p>
    <h3>Error Device</h3>
    <p><pre>${JSON.stringify(doc.get('deviceObject'), ' ')}</pre></p>
    <hr>`;
    };

    const docs = await rootCollections.errors
      .where('date', '==', today.date())
      .where('month', '==', today.month())
      .where('year', '==', today.year())
      .get();

    if (docs.empty) {
      // No errors yesterday
      return;
    }

    let messageBody = '';
    let index = 0;

    docs.docs.forEach(doc => {
      if (doc.get('skipFromErrorReport')) return;

      messageBody += `${getHTMLString(doc, index)}\n\n`;

      index++;
    });

    // No loggable errors for the day
    if (!messageBody) return;

    const subject =
      `${process.env.GCLOUD_PROJECT}` +
      ` Frontend Errors ${today.format(dateFormats.DATE)}`;

    return sgMail.send({
      subject,
      to: env.instantEmailRecipientEmails,
      from: {
        name: 'Growthile',
        email: env.systemEmail,
      },
      html: messageBody,
    });
  } catch (error) {
    console.error(
      `${SERVICE_NAME}[sendErrorReport][catch][error] ${error.message}`,
    );
  }
};

const fetchExternalTokens = async timerDoc => {
  try {
    const getKeyId = (applicationKey, keyId) => {
      return `${keyId}:${applicationKey}`;
    };

    const keyWithPrefix = getKeyId(env.backblaze.apiKey, env.backblaze.keyId);
    const authorization = `Basic ${new Buffer(keyWithPrefix).toString(
      'base64',
    )}`;

    const uri = url.resolve(
      'https://api.backblazeb2.com',
      '/b2api/v2/b2_authorize_account',
    );

    const response = await rpn(uri, {
      headers: { Authorization: authorization },
      json: true,
    });

    return timerDoc.ref.set(
      {
        apiUrl: response.apiUrl,
        backblazeAuthorizationToken: response.authorizationToken,
        downloadUrl: response.downloadUrl,
      },
      { merge: true },
    );
  } catch (error) {
    console.error(
      `${SERVICE_NAME}[fetchExternalTokens][catch][error] ${error.message}`,
    );
  }
};

const deleteInstantDocs = async () => {
  try {
    const momentToday = momentTz();
    const hundredDaysBeforeMoment = momentToday.subtract(100, 'days');
    const batch = db.batch();

    // Delete docs older than 100 days
    const docs = await rootCollections.instant
      .where('timestamp', '<=', hundredDaysBeforeMoment.valueOf())
      .get();

    const instantCallback = doc => batch.delete(doc.ref);

    docs.forEach(instantCallback);

    return batch.commit();
  } catch (error) {
    console.error(
      `${SERVICE_NAME}[deleteInstantDocs][catch][error] ${error.message}`,
    );
  }
};

module.exports = async timerDoc => {
  if (timerDoc.get('sent')) {
    // Helps to check if email is sent already.
    // Cloud functions sometimes trigger multiple times
    // For a single write.
    return;
  }

  try {
    await timerDoc.ref.set({ sent: true }, { merge: true });

    const messages = [];

    env.instantEmailRecipientEmails.forEach(email => {
      const html =
        `<p>Date (DD-MM-YYYY): ` +
        `${timerDoc.id}</p>
            <p>Timestamp:` +
        ` ${new Date(timerDoc.get('timestamp')).toJSON()}</p>`;
      const message = {
        html,
        cc: '',
        subject: 'FROM Timer function',
        to: email,
        from: {
          name: 'Growthfile',
          email: env.systemEmail,
        },
      };

      messages.push(message);
    });

    await Promise.all([
      sgMail.sendMultiple(messages),
      sendErrorReport(),
      fetchExternalTokens(timerDoc),
    ]);

    const momentYesterday = moment().subtract(1, 'day').startOf('day');

    const [recipientsQuery, counterDocsQuery] = await Promise.all([
      rootCollections.recipients.get(),
      rootCollections.inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', momentYesterday.date())
        .where('month', '==', momentYesterday.month())
        .where('year', '==', momentYesterday.year())
        .limit(1)
        .get(),
    ]);

    const batch = db.batch();

    const recipientCallback = doc =>
      batch.set(doc.ref, { timestamp: Date.now() }, { merge: true });

    recipientsQuery.forEach(recipientCallback);

    if (env.isProduction) {
      batch.set(
        counterDocsQuery.docs[0].ref,
        {
          /**
           * Storing this value in the daily status report counts doc in order
           * to check if all reports have finished their work.
           */
          expectedRecipientTriggersCount: recipientsQuery.size,
          recipientsTriggeredToday: 0,
        },
        { merge: true },
      );
    }

    await batch.commit();

    await deleteInstantDocs();

    module.exports = async () => {
      if (!env.isProduction) {
        return;
      }
      const url =
        'https://us-central1-growthfilems.cloudfunctions.net/api/timer';
      const timer = await rpn(url, {
        json: true,
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.growthfileMsToken}`,
        },
        body: undefined,
      });
      console.log('resp', timer);
    };
  } catch (error) {
    console.error(
      `${SERVICE_NAME}[module.exports][catch][error] ${error.message}`,
    );
  }
};
