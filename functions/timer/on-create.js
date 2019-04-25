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
  users,
  rootCollections,
  fieldPath,
} = require('../admin/admin');
const {
  dateFormats,
  httpsActions,
  reportNames,
  sendGridTemplateIds,
} = require('../admin/constants');
const {
  getRelevantTime,
} = require('../admin/utils');
const {
  alphabetsArray,
} = require('../firestore/recipients/report-utils');

const moment = require('moment');
const fs = require('fs');
const env = require('../admin/env');
const sgMail = require('@sendgrid/mail');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');

sgMail.setApiKey(env.sgMailApiKey);


const handleUserStatusReport = (worksheet, counterDoc, yesterdayInitDoc, activeYesterday) => {
  const userStatusSheet = worksheet.addSheet('User Status');
  userStatusSheet.row(0).style('bold', true);

  userStatusSheet.cell('A1').value('Total Auth');
  userStatusSheet.cell('B1').value('New Auth');
  userStatusSheet.cell('C1').value('Active Yesterday');
  userStatusSheet.cell('D1').value('New Installs');

  userStatusSheet.cell('A2').value(counterDoc.get('totalUsers'));
  userStatusSheet.cell('B2').value(yesterdayInitDoc.get('usersAdded'));

  /** Filled after creating the office sheet */
  userStatusSheet.cell('C2').value(activeYesterday);
  userStatusSheet.cell('D2').value(yesterdayInitDoc.get('installsToday'));
};

const handleOfficeActivityReport = (worksheet, yesterdayInitDoc) => {
  let activeYesterday = 0;

  const officeActivitySheet = worksheet.addSheet('Office Activity Report');
  officeActivitySheet.row(0).style('bold', true);

  officeActivitySheet.cell('A1').value('');
  officeActivitySheet.cell('B1').value('Total Users');
  officeActivitySheet.cell('C1').value('Users Active Yesterday');
  officeActivitySheet.cell('D1').value('Inactive');
  officeActivitySheet.cell('E1').value('Others (users On Leave/On Duty/Holiday/Weekly Off');
  officeActivitySheet.cell('F1').value('Pending Signups');
  officeActivitySheet.cell('G1').value('Activities Created Yesterday');
  officeActivitySheet.cell('H1').value('Unverified Recipients');

  const countsObject = yesterdayInitDoc.get('countsObject');
  const createCountByOffice = yesterdayInitDoc.get('createCountByOffice');
  const unverifiedRecipients = yesterdayInitDoc.get('unverifiedRecipients');

  Object
    .keys(countsObject)
    .forEach((office, index) => {
      const {
        notInstalled,
        totalUsers,
        onLeaveWeeklyOffHoliday,
        active,
        notActive,
      } = countsObject[office];

      const createCount = createCountByOffice[office];
      const arrayOfUnverifiedRecipients = unverifiedRecipients[office];
      const rowIndex = index + 2;

      activeYesterday += active;

      officeActivitySheet.cell(`A${rowIndex}`).value(office);
      officeActivitySheet.cell(`B${rowIndex}`).value(totalUsers);
      officeActivitySheet.cell(`C${rowIndex}`).value(active);
      officeActivitySheet.cell(`D${rowIndex}`).value(notActive);
      officeActivitySheet.cell(`E${rowIndex}`).value(onLeaveWeeklyOffHoliday);
      officeActivitySheet.cell(`F${rowIndex}`).value(notInstalled);
      officeActivitySheet.cell(`G${rowIndex}`).value(createCount);
      officeActivitySheet.cell(`H${rowIndex}`).value(`${arrayOfUnverifiedRecipients || []}`);
    });

  return activeYesterday;
};

const handleActivityStatusReport = (worksheet, counterDoc, yesterdayInitDoc) => {
  const activityStatusSheet = worksheet.addSheet('Activity Status Report');
  activityStatusSheet.row(0).style('bold', true);

  activityStatusSheet.cell('A1').value('Templates');
  activityStatusSheet.cell('B1').value('Total');
  activityStatusSheet.cell('C1').value('Created by Admin');
  activityStatusSheet.cell('D1').value('Created by Support');
  activityStatusSheet.cell('E1').value('Created by App');
  activityStatusSheet.cell('F1').value('System Created');
  activityStatusSheet.cell('G1').value('Created Yesterday');
  activityStatusSheet.cell('H1').value('Updated Yesterday');
  activityStatusSheet.cell('I1').value('Status Changed Yesterday');
  activityStatusSheet.cell('J1').value('Shared Yesterday');
  activityStatusSheet.cell('K1').value('Commented Yesterday');

  const {
    adminApiMap,
    supportMap,
    totalByTemplateMap,
    autoGeneratedMap,
  } = counterDoc.data();

  const {
    templateUsageObject,
  } = yesterdayInitDoc.data();

  const templateNames = [
    'admin',
    'branch',
    'check-in',
    'customer',
    'customer-type',
    'department',
    'dsr',
    'duty roster',
    'employee',
    'enquiry',
    'expense claim',
    'expense-type',
    'leave',
    'leave-type',
    'office',
    'on duty',
    'product',
    'recipient',
    'subscription',
    'tour plan',
  ];

  const getValueFromMap = (map, name) => {
    return map[name] || 0;
  };

  templateNames.forEach((name, index) => {
    const position = index + 2;

    activityStatusSheet
      .cell(`A${position}`)
      .value(name);

    activityStatusSheet
      .cell(`B${position}`)
      .value(totalByTemplateMap[name] || 0);

    activityStatusSheet
      .cell(`C${position}`)
      .value(adminApiMap[name] || 0);

    activityStatusSheet
      .cell(`D${position}`)
      .value(supportMap[name] || 0);

    const createdByApp = getValueFromMap(totalByTemplateMap, name)
      - getValueFromMap(adminApiMap, name)
      - getValueFromMap(supportMap, name);

    activityStatusSheet
      .cell(`E${position}`)

      .value(createdByApp);

    activityStatusSheet
      .cell(`F${position}`)
      .value(autoGeneratedMap[name] || 0);

    const getCount = (action) => {
      if (!templateUsageObject[name]) {
        return 0;
      }

      return templateUsageObject[name][action] || 0;
    };

    // created
    activityStatusSheet
      .cell(`G${position}`)
      .value(getCount(httpsActions.create));
    // update
    activityStatusSheet
      .cell(`H${position}`)
      .value(getCount(httpsActions.update));
    // change status
    activityStatusSheet
      .cell(`I${position}`)
      .value(getCount(httpsActions.changeStatus));
    // comment
    activityStatusSheet
      .cell(`J${position}`)
      .value(getCount(httpsActions.share));
    // shared
    activityStatusSheet
      .cell(`K${position}`)
      .value(getCount(httpsActions.comment));
  });
};


const handleDailyStatusReport = () => {
  const date = moment().subtract(1, 'day').format(dateFormats.DATE);
  const fileName = `Daily Status Report ${date}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  const yesterday = moment().subtract(1, 'day');
  const messageObject = {
    to: env.instantEmailRecipientEmails,
    from: {
      name: 'Growthfile',
      email: env.systemEmail,
    },
    templateId: sendGridTemplateIds.dailyStatusReport,
    'dynamic_template_data': {
      date,
      subject: `Daily Status Report_Growthfile_${date}`,
    },
    attachments: [],
  };
  let worksheet;
  let counterDoc;
  let yesterdayInitDoc;

  return Promise
    .all([
      xlsxPopulate
        .fromBlankAsync(),
      rootCollections
        .inits
        .where('report', '==', reportNames.COUNTER)
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', yesterday.date())
        .where('month', '==', yesterday.month())
        .where('year', '==', yesterday.year())
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        workbook,
        counterInitQuery,
        yesterdayInitQuery,
      ] = result;

      worksheet = workbook;
      counterDoc = counterInitQuery.docs[0];
      yesterdayInitDoc = yesterdayInitQuery.docs[0];
      const activeYesterday =
        handleOfficeActivityReport(worksheet, yesterdayInitDoc);

      worksheet.deleteSheet('Sheet1');

      handleActivityStatusReport(worksheet, counterDoc, yesterdayInitDoc);
      handleUserStatusReport(worksheet, counterDoc, yesterdayInitDoc, activeYesterday);

      return worksheet.toFileAsync(filePath);
    })
    .then(() => {

      messageObject
        .attachments
        .push({
          fileName,
          content: fs.readFileSync(filePath).toString('base64'),
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log('mail sent to', messageObject.to);

      return sgMail.sendMultiple(messageObject);
    })
    .catch((error) => console.log(error.toString()));
};

const sendErrorReport = () => {
  const {
    dateFormats,
  } = require('../admin/constants');
  const momentTz = require('moment-timezone');

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

  return rootCollections
    .errors
    .where('date', '==', today.date())
    .where('month', '==', today.month())
    .where('year', '==', today.year())
    .get()
    .then((snapShot) => {
      if (snapShot.empty) {
        // No errors yesterday
        return Promise.resolve();
      }

      let messageBody = '';

      snapShot.docs.forEach((doc, index) => {
        if (doc.get('skipFromErrorReport')) return;

        messageBody += `${getHTMLString(doc, index)}\n\n`;
      });

      const subject = `${process.env.GCLOUD_PROJECT}`
        + ` Frontend Errors ${today.format(dateFormats.DATE)}`;

      const sgMail = require('@sendgrid/mail');
      const env = require('../admin/env');
      sgMail.setApiKey(env.sgMailApiKey);

      console.log('sending mail');

      return sgMail.send({
        subject,
        to: env.instantEmailRecipientEmails,
        from: { name: 'Growthile', email: 'gcloud@growthfile.com' },
        html: messageBody,
      });
    })
    .catch(console.error);
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
    .then((lastDoc) => {
      if (!lastDoc) return resolve();

      return process
        .nextTick(() => {
          const newQuery = query
            // Using greater than sign because we need
            // to start after the last activity which was
            // processed by this code otherwise some activities
            // might be updated more than once.
            .where(fieldPath, '>', lastDoc.id);

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
    .orderBy(fieldPath)
    .limit(250);

  return new Promise((resolve, reject) => {
    return runQuery(query, resolve, reject);
  });
};

module.exports = (timerDoc) => {
  if (timerDoc.get('sent')) {
    // Helps to check if email is sent already. 
    // Cloud functions sometimes trigger multiple times
    // For a single write.
    return Promise.resolve();
  }

  return timerDoc
    .ref
    .set({
      sent: true,
    }, {
        merge: true,
      })
    .then(() => {
      const messages = [];

      env
        .instantEmailRecipientEmails
        .forEach((email) => {
          const html = `<p>Date (DD-MM-YYYY): ${timerDoc.id}</p>
<p>Timestamp: ${new Date(timerDoc.get('timestamp')).toJSON()}</p>`;

          messages.push({
            html,
            cc: '',
            subject: 'FROM Timer function',
            to: email,
            from: {
              name: 'Growthfile',
              email: env.systemEmail,
            },
          });
        });

      return sgMail.sendMultiple(messages);
    })
    .then(() => sendErrorReport())
    // .then(() => handleRelevantTime())
    .then(() => rootCollections
      .recipients
      .get())
    .then((recipientsQuery) => {
      const batch = db.batch();

      recipientsQuery
        .forEach((doc) => {
          batch.set(doc.ref, {
            timestamp: Date.now(),
          }, {
              merge: true,
            });
        });

      return batch.commit();
    })
    // .then(() => handleDailyStatusReport())
    .catch(console.error);
};
