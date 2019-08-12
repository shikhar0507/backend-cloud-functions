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
  db,
  rootCollections,
} = require('../admin/admin');
const {
  getRelevantTime,
} = require('../admin/utils');
const {
  reportNames,
  dateFormats,
} = require('../admin/constants');
const moment = require('moment');
const env = require('../admin/env');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const admin = require('firebase-admin');
const momentTz = require('moment-timezone');
const rpn = require('request-promise-native');
const url = require('url');


const sendErrorReport = async () => {
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

  const docs = await rootCollections
    .errors
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

  docs.docs.forEach((doc) => {
    if (doc.get('skipFromErrorReport')) return;

    messageBody += `${getHTMLString(doc, index)}\n\n`;

    index++;
  });

  const subject = `${process.env.GCLOUD_PROJECT}`
    + ` Frontend Errors ${today.format(dateFormats.DATE)}`;

  return sgMail
    .send({
      subject,
      to: env.instantEmailRecipientEmails,
      from: { name: 'Growthile', email: env.systemEmail },
      html: messageBody,
    });
};

const runQuery = (query, resolve, reject) => {
  return query
    .get()
    .then((docs) => {
      if (docs.empty) {
        return 0;
      }

      const batch = db.batch();

      docs.forEach((doc) => {
        const scheduleArray = doc.get('schedule');

        batch.set(doc.ref, {
          addendumDocRef: null,
          relevantTime: getRelevantTime(scheduleArray),
        }, {
            merge: true,
          });
      });

      /* eslint-disable */
      return batch
        .commit()
        .then(() => docs.docs[docs.size - 1]);
      /* eslint-enable */
    })
    .then(lastDoc => {
      if (!lastDoc) return resolve();

      return process
        .nextTick(() => {
          const newQuery = query
            // Using greater than sign because we need
            // to start after the last activity which was
            // processed by this code otherwise some activities
            // might be updated more than once.
            .where(admin.firestore.FieldPath.documentId(), '>', lastDoc.id);

          return runQuery(newQuery, resolve, reject);
        });
    })
    .catch(reject);
};

const handleRelevantTime = () => {
  const start = momentTz()
    .subtract('1', 'day')
    .startOf('day')
    .valueOf();
  const end = momentTz()
    .subtract('1', 'day')
    .endOf('day')
    .valueOf();

  const query = rootCollections
    .activities
    .where('relevantTime', '>=', start)
    .where('relevantTime', '<=', end)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(250);

  return new Promise((resolve, reject) => {
    return runQuery(query, resolve, reject);
  });
};

const setBackblazeIdToken = async timerDoc => {
  const getKeyId = (applicationKey, keyId) => {
    return `${keyId}:${applicationKey}`;
  };

  const applicationKey = env.backblaze.apiKey;
  const keyId = env.backblaze.keyId;
  const keyWithPrefix = getKeyId(applicationKey, keyId);
  const authorization =
    `Basic ${new Buffer(keyWithPrefix).toString('base64')}`;

  try {
    const uri = url.resolve('https://api.backblazeb2.com', '/b2api/v2/b2_authorize_account');

    const response = await rpn(uri, {
      headers: {
        Authorization: authorization,
      },
      json: true,
    });

    return timerDoc
      .ref
      .set({
        apiUrl: response.apiUrl,
        backblazeAuthorizationToken: response.authorizationToken,
        downloadUrl: response.downloadUrl,
      }, {
          merge: true,
        });
  } catch (error) {
    console.error(error);
  }
};

const deleteInstantDocs = async () => {
  const momentToday = momentTz();
  const hundredDaysBeforeMoment = momentToday.subtract(100, 'days');
  const batch = db.batch();

  // Delete docs older than 100 days
  const docs = await rootCollections
    .instant
    .where('timestamp', '<=', hundredDaysBeforeMoment.valueOf())
    .get();


  docs.forEach(doc => batch.delete(doc.ref));

  return batch.commit();
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

    env
      .instantEmailRecipientEmails
      .forEach(email => {
        const html = `<p>Date (DD-MM-YYYY): `
          + `${timerDoc.id}</p>
            <p>Timestamp:`
          + ` ${new Date(timerDoc.get('timestamp')).toJSON()}</p>`;
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

    await Promise
      .all([
        sgMail.sendMultiple(messages),
        sendErrorReport(),
        setBackblazeIdToken(timerDoc)
      ]);

    const momentYesterday = moment()
      .subtract(1, 'day')
      .startOf('day');

    const [
      recipientsQuery,
      counterDocsQuery,
    ] = await Promise
      .all([
        rootCollections
          .recipients
          .get(),
        rootCollections
          .inits
          .where('report', '==', reportNames.DAILY_STATUS_REPORT)
          .where('date', '==', momentYesterday.date())
          .where('month', '==', momentYesterday.month())
          .where('year', '==', momentYesterday.year())
          .limit(1)
          .get(),
      ]);

    const batch = db.batch();

    recipientsQuery
      .forEach(doc => {
        batch
          .set(doc.ref, { timestamp: Date.now() }, { merge: true });
      });

    batch.set(counterDocsQuery.docs[0].ref, {
      /**
       * Storing this value in the daily status report counts doc in order
       * to check if all reports have finished their work.
       */
      expectedRecipientTriggersCount: recipientsQuery.size,
      recipientsTriggeredToday: 0,
    }, {
        merge: true,
      });

    await batch.commit();

    return deleteInstantDocs();

  } catch (error) {
    console.error(error);
  }
};
