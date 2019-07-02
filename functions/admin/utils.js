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


const { code } = require('./responses');
const {
  auth,
  rootCollections,
} = require('./admin');
const {
  dateFormats,
  httpsActions,
  sendGridTemplateIds,
  reportNames,
  timezonesSet,
} = require('../admin/constants');
const crypto = require('crypto');
const env = require('./env');
const https = require('https');
const xlsxPopulate = require('xlsx-populate');
const moment = require('moment-timezone');
const sgMail = require('@sendgrid/mail');
const { execFile } = require('child_process');
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();



sgMail.setApiKey(env.sgMailApiKey);

const isValidTimezone = (timezone) => timezonesSet.has(timezone);

const isValidStatus = (status) =>
  new Set(['CANCELLED', 'CONFIRMED', 'PENDING'])
    .has(status);

const isValidCanEditRule = (canEditRule) =>
  new Set(['NONE', 'ALL', 'EMPLOYEE', 'ADMIN', 'CREATOR'])
    .has(canEditRule);

/**
 * Ends the response by sending the `JSON` to the client with `200 OK` response.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} json The response object to send to the client.
 * @param {number} [statusCode] Response code (`default`: `200`) to send to the client.
 * @returns {void}
 */
const sendJSON = (conn, json, statusCode = code.ok) => {
  conn.res.writeHead(statusCode, conn.headers);
  conn.res.end(JSON.stringify(json));
};


/**
 * Ends the response of the request after successful completion of the task
 * or on an error.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @param {number} statusCode A standard HTTP status code.
 * @param {string} [message] Response message for the request.
 * @returns {void}
 */
const sendResponse = (conn, statusCode = code.ok, message = '') => {
  conn.res.writeHead(statusCode, conn.headers);

  /** 2xx codes denote success. */
  const success = statusCode <= 226;

  /**
   * Requests from sendGrid are retried whenever the status
   * code is 4xx or 5xx. We are explicitly avoiding this.
   */
  if (conn.req.query.token === env.sgMailParseToken) {
    conn.res.writeHead(code.ok, conn.headers);
  }

  if (!success) {
    console.log(JSON.stringify({
      ip: conn.req.ip,
      header: conn.req.headers,
      url: conn.req.url,
      body: conn.req.body,
      requester: conn.requester,
    }));
  }

  conn.res.end(JSON.stringify({
    message,
    success,
    code: statusCode,
  }));
};


/**
 * Ends the response when there is an error while handling the request.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @param {Object} error Firebase Error object.
 * @param {string} customErrorMessage Message to send to the client.
 * @returns {void}
 */
const handleError = (conn, error, customErrorMessage) => {
  console.error(error);

  sendResponse(
    conn,
    code.internalServerError,
    customErrorMessage || 'Please try again later'
  );
};


/**
 * Helper function to check `support` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `support` claims.
 */
const hasSupportClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be undefined or a boolean, so an explicit
   * check is used.
   */
  return customClaims.support === true;
};


/**
 * Helper function to check `manageTemplates` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `ManageTemplate` claims.
 */
const hasManageTemplateClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be undefined or a boolean, so an explicit
   * check is used.
   */
  return customClaims.manageTemplates === true;
};


/**
 * Helper function to check `superUser` custom claims.
 *
 * @param {Object} customClaims Contains boolean custom claims.
 * @returns {boolean} If the user has `superUser` claims.
 */
const hasSuperUserClaims = (customClaims) => {
  if (!customClaims) return false;

  /** A custom claim can be `undefined` or a `boolean`, so an explicit
   * check is used.
   */
  return customClaims.superUser === true;
};


const hasAdminClaims = (customClaims) => {
  if (!customClaims) return false;

  if (!customClaims.admin) return false;

  /**
   * Empty array with the admin custom claims still
   * negates the permission to view `offices` for a user.
   */
  return customClaims.admin.length > 0;
};


/**
 * Returns the date in ISO 8601 `(DD-MM-YYYY)` format.
 *
 * @param {Object<Date>} [date] Javascript `Date` object.
 * @returns {String} An ISO 8601 (DD-MM-YYYY) date string.
 * @see https://en.wikipedia.org/wiki/ISO_8601
 */
const getISO8601Date = (date = new Date()) =>
  date
    .toJSON()
    .slice(0, 10)
    .split('-')
    .reverse()
    .join('-');


/**
 * Checks if the input argument to the function satisfies the
 *  following conditions:
 *
 * ## `RegExp` Explained:
 *
 * * This regexp has two `groups` separated by a `:` character.
 * * Group 1: `([0-9]|0[0-9]|1[0-9]|2[0-3])`
 * * Group 2: `[0-5][0-9]`
 * * The `(` and `)` denote the `groups`.
 *
 * @param {string} string A string in HH:MM format.
 * @returns {boolean} If the input string is in HH:MM format.
 */
const isHHMMFormat = (string) =>
  /^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/
    .test(string);


/**
 * Disables the user account in auth based on uid and writes the reason to
 * the document in the profiles collection for which the account was disabled.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {string} reason For which the account is being disabled.
 * @returns {void}
 */
const disableAccount = (conn, reason) => {
  const messageBody = `
  <p>
    The user '${conn.requester.phoneNumber}' has been disabled in Growthfile.
    <br>
    <strong>Project Id</strong>: ${process.env.GCLOUD_PROJECT}
    <br>
    <strong>Reason</strong>: ${reason}
    <br>
    <strong>Timestamp</strong>: ${new Date().toTimeString()} Today
  </p>
  `;

  return Promise
    .all([
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .set({
          disabledFor: reason,
          disabledTimestamp: Date.now(),
        }, {
            /** This doc may have other fields too. */
            merge: true,
          }),
      rootCollections
        .instant
        .doc()
        .set({
          messageBody,
          subject: `User Disabled: '${conn.requester.phoneNumber}'`,
        }),
      auth
        .updateUser(conn.requester.uid, {
          disabled: true,
        }),
    ])
    .then(() => sendResponse(
      conn,
      code.forbidden,
      `This account has been temporarily disabled. Please contact your admin.`
    ));
};

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


/**
 * Checks if the location is valid with respect to the standard
 * `lat` and `lng` values.
 *
 * @param {Object} geopoint Contains `lat` and `lng` values.
 * @returns {boolean} If the input `latitude` & `longitude` pair is valid.
 */
const isValidGeopoint = (geopoint) => {
  if (!geopoint) return false;
  if (!geopoint.hasOwnProperty('latitude')) return false;
  if (!geopoint.hasOwnProperty('longitude')) return false;

  if (geopoint.latitude === ''
    && geopoint.longitude === '') return true;

  if (typeof geopoint.latitude !== 'number') return false;
  if (typeof geopoint.longitude !== 'number') return false;

  /** @see https://msdn.microsoft.com/en-in/library/aa578799.aspx */
  return geopoint.latitude >= -90
    && geopoint.latitude <= 90
    && geopoint.longitude >= -180
    && geopoint.longitude <= 180;
};


/**
 * Checks for a `non-null`, `non-empty` string.
 *
 * @param {string} str A string.
 * @returns {boolean} If `str` is a non-empty string.
 */
const isNonEmptyString = (str) =>
  typeof str === 'string'
  && str.trim() !== '';


/**
 * Checks whether the number is a valid Unix timestamp.
 *
 * @param {Object} date Javascript Date object.
 * @returns {boolean} Whether the number is a *valid* Unix timestamp.
 */
const isValidDate = (date) => !isNaN(new Date(parseInt(date)));

const isValidEmail = (email) => /\S+@\S+\.\S+/.test(email);

/**
 * Verifies a phone number based on the E.164 standard.
 *
 * @param {string} phoneNumber A phone number.
 * @returns {boolean} If the string is a *valid* __E.164__ phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const isE164PhoneNumber = (phoneNumber) => {
  if (typeof phoneNumber !== 'string'
    || phoneNumber.trim() !== phoneNumber
    || phoneNumber.replace(/ +/g, '') !== phoneNumber) {
    return false;
  }

  try {
    const parsedPhoneNumberObject = phoneUtil.parseAndKeepRawInput(phoneNumber);

    return phoneUtil
      .isPossibleNumber(parsedPhoneNumberObject);
  } catch (error) {
    /**
     * Error was thrown by the library. i.e., the phone number is invalid
     */
    return false;
  }
};


const reportBackgroundError = (error, context = {}, logName) => {
  const { Logging } = require('@google-cloud/logging');

  // DOCS: https://firebase.google.com/docs/functions/reporting-errors
  const logging = new Logging();
  const log = logging.log(logName);
  const metadata = {
    resource: {
      type: 'cloud_function',
      labels: {
        'function_name': process.env.FUNCTION_NAME,
      },
    },
  };

  const errorEvent = {
    context,
    message: error.stack,
    serviceContext: {
      service: process.env.FUNCTION_NAME,
      resourceType: 'cloud_function',
    },
  };

  console.log({ context });

  return new Promise((resolve, reject) => {
    return log.write(log.entry(metadata, errorEvent), (error) => {
      if (error) return reject(new Error(error));

      return resolve();
    });
  });
};


const getObjectFromSnap = (snap) => {
  if (snap.empty) {
    return {
      ref: rootCollections.inits.doc(),
      data: () => {
        return {};
      },
    };
  }

  return {
    ref: snap.docs[0].ref,
    data: snap.docs[0].data() || {},
  };
};

const promisifiedRequest = (options) => {
  return new Promise((resolve, reject) => {
    const lib = require('https');

    const request =
      lib
        .request(options, (response) => {
          let body = '';

          response
            .on('data', (chunk) => {
              body += chunk;
            })
            .on('end', () => {
              let responseData = {};

              try {
                responseData = JSON.parse(body);
              } catch (error) {
                return reject(new Error('Error:', error));
              }

              if (!response.statusCode.toString().startsWith('2')) {
                console.log('response', response);

                return reject(new Error(response));
              }

              return resolve(responseData);
            });
        });

    if (options.postData) {
      request.write(options.postData);
    }

    request
      .on('error', (error) => reject(new Error(error)));

    request
      .end();
  });
};

const promisifiedExecFile = (command, args) => {
  return new Promise((resolve, reject) => {
    return execFile(command, args, (error) => {
      if (error) {
        return reject(new Error(error));
      }

      return resolve(true);
    });
  });
};

/**
 * Takes in the backblaze main download url along with the fileName (uid of the uploader)
 * and returns the downloadable pretty URL for the client to consume.
 *
 * `Note`: photos.growthfile.com is behind the Cloudflare + Backblaze CDN, but only for
 * the production project, oso the pretty url will only show up for the production and
 * not for any other project that the code runs on.
 *
 * @param {string} mainDownloadUrlStart Backblaze main download host url.
 * @param {string} fileId File ID returned by Backblaze.
 * @param {string} fileName Equals to the uid of the uploader.
 * @returns {string} File download url.
 */
const cloudflareCdnUrl = (mainDownloadUrlStart, fileId, fileName) => {
  if (env.isProduction) {
    return `${env.imageCdnUrl}/${fileName}`;
  }

  return `https://${mainDownloadUrlStart}`
    + `/b2api/v2/b2_download_file_by_id`
    + `?fileId=${fileId}`;
};

const getFileHash = (fileBuffer) =>
  crypto
    .createHash('sha1')
    .update(fileBuffer)
    .digest('hex');


const isValidUrl = (suspectedUrl) =>
  /^(ftp|http|https):\/\/[^ "]+$/
    .test(suspectedUrl);

const isValidBase64 = (suspectBase64String) =>
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
    .test(suspectBase64String);

const slugify = (string) => {
  return string
    .toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-');
};

const getSearchables = (string) => {
  const nameCharactersArray = string.split('');
  const valuesSet = new Set();
  const charsToIgnoreSet = new Set(['.', ',', '(', ')', '/', '~', '', '[', ']']);

  const getTrimmedString = stringValue => stringValue.toLowerCase().trim();

  const getValues = (string, index) => {
    const part = string.substr(0, index);

    return getTrimmedString(part);
  };

  for (let index = 0; index < nameCharactersArray.length; index++) {
    const result = getValues(string, index);
    const char = getTrimmedString(nameCharactersArray[index]);

    if (charsToIgnoreSet.has(char) || charsToIgnoreSet.has(result)) {
      continue;
    }

    valuesSet.add(result);
    valuesSet.add(char);
  }

  valuesSet.add(getTrimmedString(string));

  return [...valuesSet];
};

/**
 * Returns the `timestamp` that is closest to the current
 * `timestamp`.
 *
 * @param {Array} schedules Array of schedule objects.
 * @param {number} now Unix timestamp.
 * @returns {number} Unix timestamp.
 */
const getRelevantTime = (schedules, now = Date.now()) => {
  const allTimestamps = [];

  schedules.forEach((schedule) => {
    const {
      startTime,
      endTime,
    } = schedule;

    allTimestamps.push(startTime);
    allTimestamps.push(endTime);
  });

  let result;
  let prevDiff = 0;

  allTimestamps.forEach((ts) => {
    const currDif = ts - now;

    /** The ts is before current time */
    if (currDif < 0) {
      return;
    }

    if (!prevDiff) {
      prevDiff = currDif;
      result = ts;

      return;
    }

    if (prevDiff > currDif) {

      return;
    }

    prevDiff = currDif;
    result = ts;
  });

  console.log('result:', result);

  return result;
};

// https://github.com/freesoftwarefactory/parse-multipart
const multipartParser = (body, contentType) => {
  // Examples for content types:
  //      multipart/form-data; boundary="----7dd322351017c"; ...
  //      multipart/form-data; boundary=----7dd322351017c; ...
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  let s;
  let fieldName;

  if (!m) {
    throw new Error('Bad content-type header, no multipart boundary');
  }

  let boundary = m[1] || m[2];

  const parseHeader = (header) => {
    const headerFields = {};
    const matchResult = header.match(/^.*name="([^"]*)"$/);

    if (matchResult) {
      headerFields.name = matchResult[1];
    }

    return headerFields;
  };

  const rawStringToBuffer = (str) => {
    let idx;
    const len = str.length;
    const arr = new Array(len);

    for (idx = 0; idx < len; ++idx) {
      arr[idx] = str.charCodeAt(idx) & 0xFF;
    }

    return new Uint8Array(arr).buffer;
  };

  // \r\n is part of the boundary.
  boundary = `\r\n--${boundary}`;

  const isRaw = typeof body !== 'string';

  if (isRaw) {
    const view = new Uint8Array(body);
    s = String.fromCharCode.apply(null, view);
  } else {
    s = body;
  }

  // Prepend what has been stripped by the body parsing mechanism.
  s = `\r\n${s}`;

  const parts = s.split(new RegExp(boundary));
  const partsByName = {};

  // First part is a preamble, last part is closing '--'
  for (let i = 1; i < parts.length - 1; i++) {
    const subparts = parts[i].split('\r\n\r\n');
    const headers = subparts[0].split('\r\n');

    for (let j = 1; j < headers.length; j++) {
      const headerFields = parseHeader(headers[j]);

      if (headerFields.name) {
        fieldName = headerFields.name;
      }
    }

    partsByName[fieldName] =
      isRaw ? rawStringToBuffer(subparts[1]) : subparts[1];
  }

  return partsByName;
};

const toTwoDecimalPlace = (val) => {
  /** Is not float */
  if (parseInt(val) === val) {
    return val;
  }

  const toCeil = (number, digits) => {
    const factor = Math.pow(10, digits);

    return Math.ceil(number * factor) / factor;
  };

  const toFloor = (number, digits) => {
    const factor = Math.pow(10, digits);

    return Math.floor(number * factor) / factor;
  };

  let result;
  const parsed = val.toFixed(3);
  const lastDecimalValue = Number(parsed[parsed.length - 1]);

  if (lastDecimalValue >= 5) {
    result = toCeil(val, 2);
  } else {
    result = toFloor(val, 2);
  }

  return result;
};

const adjustedGeopoint = (geopoint) => {
  return {
    latitude: toTwoDecimalPlace(
      geopoint.latitude || geopoint._latitude
    ),
    longitude: toTwoDecimalPlace(
      geopoint.longitude || geopoint._longitude
    ),
  };
};

const sendSMS = (phoneNumber, smsText) => {
  const sendTo = phoneNumber;
  const encodedMessage = `${encodeURI(smsText)}`;

  const host = `enterprise.smsgupshup.com`;
  const path = `/GatewayAPI/rest?method=SendMessage`
    + `&send_to=${sendTo}`
    + `&msg=${encodedMessage}`
    + `&msg_type=TEXT`
    + `&userid=${env.smsgupshup.userId}`
    + `&auth_scheme=plain`
    + `&password=${env.smsgupshup.password}`
    + `&v=1.1`
    + `&format=text`;

  const params = {
    host,
    path,
    // HTTPS port is 443
    port: 443,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(params, (res) => {
      // reject on bad status
      console.log('res.statusCode', res.statusCode);

      if (res.statusCode > 226) {
        reject(new Error(`statusCode=${res.statusCode}`));

        return;
      }

      // cumulate data
      let chunks = [];

      res
        .on('data', (chunk) => chunks.push(chunk));

      // resolve on end
      res
        .on('end', () => {
          chunks = Buffer.concat(chunks).toString();

          if (chunks.includes('error')) {
            reject(new Error(chunks));

            return;
          }

          resolve(chunks);
        });
    });

    // reject on request error
    // This is not a "Second reject", just a different sort of failure
    req.on('error', (err) => {
      console.log('in err');

      reject(new Error(err));

      return;
    });

    // IMPORTANT otherwise socket won't close.
    req.end();
  });
};

const isEmptyObject = (object) =>
  Object
    .keys(object)
    .every((field) => {
      if (typeof object[field] === 'string' && object[field].trim() === '') {
        return true;
      }

      return object[field] === '';
    });


const getAdjustedGeopointsFromVenue = venue => {
  const result = [];

  venue.forEach(item => {
    const lat = item.geopoint.latitude || item.geopoint._latitude;
    const lng = item.geopoint.longitude || item.geopoint._longitude;

    if (!lat || !lng) {
      return;
    }

    const adj = adjustedGeopoint(item.geopoint);

    result.push(`${adj.latitude},${adj.longitude}`);
  });

  return result;
};

const getRegistrationToken = (phoneNumber) => {
  const result = {
    phoneNumber,
    registrationToken: null,
    updatesDocExists: false,
  };

  return rootCollections
    .updates
    .where('phoneNumber', '==', phoneNumber)
    .limit(1)
    .get()
    .then((docs) => {
      if (docs.empty) {
        return Promise.resolve(result);
      }

      const {
        registrationToken,
      } = docs.docs[0].data();

      result.registrationToken = registrationToken;
      result.updatesDocExists = !docs.empty;

      return result;
    })
    .catch(console.error);
};

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
      officeActivitySheet
        .cell(`H${rowIndex}`)
        .value(`${arrayOfUnverifiedRecipients || []}`);
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

const handleDailyStatusReport = (toEmail) => {
  const date = moment().subtract(1, 'day').format(dateFormats.DATE);
  const fileName = `Daily Status Report ${date}.xlsx`;
  const yesterday = moment().subtract(1, 'day');
  const messageObject = {
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
      const activeYesterday = handleOfficeActivityReport(
        worksheet,
        yesterdayInitDoc
      );
      handleActivityStatusReport(worksheet, counterDoc, yesterdayInitDoc);
      handleUserStatusReport(
        worksheet,
        counterDoc,
        yesterdayInitDoc,
        activeYesterday
      );

      worksheet.deleteSheet('Sheet1');

      return worksheet.outputAsync('base64');
    })
    .then((content) => {
      messageObject.to = toEmail || env.dailyStatusReportRecipients;
      messageObject
        .attachments
        .push({
          fileName,
          content,
          type: 'text/csv',
          disposition: 'attachment',
        });

      console.log('mail sent to', messageObject.to);

      return sgMail.sendMultiple(messageObject);
    })
    .catch(console.error);
};


const generateDates = (startTime, endTime) => {
  const momentStart = moment(startTime);
  const momentEnd = moment(endTime);
  const numberOfDays = momentEnd.diff(momentStart, 'days');
  const dates = [];

  for (let i = 0; i <= numberOfDays; i++) {
    const mm = moment(startTime).add(i, 'day');
    const value = mm.toDate().toDateString();

    dates.push(value);
  }

  return {
    numberOfDays: dates.length,
    dates,
  };
};

const getSitemapXmlString = () => {
  const getUrlItem = (slug, updateTime) => {
    return `<url>
      <loc>${env.mainDomain}/${slug}</loc>
      <lastmod>${updateTime.toDate().toJSON()}</lastmod>
    </url>`;
  };
  const start = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;
  const end = '</urlset>';
  let result = start;

  return rootCollections
    .offices
    .get()
    .then((docs) => {
      // For homepage
      result += `<url>
      <loc>${env.mainDomain}</loc>
        <lastmod>${new Date().toJSON()}</lastmod>
      </url>`;

      docs.forEach((doc) => {
        result += getUrlItem(doc.get('slug'), doc.updateTime);
      });

      result += end;

      // Use res.header('Content-Type', 'text/xml');
      return result;
    })
    .catch(console.error);
};

const getEmployeeFromRealtimeDb = (officeId, phoneNumber) => {
  const admin = require('firebase-admin');
  const realtimeDb = admin.database();

  if (!isNonEmptyString(officeId)) {
    throw new Error(`Invalid 'officeId'. Should be a non-emtpy string:`, officeId);
  }

  return new Promise((resolve, reject) => {
    const path = `${officeId}/employee/${phoneNumber}`;
    const ref = realtimeDb
      .ref(path);

    ref.on('value', data => resolve(data), error => reject(error));
  });
};

const addEmployeeToRealtimeDb = doc => {
  const admin = require('firebase-admin');
  const realtimeDb = admin.database();
  const phoneNumber = doc.get('attachment.Employee Contact.value');
  const officeId = doc.get('officeId');
  const ref = realtimeDb.ref(`${officeId}/employee/${phoneNumber}`);
  const status = doc.get('status');

  // Remove from the map
  if (status === 'CANCELLED') {
    return new Promise((resolve, reject) => {
      ref.remove((error) => {
        if (error) {
          reject(error);
        }

        resolve();
      });
    });
  }

  const getEmployeeDataObject = () => {
    const attachment = doc.get('attachment');
    const result = {
      createTime: doc.createTime.toDate().getTime(),
      updateTime: doc.updateTime.toDate().getTime(),
    };

    Object
      .keys(attachment)
      .forEach(item => {
        const { value } = attachment[item];

        result[item] = value;
      });

    return result;
  };

  return new Promise((resolve, reject) => {
    ref.set(getEmployeeDataObject(), error => {
      if (error) {
        return reject(error);
      }

      return resolve();
    });
  });
};

const getEmployeesMapFromRealtimeDb = officeId => {
  const admin = require('firebase-admin');
  const realtimeDb = admin.database();

  const path = `${officeId}/employee`;

  const ref = realtimeDb.ref(path);
  const employeesData = {};

  return new Promise(resolve => {
    ref.on('value', (snapShot) => {
      snapShot.forEach((doc) => {
        employeesData[doc.key] = doc.toJSON();
      });

      resolve(employeesData);
    });
  });
};


module.exports = {
  slugify,
  sendSMS,
  sendJSON,
  isValidUrl,
  getFileHash,
  headerValid,
  isValidDate,
  handleError,
  isValidEmail,
  sendResponse,
  isHHMMFormat,
  isEmptyObject,
  generateDates,
  isValidBase64,
  isValidStatus,
  disableAccount,
  hasAdminClaims,
  getSearchables,
  getISO8601Date,
  isValidTimezone,
  getRelevantTime,
  isValidGeopoint,
  multipartParser,
  hasSupportClaims,
  adjustedGeopoint,
  isNonEmptyString,
  cloudflareCdnUrl,
  isE164PhoneNumber,
  getObjectFromSnap,
  hasSuperUserClaims,
  isValidCanEditRule,
  promisifiedRequest,
  getSitemapXmlString,
  promisifiedExecFile,
  getRegistrationToken,
  reportBackgroundError,
  handleDailyStatusReport,
  hasManageTemplateClaims,
  addEmployeeToRealtimeDb,
  getEmployeeFromRealtimeDb,
  getAdjustedGeopointsFromVenue,
  getEmployeesMapFromRealtimeDb,
};
