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
  dateFormats,
  httpsActions,
  reportNames,
  sendGridTemplateIds,
} = require('../admin/constants');
const {
  alphabetsArray,
} = require('../firestore/recipients/report-utils');
const fs = require('fs');
const env = require('../admin/env');
const sgMail = require('@sendgrid/mail');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');

sgMail.setApiKey(env.sgMailApiKey);


const handleDailyStatusReport = () => {
  const fileName = `Growthfile Daily Status Report.xlsx`;
  const filePath = `/tmp/${fileName}`;
  const yesterdayStartMoment =
    momentTz()
      .subtract(1, 'days')
      .startOf('days');
  const yesterdayMomentObject = yesterdayStartMoment.toObject();
  const standardDateString = momentTz().format(dateFormats.DATE);
  const messageObject = {
    templateId: sendGridTemplateIds.dailyStatusReport,
    to: env.instantEmailRecipientEmails,
    from: env.systemEmail,
    attachments: [],
    'dynamic_template_data': {
      date: standardDateString,
      subject: `Daily Status Report_Growthfile_${standardDateString}`,
    },
  };

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', yesterdayMomentObject.date)
        .where('month', '==', yesterdayMomentObject.months)
        .where('year', '==', yesterdayMomentObject.years)
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .where('lastQueryFrom', '>=', yesterdayStartMoment.unix() * 1000)
        .get(),
      rootCollections
        .activityTemplates
        .orderBy('name', 'asc')
        .get(),
      xlsxPopulate
        .fromBlankAsync(),
    ])
    .then((result) => {
      const [
        initDocsQuery,
        profilesDocsQuery,
        activityTemplatesQuery,
        worksheet,
      ] = result;

      if (initDocsQuery.empty) {
        console.log('Timer run. No init doc found', yesterdayMomentObject);

        return Promise.resolve();
      }

      const usersStatusSheet =
        worksheet
          .addSheet('User Status Report');
      const activityStatusSheet =
        worksheet
          .addSheet('Activity Status Report');

      usersStatusSheet
        .row(1)
        .style('bold', true);
      activityStatusSheet
        .row(1)
        .style('bold', true);
      activityStatusSheet
        .column(1)
        .style('bold', true);

      const activeYesterday = profilesDocsQuery.size;

      // Default sheet doesn't consern us. It will show up empty unless removed.
      worksheet
        .deleteSheet('Sheet1');

      [
        'TOTAL USERS',
        'USERS ADDED YESTERDAY',
        'ACTIVE YESTERDAY',
        'INSTALLED YESTERDAY',
      ].forEach((topRowValue, index) => {
        usersStatusSheet
          .cell(`${alphabetsArray[index]}1`)
          .value(topRowValue);
      });

      const {
        totalUsers,
        usersAdded,
        installedToday,
        withAdminApi,
        autoGenerated,
        withSupport,
        createApi,
        commentApi,
        changeStatusApi,
        updateApi,
        shareApi,
        totalActivities,
        activitiesAddedToday,
        templateUsageObject,
      } = initDocsQuery
        .docs[0]
        .data();

      console.log('initDocPath', initDocsQuery.docs[0].ref.path);

      usersStatusSheet
        .cell('A2')
        .value(totalUsers);
      usersStatusSheet
        .cell('B2')
        .value(usersAdded);
      usersStatusSheet
        .cell('C2')
        .value(activeYesterday);
      usersStatusSheet
        .cell('D2')
        .value(installedToday || 0);

      [
        'TOTAL',
        'ADDED YESTERDAY',
        'USING ADMIN API',
        'AUTO GENERATED',
        'WITH SUPPORT',
        'CREATE API',
        'UPDATE API',
        'CHANGE STATUS API',
        'SHARE API',
        'COMMENT API',
      ].forEach((topRowValue, index) => {
        activityStatusSheet
          .cell(`${alphabetsArray[index + 1]}1`)
          .value(topRowValue);
      });

      // A1 and A2 are delibrately left blank for padding the first row...
      activityStatusSheet
        .cell(`A1`)
        .value('');
      activityStatusSheet
        .cell(`A2`)
        .value('');
      activityStatusSheet
        .cell(`B2`)
        .value(totalActivities);
      activityStatusSheet
        .cell(`C2`)
        .value(activitiesAddedToday);
      activityStatusSheet
        .cell(`D2`)
        .value(withAdminApi);
      activityStatusSheet
        .cell(`E2`)
        .value(autoGenerated);
      activityStatusSheet
        .cell(`F2`)
        .value(withSupport);
      activityStatusSheet
        .cell(`G2`)
        .value(createApi);
      activityStatusSheet
        .cell(`H2`)
        .value(updateApi);
      activityStatusSheet
        .cell(`I2`)
        .value(changeStatusApi);
      activityStatusSheet
        .cell(`J2`)
        .value(shareApi);
      activityStatusSheet
        .cell(`K2`)
        .value(commentApi);

      activityTemplatesQuery
        .docs
        .forEach((doc, index) => {
          const rowCount = index + 3;
          const templateName = doc.get('name');

          activityStatusSheet
            .cell(`A${rowCount}`)
            .value(templateName.toUpperCase());

          const getCount = (action) => {
            const DEFAULT_VALUE = `(not used)`;

            if (!templateUsageObject[templateName]) {
              return DEFAULT_VALUE;
            }

            return templateUsageObject[templateName][action] || DEFAULT_VALUE;
          };

          const createApiCount = getCount(httpsActions.create);
          const updateApiCount = getCount(httpsActions.update);
          const changeStatusApiCount = getCount(httpsActions.changeStatus);
          const shareApiCount = getCount(httpsActions.share);
          const commentApiCount = getCount(httpsActions.comment);

          /**
           * G -> create
           * H -> update
           * I -> change-status
           * J -> share
           * K -> comment
           */
          activityStatusSheet
            .cell(`G${rowCount}`)
            .value(createApiCount);
          activityStatusSheet
            .cell(`H${rowCount}`)
            .value(updateApiCount);
          activityStatusSheet
            .cell(`I${rowCount}`)
            .value(changeStatusApiCount);
          activityStatusSheet
            .cell(`J${rowCount}`)
            .value(shareApiCount);
          activityStatusSheet
            .cell(`K${rowCount}`)
            .value(commentApiCount);
        });

      return worksheet
        .toFileAsync(filePath);
    })
    .then(() => {
      messageObject.attachments.push({
        fileName,
        content: new Buffer(fs.readFileSync(filePath)).toString('base64'),
        type: 'text/csv',
        disposition: 'attachment',
      });

      return sgMail
        .sendMultiple(messageObject);
    })
    .catch(console.error);
};


module.exports = (doc) => {
  if (doc.get('sent')) {
    // Helps to check if email is sent already. 
    // Cloud functions sometimes trigger multiple times
    // For a single write.
    console.log('double trigger', 'sent', doc.get('sent'));

    return Promise.resolve();
  }

  return Promise
    .all([
      rootCollections
        .recipients
        .get(),
      handleDailyStatusReport(),
      doc
        .ref
        .set({
          sent: true,
        }, {
            merge: true,
          }),
    ])
    .then((result) => {
      const [
        recipientsQuery,
      ] = result;

      const messages = [];

      env
        .instantEmailRecipientEmails
        .forEach((email) => {
          const html = `
        <p>Date (DD-MM-YYYY): ${doc.id}</p>
        <p>Timestamp: ${new Date(doc.get('timestamp')).toJSON()}</p>
        `;

          messages.push({
            html,
            cc: env.systemEmail,
            subject: 'FROM Timer function',
            to: email,
            from: env.systemEmail,
          });
        });

      console.log({ messages });

      const batch = db.batch();
      const dateString = new Date().toDateString();

      recipientsQuery
        .forEach((doc) => batch.set(doc.ref, { dateString }, { merge: true }));

      return Promise
        .all([
          sgMail
            .sendMultiple(messages),
          batch
            .commit(),
        ]);
    })
    .catch(console.error);
};
