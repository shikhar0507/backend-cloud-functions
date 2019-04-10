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


const fs = require('fs');
const env = require('../admin/env');
const sgMail = require('@sendgrid/mail');
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');

sgMail.setApiKey(env.sgMailApiKey);


const handleOfficeSheet = (locals) => {
  let officeDocs;
  const authFetch = [];
  const footprintsFetch = [];
  const recipientsFetch = [];
  const moment = require('moment');
  const yesterdayMoment = moment().subtract(1, 'day');
  const yesterdaysDate = yesterdayMoment.date();
  const dormantEmployeesCountMap = new Map();
  const totalEmployeesCountMap = new Map();
  const phoneNumbersSet = new Set();
  const assigneesMap = new Map();
  const activeCountMap = new Map();
  const notInstalledCountMap = new Map();
  const officeUnverifiedRecipientsMap = new Map();
  const officeActivityReport = locals.worksheet.sheet('Office Activity Report');

  return rootCollections
    .offices
    .get()
    .then((snapShot) => {
      officeDocs = snapShot;
      snapShot
        .docs
        .forEach((officeDoc, index) => {
          const office = officeDoc.get('office');
          const employeesData = officeDoc.get('employeesData') || {};

          officeActivityReport
            .cell(`A${index + 2}`)
            .value(office);

          totalEmployeesCountMap.set(
            office,
            Object.keys(employeesData).length
          );

          const footprintsPromise = rootCollections
            .inits
            .where('office', '==', office)
            .where('month', '==', yesterdayMoment.month())
            .where('year', '==', yesterdayMoment.year())
            .where('report', '==', reportNames.FOOTPRINTS_MTD)
            .limit(1)
            .get();

          const recipientPromise = rootCollections
            .recipients
            .where('office', '==', office)
            .get();

          recipientsFetch.push(recipientPromise);
          footprintsFetch.push(footprintsPromise);
        });

      return Promise.all(footprintsFetch);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          return;
        }

        let activeCount = 0;
        let notInstalledCount = 0;
        const doc = snapShot.docs[0];
        const office = doc.get('office');
        const footprintsObject = doc.get('footprintsObject');

        Object
          .keys(footprintsObject)
          .forEach((phoneNumber) => {
            const employeeStatusObject = (() => {
              if (!footprintsObject[phoneNumber]) {
                return footprintsObject[phoneNumber] = {};
              }

              return footprintsObject[phoneNumber];
            })();

            if (employeeStatusObject[yesterdaysDate] === 'NOT ACTIVE') {
              activeCount++;
            }

            if (employeeStatusObject[yesterdaysDate] === 'NOT INSTALLED') {
              notInstalledCount++;
            }

          });

        activeCountMap.set(office, activeCount);
        notInstalledCountMap.set(office, notInstalledCount);
      });

      return Promise.all(recipientsFetch);
    })
    .then((snapShots) => {
      snapShots
        .forEach((snapShot) => {
          const office = snapShot.docs[0].get('office');

          snapShot
            .forEach((doc) => {
              const include = doc.get('include');

              include.forEach((phoneNumber) => {
                phoneNumbersSet.add(phoneNumber);

                assigneesMap.set(phoneNumber, office);
              });
            });
        });

      phoneNumbersSet
        .forEach((phoneNumber) => {
          const promise = users.getUserByPhoneNumber(phoneNumber);

          authFetch.push(promise);
        });

      return Promise.all(authFetch);
    })
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[phoneNumber];

        if (!record || !record.email || !record.emailVerified) {
          // returns office name
          const office = assigneesMap.get(phoneNumber);

          if (officeUnverifiedRecipientsMap.has(office)) {
            const set = officeUnverifiedRecipientsMap.get(office);

            set.add(phoneNumber);

            officeUnverifiedRecipientsMap.set(office, set);
          } else {
            officeUnverifiedRecipientsMap.set(office, new Set().add(phoneNumber));
          }
        }
      });

      officeDocs
        .docs
        .forEach((officeDoc, index) => {
          const columnIndex = index + 2;
          const office = officeDoc.get('office');
          const totalEmployees = totalEmployeesCountMap.get(office);
          const activeCount = activeCountMap.get(office);
          const inactiveCount = totalEmployees - activeCount;
          /** People on leave, on duty or with weekly off */
          const dormantEmployees = dormantEmployeesCountMap.get(office) || 0;
          const notInstalledCount = notInstalledCountMap.get(office);
          const createdActivitiesCount = locals.createCountByOffice[office] || 0;
          const unverifiedRecipients = Array.from(officeUnverifiedRecipientsMap.get(office) || []);

          officeActivityReport
            .cell(`B${columnIndex}`)
            .value(totalEmployees);
          officeActivityReport
            .cell(`C${columnIndex}`)
            .value(activeCount);
          officeActivityReport
            .cell(`D${columnIndex}`)
            .value(inactiveCount);
          officeActivityReport
            .cell(`E${columnIndex}`)
            .value(dormantEmployees);
          officeActivityReport
            .cell(`F${columnIndex}`)
            .value(notInstalledCount);
          officeActivityReport
            .cell(`G${columnIndex}`)
            .value(createdActivitiesCount);
          officeActivityReport
            .cell(`H${columnIndex}`)
            .value(`${unverifiedRecipients}`);
        });

      return Promise.resolve();
    })
    .catch(console.error);
};


const handleDailyStatusReport = () => {
  const date = moment().format(dateFormats.DATE);
  const fileName = `Daily Status Report ${date}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  const yesterday = moment().subtract(1, 'day');
  const locals = {};

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

  const yesterdayStart = momentTz()
    .subtract(1, 'day')
    .startOf('day')
    .valueOf();

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
      rootCollections
        .profiles
        .where('lastQueryFrom', '>=', yesterdayStart)
        .get(),
    ])
    .then((result) => {
      const [
        worksheet,
        counterInitQuery,
        yesterdayInitQuery,
        profilesQuery,
      ] = result;

      locals.worksheet = worksheet;

      const userStatusReport = worksheet.addSheet('User Status Report');
      const officeReport = worksheet.addSheet('Office Activity Report');
      const activityStatusReport = worksheet.addSheet('Activity Status Report');
      worksheet.deleteSheet('Sheet1');

      userStatusReport.row(0).style('bold', true);
      officeReport.row(0).style('bold', true);
      activityStatusReport.row(0).style('bold', true);

      [
        'Total Auth',
        'New Auth',
        'Active Yesterday',
        'New Installs',
      ]
        .forEach((header, index) => {
          userStatusReport
            .cell(`${alphabetsArray[index]}1`)
            .value(header);
        });

      [
        'Office',
        'Total Users',
        'Active',
        'Not Active',
        'On leave, on duty, on holiday, or on weekly off',
        'Not Installed',
        'Activities Created',
        'Unverified Recipients'
      ]
        .forEach((header, index) => {
          officeReport
            .cell(`${alphabetsArray[index]}1`)
            .value(header);
        });

      [
        'Template',
        'Total',
        'Created By Admin',
        'Created By Support',
        'Created By App',
        'System Created',
        'Created Yesterday',
        'Updated Yesterday',
        'Changed Status Yesterday',
        'Commented Yesterday',
        'Shared Yesterday',
      ]
        .forEach((header, index) => {
          activityStatusReport
            .cell(`${alphabetsArray[index]}1`)
            .value(header);
        });

      const {
        totalUsers,
        adminApiMap,
        supportMap,
        totalByTemplateMap,
        autoGeneratedMap,
      } = counterInitQuery.docs[0].data();
      const {
        usersAdded,
        installsToday,
        templateUsageObject,
        createCountByOffice,
      } = yesterdayInitQuery.docs[0].data();

      /** Used in office sheet */
      locals.createCountByOffice = createCountByOffice;

      console.log('CounterDoc', counterInitQuery.docs[0].ref.path);
      console.log('YesterdayDoc', yesterdayInitQuery.docs[0].ref.path);

      userStatusReport.cell(`A2`).value(totalUsers);
      userStatusReport.cell(`B2`).value(usersAdded);
      // Active yesterday
      userStatusReport.cell(`C2`).value(profilesQuery.size);
      // new installs
      userStatusReport.cell(`D2`).value(installsToday || 0);

      [
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
        'tour plan'
      ]
        .forEach((name, index) => {
          const position = index + 2;

          activityStatusReport
            .cell(`A${position}`)
            .value(name);

          activityStatusReport
            .cell(`B${position}`)
            .value(totalByTemplateMap[name] || 0);

          activityStatusReport
            .cell(`C${position}`)
            .value(adminApiMap[name] || 0);

          activityStatusReport
            .cell(`D${position}`)
            .value(supportMap[name] || 0);

          activityStatusReport
            .cell(`E${position}`)
            .value(totalByTemplateMap[name] || 0 - adminApiMap[name] || 0 - supportMap[name] || 0);

          activityStatusReport
            .cell(`F${position}`)
            .value(autoGeneratedMap[name] || 0);

          const getCount = (action) => {
            if (!templateUsageObject[name]) {
              return 0;
            }

            return templateUsageObject[name][action] || 0;
          };

          // created
          activityStatusReport
            .cell(`G${position}`)
            .value(getCount(httpsActions.create));
          // update
          activityStatusReport
            .cell(`H${position}`)
            .value(getCount(httpsActions.update));
          // change status
          activityStatusReport
            .cell(`I${position}`)
            .value(getCount(httpsActions.changeStatus));
          // comment
          activityStatusReport
            .cell(`J${position}`)
            .value(getCount(httpsActions.comment));
          // shared
          activityStatusReport
            .cell(`K${position}`)
            .value(getCount(httpsActions.share));
        });

      return handleOfficeSheet(locals);
    })
    .then(() => locals.worksheet.toFileAsync(filePath))
    .then(() => {
      messageObject
        .attachments
        .push({
          fileName,
          content: fs.readFileSync(filePath).toString('base64'),
          type: 'text/csv',
          disposition: 'attachment',
        });

      return sgMail.sendMultiple(messageObject);
    })
    .catch((error) => {
      console.error(error.toString());
    });
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
