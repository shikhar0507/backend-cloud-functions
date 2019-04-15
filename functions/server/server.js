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
  rootCollections,
  auth,
  db,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');
const {
  handleError,
  sendResponse,
  disableAccount,
  hasSupportClaims,
  hasAdminClaims,
  reportBackgroundError,
} = require('../admin/utils');
const env = require('../admin/env');
const url = require('url');

const headerValid = (headers) => {
  if (!headers.hasOwnProperty('authorization')) {
    return {
      isValid: false,
      message: 'The authorization header is missing from the headers',
    };
  }

  if (typeof headers.authorization !== 'string') {
    return {
      isValid: false,
      message: 'The authorization header is not valid',
    };
  }

  if (!headers.authorization.startsWith('Bearer ')) {
    return {
      isValid: false,
      message: `Authorization type is not 'Bearer'`,
    };
  }

  return {
    isValid: true,
    authToken: headers.authorization.split('Bearer ')[1],
  };
};

const handleAdminUrl = (conn, urlParts) => {
  const resource = urlParts[2];

  if (conn.requester.isSupportRequest
    && !hasSupportClaims(conn.requester.customClaims)) {
    sendResponse(
      conn,
      code.forbidden,
      'You cannot make support requests'
    );

    return;
  }

  /** Only support or admin is allowed */
  if (!conn.requester.isSupportRequest
    && !hasAdminClaims(conn.requester.customClaims)) {
    sendResponse(
      conn,
      code.unauthorized,
      `You cannot access this resource`
    );

    return;
  }

  if (resource === 'read') {
    require('../firestore/offices/on-read')(conn);

    return;
  }

  if (resource === 'now') {
    require('../firestore/offices/now')(conn);

    return;
  }

  if (resource === 'search') {
    require('../firestore/offices/search')(conn);

    return;
  }

  if (resource === 'single') {
    require('../firestore/single')(conn);

    return;
  }

  if (resource === 'bulk') {
    require('../firestore/bulk/script')(conn);

    return;
  }

  if (resource === 'change-phone-number') {
    require('../firestore/phone-number-change')(conn);

    return;
  }

  if (resource === 'employee-resign') {
    require('../employee-resign')(conn);

    return;
  }

  if (resource === 'send-mail') {
    require('../website-utils/send-excel-email')(conn);

    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    `No resource found at the path: ${(conn.req.url)}.`
  );
};

const handleActivitiesUrl = (conn, urlParts) => {
  const resource = urlParts[2];

  if (resource === 'comment') {
    require('../firestore/activity/on-comment')(conn);

    return;
  }

  if (resource === 'create') {
    require('../firestore/activity/on-create')(conn);

    return;
  }

  if (resource === 'update') {
    require('../firestore/activity/on-update')(conn);

    return;
  }

  if (resource === 'share') {
    require('../firestore/activity/on-share')(conn);

    return;
  }

  if (resource === 'change-status') {
    require('../firestore/activity/on-change-status')(conn);

    return;
  }

  sendResponse(
    conn,
    code.notFound,
    `No resource found at the path: ${(conn.req.url)}.`
  );
};


const handleServicesUrl = (conn, urlParts) => {
  const resource = urlParts[2];

  if (resource === 'permissions') {
    require('../services/on-permissions')(conn);

    return;
  }

  if (resource === 'templates') {
    require('../services/on-templates')(conn);

    return;
  }

  if (resource === 'logs') {
    require('../services/on-logs')(conn);

    return;
  }

  if (resource === 'images') {
    require('../services/on-images')(conn);

    return;
  }

  sendResponse(
    conn,
    code.notFound,
    `No resource found at the path: ${(conn.req.url)}.`
  );
};


const handleRequestPath = (conn, parsedUrl) => {
  const urlParts = parsedUrl.pathname.split('/');
  const parent = urlParts[1];

  if (parent === 'enquiry') {
    require('../firestore/enquiry/index')(conn);

    return;
  }

  if (parent === 'read') {
    require('../firestore/on-read')(conn);

    return;
  }

  if (parent === 'activities') {
    handleActivitiesUrl(conn, urlParts);

    return;
  }

  if (parent === 'services') {
    handleServicesUrl(conn, urlParts);

    return;
  }


  if (parent === 'admin') {
    handleAdminUrl(conn, urlParts);

    return;
  }

  sendResponse(
    conn,
    code.notFound,
    `No resource found at the path: ${conn.req.url}`
  );
};


const getProfile = (conn, pathName) =>
  rootCollections
    .profiles
    .doc(conn.requester.phoneNumber)
    .get()
    .then((doc) => {
      conn.requester.lastQueryFrom = doc.get('lastQueryFrom');
      conn.requester.employeeOf = doc.get('employeeOf');
      /**
        * When a user signs up for the first time, the `authOnCreate`
        * cloud function creates two docs in the Firestore.
        *
        * `Profiles/(phoneNumber)`, & `Updates/(uid)`.
        *
        * The `Profiles` doc has `phoneNumber` of the user as the `doc-id`.
        * It has one field `uid` = the uid from the auth.
        *
        * The `Updates` doc has the `doc-id` as the `uid` from the auth
        * and one field `phoneNumber` = phoneNumber from auth.
        *
        * When a user signs up via the user facing app, they instantly hit
        * the `/api` endpoint. In normal flow, the
        * `getProfile` is called.
        *
        * It compares the `uid` from profile doc and the `uid` from auth.
        * If the `authOnCreate` hasn't completed execution in this time,
        * chances are that this doc won't be found and getting the uid
        * from this non-existing doc will result in `disableAccount` function
        * being called.
        *
        * To counter this, we allow a grace period of `60` seconds between
        * the `auth` creation and the hit time on the `api`.
        */
      const authCreationTime = new Date(
        conn.requester.creationTime
      )
        .getTime();
      const NUM_MILLI_SECS_IN_MINUTE = 60000;

      if (Date.now() - authCreationTime < NUM_MILLI_SECS_IN_MINUTE) {
        // return handleRequestPath(conn, pathName);
        return Promise.resolve();
      }

      /**
       * In `/api`, if uid is undefined in /Profiles/{phoneNumber} && authCreateTime and lastSignInTime is same,
       *   run `authOnCreate` logic again.
       */
      if (doc.get('uid')
        && doc.get('uid') !== conn.requester.uid) {
        console.log({
          authCreationTime,
          now: Date.now(),
          msg: `The uid and phone number of the requester does not match.`,
          phoneNumber: doc.id,
          profileUid: doc.get('uid'),
          authUid: conn.requester.uid,
          gracePeriodInSeconds: NUM_MILLI_SECS_IN_MINUTE,
          diff: Date.now() - authCreationTime,
        });

        /**
         * The user probably managed to change their phone number by something
         * other than out provided endpoint for updating the `auth`.
         * Disabling their account because this is not allowed.
         */
        return disableAccount(
          conn,
          `The uid and phone number of the requester does not match.`
        );
      }

      const batch = db.batch();

      /** AuthOnCreate probably failed. This is the fallback */
      if (!doc.get('uid')) {
        batch
          .set(doc.ref, {
            uid: conn.requester.uid,
          }, {
              merge: true,
            });

        batch
          .set(rootCollections
            .updates
            .doc(conn.requester.uid), {
              phoneNumber: conn.requester.phoneNumber,
            }, {
              merge: true,
            });
      }

      return batch.commit();
    })
    .then(() => handleRequestPath(conn, pathName))
    .catch((error) => handleError(conn, error));


const getUserAuthFromIdToken = (conn, decodedIdToken) =>
  auth
    .getUser(decodedIdToken.uid)
    .then((userRecord) => {
      if (userRecord.disabled) {
        /** Users with disabled accounts cannot request any operation **/
        sendResponse(
          conn,
          code.forbidden,
          `This account has been temporarily disabled. Please contact`
          + ` your admin`
        );

        return;
      }

      conn.requester = {
        uid: decodedIdToken.uid,
        email: userRecord.email || '',
        phoneNumber: userRecord.phoneNumber,
        displayName: userRecord.displayName || '',
        photoURL: userRecord.photoURL || '',
        customClaims: userRecord.customClaims || null,
        creationTime: userRecord.metadata.creationTime,
      };

      // Makes tesing locally easier
      if (decodedIdToken.customClaims) {
        conn.requester.customClaims = decodedIdToken.customClaims;
      }

      /**
       * Can be used to verify in the activity flow to see if the request
       * is of type support.
       *
       * URL query params are of type `string`
       */
      conn.requester.isSupportRequest =
        conn.req.query.support === 'true';

      if (conn.requester.isSupportRequest
        && !hasSupportClaims(conn.requester.customClaims)) {
        sendResponse(
          conn,
          code.forbidden,
          'You do not have the permission to make support requests for activities'
        );

        return;
      }

      const parsedUrl = require('url').parse(conn.req.url);

      if (parsedUrl.pathname === '/now') {
        require('../now/index')(conn);

        return;
      }

      getProfile(conn, parsedUrl);

      return;
    })
    .catch((error) => handleError(conn, error));

const handleRejections = (conn, errorObject) => {
  const context = {
    ip: conn.req.ip,
    header: conn.req.headers,
    url: conn.req.url,
    origin: conn.req.get('origin'),
  };

  console.log({ context });

  if (!errorObject.code.startsWith('auth/')) {
    console.error(errorObject);

    sendResponse(conn, code.internalServerError, 'Something went wrong');

    return;
  }

  reportBackgroundError(errorObject, context, 'AUTH_REJECTION')
    .then(() => sendResponse(conn, code.unauthorized, 'Unauthorized'))
    .catch((error) => handleError(conn, error));
};

/**
 * Verifies the `id-token` form the Authorization header in the request.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @returns {void}
 */
const checkAuthorizationToken = (conn) => {
  const result = headerValid(conn.req.headers);

  if (!result.isValid) {
    sendResponse(conn, code.forbidden, result.message);

    return;
  }

  /** Checks if the token was revoked recently when set to `true` */
  const checkRevoked = true;

  auth
    .verifyIdToken(result.authToken, checkRevoked)
    .then((decodedIdToken) => getUserAuthFromIdToken(conn, decodedIdToken))
    .catch((error) => handleRejections(conn, error));
};


const handleOfficeSheet = (locals) => {
  const {
    reportNames,
  } = require('../admin/constants');
  const {
    users,
  } = require('../admin/admin');
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

            if (employeeStatusObject[yesterdaysDate] === 'NOT INSTALLED') {
              notInstalledCount++;
            }

            if (typeof employeeStatusObject[yesterdaysDate] === 'object'
              && (employeeStatusObject[yesterdaysDate].first
                || employeeStatusObject[yesterdaysDate].last)) {
              activeCount++;
            }

            if (employeeStatusObject[yesterdaysDate] === 'LEAVE'
              || employeeStatusObject[yesterdaysDate] === 'WEEKLY OFF'
              || employeeStatusObject[yesterdaysDate] === 'HOLIDAY'
              || employeeStatusObject[yesterdaysDate] === 'ON DUTY') {
              if (dormantEmployeesCountMap.has(office)) {
                let count = dormantEmployeesCountMap.get(office);

                count++;

                dormantEmployeesCountMap.set(office, count);
              } else {
                dormantEmployeesCountMap.set(office, 1);
              }
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

            officeUnverifiedRecipientsMap.set(
              office,
              set
            );
          } else {
            officeUnverifiedRecipientsMap.set(
              office,
              new Set().add(phoneNumber)
            );
          }
        }
      });

      let totalActiveInAllOffices = 0;

      officeDocs
        .docs
        .forEach((officeDoc, index) => {
          const columnIndex = index + 2;
          const office = officeDoc.get('office');
          const totalEmployees = totalEmployeesCountMap.get(office);
          const activeCount = activeCountMap.get(office) || 0;
          const inactiveCount = totalEmployees - activeCount;
          /** People on leave, on duty or with weekly off */
          const dormantEmployees = dormantEmployeesCountMap.get(office) || 0;
          const notInstalledCount = notInstalledCountMap.get(office);
          const createdActivitiesCount =
            locals.createCountByOffice[office] || 0;
          const unverifiedRecipients =
            Array.from(officeUnverifiedRecipientsMap.get(office) || []);

          totalActiveInAllOffices += activeCount;

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

      const userStatusReport = locals.worksheet.sheet('User Status Report');

      userStatusReport.cell('C2').value(totalActiveInAllOffices);

      return Promise.resolve();
    })
    .catch(console.error);
};


const handleDailyStatusReport = () => {
  const moment = require('moment');
  const xlsxPopulate = require('xlsx-populate');
  const sgMail = require('@sendgrid/mail');
  const fs = require('fs');
  const env = require('../admin/env');

  sgMail.setApiKey(env.sgMailApiKey);

  const {
    alphabetsArray,
  } = require('../firestore/recipients/report-utils');
  const {
    dateFormats,
    sendGridTemplateIds,
    reportNames,
    httpsActions,
  } = require('../admin/constants');
  const date = moment().subtract(1, 'day').format(dateFormats.DATE);
  const fileName = `Daily Status Report ${date}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  const yesterday = moment().subtract(2, 'day');
  const locals = {};

  const messageObject = {
    to: 'utkarsh.bhatt12@gmail.com',
    // to: env.instantEmailRecipientEmails,
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
        worksheet,
        counterInitQuery,
        yesterdayInitQuery,
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
        'Unverified Recipients',
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
      userStatusReport.cell(`C2`).value();
      // new installs
      userStatusReport.cell(`D2`).value(installsToday || 0);

      const templateNames = ['admin',
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
        'tour plan'];

      templateNames.forEach((name, index) => {
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
          .value(
            totalByTemplateMap[name] || 0
            - adminApiMap[name] || 0
            - supportMap[name] || 0
          );

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
    .catch((error) => console.log(error.toString()));
};


/**
 * Handles the routing for the request from the clients.
 *
 * @param {Object} req Express Request object.
 * @param {Object} res Express Response object.
 * @returns {void}
 */
module.exports = (req, res) => {
  const conn = {
    req,
    res,
    headers: {
      /** The pre-flight headers */
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS, HEAD, POST, GET, PATCH, PUT',
      'Access-Control-Allow-Headers': 'X-Requested-With, Authorization,' +
        'Content-Type, Accept',
      'Access-Control-Max-Age': 86400,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Cache-Control': 'no-cache',
    },
  };

  /** For handling CORS */
  if (req.method === 'HEAD' || req.method === 'OPTIONS') {
    sendResponse(conn, code.noContent);

    return;
  }

  if (!new Set()
    .add('GET')
    .add('POST')
    .add('PATCH')
    .add('PUT')
    .has(req.method)) {
    sendResponse(
      conn,
      code.notImplemented,
      `${req.method} is not supported for any request.`
      + ' Please use `GET`, `POST`, `PATCH`, or `PUT` to make your requests'
    );

    return;
  }

  const parsed = url.parse(conn.req.url).pathname;

  if (parsed === '/parseMail'
    && conn.req.query.token === env.sgMailParseToken) {
    require('../mail-parser')(conn);

    return;
  }

  if (env.isProduction) {
    if (!conn.req.headers['x-cf-secret']
      || conn.req.headers['x-cf-secret'] !== env.cfSecret) {
      sendResponse(conn, code.forbidden, 'Not allowed');

      return;
    }
  }

  checkAuthorizationToken(conn);
};
