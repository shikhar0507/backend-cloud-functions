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
  db,
  auth,
  rootCollections,
} = require('./admin');
const {
  addendumTypes,
  dateFormats,
  httpsActions,
  sendGridTemplateIds,
  reportNames,
  timezonesSet,
  subcollectionNames,
} = require('../admin/constants');
const {
  alphabetsArray,
} = require('../firestore/recipients/report-utils');
const crypto = require('crypto');
const env = require('./env');
const xlsxPopulate = require('xlsx-populate');
const momentTz = require('moment-timezone');
const sgMail = require('@sendgrid/mail');
const { execFile } = require('child_process');
const admin = require('firebase-admin');
const url = require('url');
const rpn = require('request-promise-native');
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: env.mapsApiKey,
      Promise: Promise,
    });


sgMail.setApiKey(env.sgMailApiKey);

const isValidTimezone = timezone => timezonesSet.has(timezone);

const isValidStatus = status =>
  new Set(['CANCELLED', 'CONFIRMED', 'PENDING'])
    .has(status);

const isValidCanEditRule = canEditRule =>
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
 * @param {boolean} allowEmptyStrings Whether to allow geopoints with latitude and longitude as empty strings
 * @returns {boolean} If the input `latitude` & `longitude` pair is valid.
 */
const isValidGeopoint = (geopoint, allowEmptyStrings = true) => {
  if (!geopoint) return false;
  if (!geopoint.hasOwnProperty('latitude')) return false;
  if (!geopoint.hasOwnProperty('longitude')) return false;

  if (geopoint.latitude === ''
    && geopoint.longitude === ''
    && allowEmptyStrings) return true;

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
    || phoneNumber.length < 5
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

const getObjectFromSnap = snap => {
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
 * @param {Array} schedule Array of schedule objects.
 * @returns {number} Unix timestamp.
 */
const getRelevantTime = schedule => {
  if (schedule.length === 0) {
    return null;
  }

  const allSchedules = [];

  schedule
    .forEach(object => {
      allSchedules
        .push(
          object.startTime.valueOf(),
          object.endTime.valueOf()
        );
    });

  allSchedules.sort();

  const closestTo = momentTz().valueOf();
  let result = null;

  for (let i = 0; i <= allSchedules.length; i++) {
    const item = allSchedules[i];
    const diff = item - closestTo;

    if (diff > 0) {
      result = item;
      break;
    }
  }

  /**
   * If a schedule is found with the closes future timestamp
   * using that. Else the furthest `timestmap` from the current
   * timestamp.
   *
   * If the schedule is empty, returning `null`
   */
  return result
    || allSchedules[allSchedules.length - 1]
    || null;
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

const sendSMS = async (phoneNumber, smsText) => {
  if (!env.isProduction) return;

  const sendTo = phoneNumber;
  const encodedMessage = `${encodeURI(smsText)}`;

  const host = `https://enterprise.smsgupshup.com`;
  const path = `/GatewayAPI/rest?method=SendMessage`
    + `&send_to=${sendTo}`
    + `&msg=${encodedMessage}`
    + `&msg_type=TEXT`
    + `&userid=${env.smsgupshup.userId}`
    + `&auth_scheme=plain`
    + `&password=${env.smsgupshup.password}`
    + `&v=1.1`
    + `&format=text`;

  try {
    return rpn(url.resolve(host, path));
  } catch (error) {
    console.error(error);
  }
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
  userStatusSheet.row(1).style('bold', true);
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

const handleOfficeActivityReport = (worksheet, yesterdayInitDoc, emailStatusMap) => {
  let activeYesterday = 0;
  const officeActivitySheet = worksheet.addSheet('Office Activity Report');

  officeActivitySheet.row(1).style('bold', true);
  officeActivitySheet.cell('A1').value('');
  officeActivitySheet.cell('B1').value('Total Users');
  officeActivitySheet.cell('C1').value('Users Active Yesterday');
  officeActivitySheet.cell('D1').value('Inactive');
  officeActivitySheet.cell('E1').value('Others (users On Leave/On Duty/Holiday/Weekly Off');
  officeActivitySheet.cell('F1').value('Pending Signups');
  officeActivitySheet.cell('G1').value('Activities Created Yesterday');
  officeActivitySheet.cell('H1').value('Unverified Recipients');
  officeActivitySheet.cell('I1').value('Email Status');

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

      const mailObject = emailStatusMap[office];

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
      officeActivitySheet
        .cell(`I${rowIndex}`)
        .value(JSON.stringify(mailObject));
    });

  return activeYesterday;
};


const handleActivityStatusReport = async (worksheet, counterDoc, yesterdayInitDoc) => {
  const activityStatusSheet = worksheet.addSheet('Activity Status Report');

  // sort by company, report, timestamp
  [
    'Templates',
    'Total',
    'Created by Admin',
    'Created by Support',
    'Created by App',
    'System Created',
    'Created Yesterday',
    'Updated Yesterday',
    'Status Changed Yesterday',
    'Shared Yesterday',
    'Commented Yesterday',
  ].forEach((field, index) => {
    activityStatusSheet.cell(`${alphabetsArray[index]}1`).value(field);
  });

  const {
    adminApiMap,
    supportMap,
    totalByTemplateMap,
    autoGeneratedMap,
  } = counterDoc.data();

  const {
    templateUsageObject,
  } = yesterdayInitDoc.data();
  const templateDocs = await rootCollections
    .activityTemplates
    .orderBy('name', 'asc')
    .get();

  const templateNames = templateDocs.docs.map(doc => doc.get('name'));

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
      // System Created
      .value(autoGeneratedMap[name] || 0);

    const getCount = action => {
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

const getEmailStatusMap = () => {
  const recipientPromises = [];
  const moment = require('moment');
  const dayStartUnix = moment().startOf('day');
  const dayEndUnix = dayStartUnix.clone().endOf('day');
  const map = new Map();
  const officeNameIndex = [];

  return rootCollections
    .recipients
    .get()
    .then(docs => {
      docs.forEach(doc => {
        const promise = doc
          .ref
          .collection('MailEvents')
          .where('timestamp', '>=', dayStartUnix.valueOf())
          .where('timestamp', '<=', dayEndUnix.valueOf())
          .limit(1)
          .get();

        officeNameIndex.push(doc.get('office'));

        recipientPromises.push(promise);
      });

      return Promise.all(recipientPromises);
    })
    .then(snapShots => {
      snapShots.forEach((snapShot, index) => {
        const officeName = officeNameIndex[index];

        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const emailObject = doc.data();

        Object
          .keys(emailObject)
          .forEach(email => {
            if (email === 'timestamp') return;

            const sgItem = emailObject[email];
            const openedFootprints = sgItem.open && sgItem.open.footprints;
            const deliveredFootprints = sgItem.delivered && sgItem.delivered.footprints;
            const openedPayroll = sgItem.open && sgItem.open.payroll;
            const deliveredPayroll = sgItem.delivered && sgItem.delivered.payroll;
            const status = map.get(officeName) || {};

            status[email] = status[email] || {};
            status[email].footprints = status[email].footprints || {};
            status[email].payroll = status[email].payroll || {};
            status[email].footprints.opened = Boolean(openedFootprints);
            status[email].footprints.delivered = Boolean(deliveredFootprints);
            status[email].payroll.opened = Boolean(openedPayroll);
            status[email].payroll.delivered = Boolean(deliveredPayroll);

            map.set(officeName, status);
          });
      });

      const mapToObj = map => {
        const obj = {};

        map.forEach((v, k) => obj[k] = v);

        return obj;
      };

      return mapToObj(map);
    });
};

const handleMailEventsReport = async worksheet => {
  const sheet = worksheet.addSheet('Mail Events');
  const momentYesterday = momentTz().subtract(0, 'day');
  const start = momentYesterday.clone().startOf('day').valueOf();
  const end = momentYesterday.clone().endOf('day').valueOf();

  // emailSentAt
  const docs = await rootCollections
    .mailEvents
    .where('emailSentAt', '>=', start)
    .where('emailSentAt', '<=', end)
    .orderBy('emailSentAt', 'asc')
    .get();

  // sort by company, report, timestamp
  const dataMap = new Map();

  console.log('docs', docs.size);

  docs.forEach(doc => {
    const { office, report } = doc.data();
    const key = `${office}-${report}`;
    const oldArr = dataMap.get(key) || [];
    oldArr.push(doc);
    dataMap.set(key, oldArr);
  });

  [
    'Email',
    'Email Sent At',
    'Event',
    'IP',
    'Office',
    'Report Name',
    'Sendgrid Webhook Timestamp', // timestamp in sendgrid webhook in seconds
    'Webhook Received At',
  ].forEach((value, idx) => {
    sheet
      .cell(`${alphabetsArray[idx]}1`)
      .value(value);
  });

  let outerIndex = 0;

  dataMap.forEach(arr => {
    arr.forEach(doc => {
      const {
        email,
        emailSentAt,
        event,
        ip,
        office,
        reportName,
        timestamp: sendgridWebhookTimestamp,
        webhookReceivedAt,
      } = doc.data();

      const idx = outerIndex + 2;

      const t = (() => {
        if (!Number.isInteger(sendgridWebhookTimestamp)) {
          return '';
        }

        return momentTz(sendgridWebhookTimestamp * 1000).format(dateFormats.DATE_TIME);
      })();

      const t2 = (() => {
        if (!Number.isInteger(webhookReceivedAt)) {
          return '';
        }

        return momentTz(webhookReceivedAt).format(dateFormats.DATE_TIME);
      })();

      sheet.cell(`A${idx}`).value(email);
      sheet.cell(`B${idx}`).value(momentTz(emailSentAt).format(dateFormats.DATE_TIME));
      sheet.cell(`C${idx}`).value(event);
      sheet.cell(`D${idx}`).value(ip);
      sheet.cell(`E${idx}`).value(office);
      sheet.cell(`F${idx}`).value(reportName);
      sheet.cell(`G${idx}`).value(t);
      sheet.cell(`H${idx}`).value(t2);

      outerIndex++;
    });

  });

  return worksheet;
};

const handleDailyStatusReport = async toEmail => {
  const momentYesterday = momentTz().subtract(1, 'day');
  const date = momentYesterday.format(dateFormats.DATE);
  const fileName = `Daily Status Report ${date}.xlsx`;
  const messageObject = {
    to: toEmail || env.dailyStatusReportRecipients,
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

  try {
    const [
      worksheet,
      counterInitQuery,
      yesterdayInitQuery,
      emailStatusMap,
    ] = await Promise
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
          .where('date', '==', momentYesterday.date())
          .where('month', '==', momentYesterday.month())
          .where('year', '==', momentYesterday.year())
          .limit(1)
          .get(),
        getEmailStatusMap()
      ]);

    const [counterDoc] = counterInitQuery.docs;
    const [yesterdayInitDoc] = yesterdayInitQuery.docs;

    const activeYesterday = handleOfficeActivityReport(
      worksheet,
      yesterdayInitDoc,
      emailStatusMap
    );

    await handleActivityStatusReport(
      worksheet,
      counterDoc,
      yesterdayInitDoc
    );

    handleUserStatusReport(
      worksheet,
      counterDoc,
      yesterdayInitDoc,
      activeYesterday
    );

    await handleMailEventsReport(
      worksheet
    );

    worksheet.deleteSheet('Sheet1');

    messageObject
      .attachments
      .push({
        fileName,
        type: 'text/csv',
        disposition: 'attachment',
        content: await worksheet.outputAsync('base64'),
      });

    console.log('mail sent to', messageObject.to);

    return sgMail.sendMultiple(messageObject);
  } catch (error) {
    console.error(error);

    return;
  }
};


const generateDates = (startTime, endTime) => {
  const momentStart = momentTz(startTime);
  const momentEnd = momentTz(endTime);
  const numberOfDays = momentEnd.diff(momentStart, 'days');
  const dates = [];

  for (let i = 0; i <= numberOfDays; i++) {
    const mm = momentTz(startTime).add(i, 'day');
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

const addEmployeeToRealtimeDb = async doc => {
  const admin = require('firebase-admin');
  const realtimeDb = admin.database();
  const phoneNumber = doc.get('attachment.Employee Contact.value');
  const officeId = doc.get('officeId');
  const ref = realtimeDb.ref(`${officeId}/employee/${phoneNumber}`);
  const status = doc.get('status');

  const getEmployeeDataObject = (options = {}) => {
    if (status === 'CANCELLED') {
      return null;
    }

    const attachment = doc.get('attachment');
    const result = Object.assign({}, options, {
      createTime: doc.createTime.toDate().getTime(),
      updateTime: doc.updateTime.toDate().getTime(),
    });

    Object
      .keys(attachment)
      .forEach(item => {
        const { value } = attachment[item];

        result[item] = value;
      });

    return result;
  };

  try {
    const updatesQueryResult = await rootCollections
      .updates
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    const options = {
      hasInstalled: !updatesQueryResult.empty,
    };

    const baseLocation = doc.get('attachment.Base Location.value');
    const timezone = doc.get('timezone') || 'Asia/Kolkata';

    if (baseLocation) {
      const baseLocationQueryResult = await rootCollections
        .activities
        .where('office', '==', doc.get('office'))
        .where('template', '==', 'branch')
        .where('attachment.Name.value', '==', baseLocation)
        .limit(1)
        .get();

      if (!baseLocationQueryResult.empty) {
        const baseLocationDoc = baseLocationQueryResult.docs[0];
        const schedule = baseLocationDoc.get('schedule');
        const branchHolidays = {};

        schedule.forEach(object => {
          const { startTime } = object;

          if (!startTime) return;

          const formattedDate = momentTz(startTime)
            .tz(timezone)
            .format(dateFormats.DATE);

          branchHolidays[formattedDate] = true;
        });

        options['Weekly Off'] = baseLocationDoc.get('attachment.Weekly Off.value');

        options.branchHolidays = branchHolidays;
      }
    }

    const leaves = await rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('template', '==', 'leave')
      .where('isCancelled', '==', false)
      .where('creator.phoneNumber', '==', phoneNumber)
      .where('creationYear', '==', momentTz().tz(timezone).year())
      .get();

    leaves.forEach(doc => {
      const leaveType = doc.get('attachment.Leave Type.value') || 'unset';

      options.leaves = options.leaves || {};
      options.leaves[leaveType] = options.leaves[leaveType] || 0;
      options.leaves[leaveType]++;
    });

    return ref.set(getEmployeeDataObject(options));
  } catch (error) {
    console.error(error);
  }
};

const getEmployeesMapFromRealtimeDb = officeId => {
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

const millitaryToHourMinutes = fourDigitTime => {
  if (!fourDigitTime) return '';

  let hours = Number(fourDigitTime.substring(0, 2));
  let minutes = Number(fourDigitTime.substring(2));

  if (hours < 10) hours = `0${hours}`;
  if (minutes < 10) minutes = `0${minutes}`;

  return `${hours}:${minutes}`;
};

const getCustomerName = (addressComponents, nameFromUser = '') => {
  // old: (sublocaliy1 + sublocality2 + locality)
  // new: sublocality_level_1 + administrative_area_level_1 (long_name) + admininstrative_area_level_1 (short_name)
  let locationName = '';

  addressComponents.forEach(component => {
    const {
      types,
      short_name,
      long_name,
    } = component;

    if (types.includes('sublocality_level_1')) {
      locationName += ` ${long_name} `;
    }

    if (types.includes('administrative_area_level_2')) {
      locationName += ` ${long_name} `;
    }

    if (types.includes('administrative_area_level_1')) {
      locationName += ` ${short_name} `;
    }
  });

  return `${nameFromUser.substring(0, 10)}`
    + ` ${locationName}`
      .trim()
      // Replace double spaces and other non-printable chars
      .replace(/\s\s+/g, ' ');
};

const getCustomerObject = async queryObject => {
  try {
    const templateQueryResult = await rootCollections
      .activityTemplates
      .where('name', '==', 'customer')
      .limit(1)
      .get();

    const templateDoc = templateQueryResult.docs[0];
    const activityObject = {
      attachment: templateDoc.get('attachment'),
      schedule: templateDoc.get('schedule').map(name => {
        return ({ name, startTime: '', endTime: '' });
      }),
      venue: templateDoc.get('venue').map(venueDescriptor => {
        return ({
          venueDescriptor,
          location: '',
          address: '',
          geopoint: {
            latitude: '',
            longitude: '',
          },
        });
      }),
    };

    const placesApiResponse = await googleMapsClient
      .places({
        query: queryObject.address,
      })
      .asPromise();
    let success = true;

    const firstResult = placesApiResponse
      .json
      .results[0];
    success = Boolean(firstResult);

    if (!success) {
      return Object.assign({}, queryObject, { failed: !success });
    }

    activityObject
      .venue[0]
      .geopoint
      .latitude = firstResult.geometry.location.lat;
    activityObject
      .venue[0]
      .geopoint
      .longitude = firstResult.geometry.location.lng;
    activityObject
      .venue[0]
      .placeId = firstResult['place_id'];

    const placeApiResult = await googleMapsClient
      .place({
        placeid: firstResult['place_id'],
      })
      .asPromise();

    activityObject
      .attachment
      .Name
      .value = getCustomerName(
        placeApiResult.json.result.address_components,
        queryObject.location,
      );

    activityObject
      .venue[0]
      .address = placeApiResult.json.result.formatted_address;

    activityObject
      .venue[0]
      .location = activityObject.attachment.Name.value;

    const dailyStartTime = (() => {
      const openingHours = placeApiResult
        .json
        .result['opening_hours'];

      if (!openingHours) return '';

      const periods = openingHours.periods;
      const relevantObject = periods.filter(item => {
        return item.close && item.close.day === 1;
      });

      if (!relevantObject[0]) return '';

      return relevantObject[0].open.time;
    })();

    const dailyEndTime = (() => {
      const openingHours = placeApiResult
        .json
        .result['opening_hours'];

      if (!openingHours) return '';

      const periods = openingHours.periods;
      const relevantObject = periods.filter(item => {
        return item.close && item.close.day === 1;
      });

      if (!relevantObject[0]) return '';

      return relevantObject[0].close.time;
    })();

    const weeklyOff = (() => {
      const openingHours = placeApiResult
        .json
        .result['opening_hours'];

      if (!openingHours) return '';

      const weekdayText = openingHours['weekday_text'];

      if (!weekdayText) return '';

      const closedWeekday = weekdayText
        // ['Sunday: Closed']
        .filter(str => str.includes('Closed'))[0];

      if (!closedWeekday) return '';

      const parts = closedWeekday.split(':');

      if (!parts[0]) return '';

      // ['Sunday' 'Closed']
      return parts[0].toLowerCase();
    })();

    activityObject
      .attachment['Daily Start Time']
      .value = millitaryToHourMinutes(dailyStartTime);
    activityObject
      .attachment['Daily End Time']
      .value = millitaryToHourMinutes(dailyEndTime);
    activityObject
      .attachment['Weekly Off']
      .value = weeklyOff;

    return activityObject;
  } catch (error) {
    console.error(error);

    return Object.assign({}, queryObject, { failed: true });
  }
};


const addressToCustomer = async queryObject => {
  const activityObject = {
    placeId: '',
    venueDescriptor: 'Customer Office',
    location: queryObject.location,
    address: queryObject.address,
    latitude: '',
    longitude: '',
    Name: '',
    'First Contact': '',
    'Second Contact': '',
    'Customer Type': '',
    'Customer Code': '',
    'Daily Start Time': '',
    'Daily End Time': '',
    'Weekly Off': '',
  };

  let success = false;

  try {
    const placesApiResponse = await googleMapsClient
      .places({
        query: queryObject.address,
      })
      .asPromise();

    const firstResult = placesApiResponse
      .json
      .results[0];
    success = Boolean(firstResult);

    if (!success) {
      return Object.assign({}, queryObject, { success });
    }

    activityObject
      .latitude = firstResult.geometry.location.lat;
    activityObject
      .longitude = firstResult.geometry.location.lng;
    activityObject
      .placeId = firstResult['place_id'];

    const placeApiResult = await googleMapsClient
      .place({
        placeid: firstResult['place_id'],
      })
      .asPromise();

    activityObject
      .Name = getCustomerName(
        placeApiResult.json.result.address_components,
        queryObject.location,
      );
    activityObject
      .location = activityObject.Name;

    const weekdayStartTime = (() => {
      const openingHours = placeApiResult
        .json
        .result['opening_hours'];

      if (!openingHours) return '';

      const periods = openingHours.periods;
      const relevantObject = periods.filter(item => {
        return item.close && item.close.day === 0;
      });

      if (!relevantObject[0]) return '';

      return relevantObject[0].open.time;
    })();

    const weekdayEndTime = (() => {
      const openingHours = placeApiResult
        .json
        .result['opening_hours'];

      if (!openingHours) return '';

      const periods = openingHours.periods;
      const relevantObject = periods.filter(item => {
        return item.close && item.close.day === 0;
      });

      if (!relevantObject[0]) return '';

      return relevantObject[0].close.time;
    })();

    const weeklyOff = (() => {
      const openingHours = placeApiResult
        .json
        .result['opening_hours'];

      if (!openingHours) return '';

      const weekdayText = openingHours['weekday_text'];

      if (!weekdayText) return '';

      const closedWeekday = weekdayText
        // ['Sunday: Closed']
        .filter(str => str.includes('Closed'))[0];

      if (!closedWeekday) return '';

      const parts = closedWeekday.split(':');

      if (!parts[0]) return '';

      // ['Sunday' 'Closed']
      return parts[0].toLowerCase();
    })();

    activityObject[
      'Daily Start Time'
    ] = millitaryToHourMinutes(weekdayStartTime);
    activityObject[
      'Daily End Time'
    ] = millitaryToHourMinutes(weekdayEndTime);

    activityObject[
      'Weekly Off'
    ] = weeklyOff;

    return activityObject;
  } catch (error) {
    console.error(error);

    return queryObject;
  }
};

const filterPhoneNumber = phoneNumber =>
  phoneNumber
    .replace(/[()']+/g, '')
    .replace(/[-]/g, '')
    .replace(/ +/g, '')
    .trim();

const replaceNonASCIIChars = str =>
  // https://www.w3resource.com/javascript-exercises/javascript-string-exercise-32.php
  str
    .replace(/[^\x20-\x7E]/g, '')
    .trim();

const getBranchName = addressComponents => {
  // (sublocaliy1 + sublocality2 + locality)
  // OR "20chars of address + 'BRANCH'"
  let locationName = '';

  addressComponents.forEach(component => {
    const { types, short_name } = component;

    if (types.includes('sublocality_level_1')) {
      locationName += ` ${short_name}`;
    }

    if (types.includes('sublocality_level_2')) {
      locationName += ` ${short_name}`;
    }

    if (types.includes('locality')) {
      locationName += ` ${short_name}`;
    }
  });

  return `${locationName} BRANCH`.trim();
};

const getUsersWithCheckIn = async officeId => {
  const checkInSubscriptions = await rootCollections
    .offices
    .doc(officeId)
    .collection('Activities')
    .where('template', '==', 'subscription')
    .where('attachment.Template.value', '==', 'check-in')
    .where('status', '==', 'CONFIRMED')
    .get();

  return checkInSubscriptions
    .docs
    .map(doc => doc.get('attachment.Subscriber.value'));
};

const getAuth = async phoneNumber => {
  return auth
    .getUserByPhoneNumber(phoneNumber)
    .catch(() => {
      return ({
        phoneNumber,
        uid: null,
        email: '',
        emailVerified: false,
        displayName: '',
      });
    });
};

const findKeyByValue = (obj, value) =>
  Object.keys(obj).find(key => obj[key] === value);


const getNumbersbetween = (start, end) => {
  return new Array(end - start)
    .fill()
    .map((d, i) => i + start);
};

const getAttendancesPath = params => {
  const {
    startTime,
    endTime,
    officeId,
    phoneNumber,
    collectionName,
  } = params;
  const now = momentTz(startTime)
    .clone();
  const end = momentTz(endTime);
  const result = [];

  while (now.isSameOrBefore(end)) {
    const monthYearString = now
      .format(dateFormats.MONTH_YEAR);

    const ref = rootCollections
      .offices
      .doc(officeId)
      .collection(collectionName || subcollectionNames.ATTENDANCES)
      .doc(monthYearString)
      .collection(phoneNumber)
      .doc(`${now.date()}`);

    result
      .push(ref.get());

    now
      .add(1, 'day');
  }

  return result;
};

const getCanEditValue = (doc, requester) => {
  const canEditRule = doc.get('canEditRule');

  if (canEditRule === 'ALL'
    /**
     * Support can edit all activities
     */
    || (requester.customClaims && requester.customClaims.support)) {
    return true;
  }

  if (canEditRule === 'EMPLOYEE') {
    return requester.employeeOf
      && requester.employeeOf.hasOwnProperty(doc.get('office'));
  }

  if (canEditRule === 'ADMIN') {
    return requester.customClaims
      && Array.isArray(requester.customClaims.admin)
      && requester.customClaims.admin.includes(doc.get('office'));
  }

  if (canEditRule === 'CREATOR') {
    return (
      doc.get('creator')
      || doc.get('creator.phoneNumber')
    ) === requester.phoneNumber;
  }

  return false;
};

const enumerateDaysBetweenDates = (start, end, format) => {
  const now = momentTz(start).clone();
  const dates = new Set();

  while (now.isSameOrBefore(momentTz(end))) {
    const formattedDate = (() => {
      if (typeof format === 'string') {
        return now.format(format);
      }

      return now.format();
    })();

    dates
      .add(formattedDate);
    now
      .add(1, 'days');
  }

  return [...dates.keys()];
};

const getDatesToMonthsMap = (startDate, endDate) => {
  const map = new Map();
  const now = startDate.clone();

  while (now.isSameOrBefore(endDate)) {
    const date = now.date();
    const month = now.month();

    const old = map.get(month) || [];
    old.push(date);
    map.set(month, old);
  }

  return map;
};

const getDefaultAttendanceObject = () => {
  return {
    isLate: false,
    holiday: false,
    attendance: 0,
    addendum: [],
    working: {
      firstCheckInTimestamp: '',
      lastCheckInTimestamp: '',
      numberOfCheckIns: 0,
    },
    ar: {
      reason: '',
      CONFIRMED: {
        phoneNumber: '',
        timestamp: '',
      },
      PENDING: {
        phoneNumber: '',
        timestamp: '',
      },
      CANCELLED: {
        phoneNumber: '',
        timestamp: '',
      },
    },
    leave: {
      reason: '',
      leaveType: '',
      CONFIRMED: {
        phoneNumber: '',
        timestamp: '',
      },
      PENDING: {
        phoneNumber: '',
        timestamp: '',
      },
      CANCELLED: {
        phoneNumber: '',
        timestamp: '',
      },
    },
  };
};


const getEmployeeReportData = async (officeId, phoneNumber) => {
  const employeeQueryResult = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ACTIVITIES)
    .where('attachment.Employee Contact.value', '==', phoneNumber)
    .where('template', '==', 'employee')
    .where('status', '==', 'CONFIRMED')
    .limit(1)
    .get();

  if (employeeQueryResult.empty) {
    return {
      phoneNumber,
      id: '',
      activationDate: null,
      employeeName: '',
      employeeCode: '',
      baseLocation: '',
      region: '',
      department: '',
      minimumDailyActivityCount: '',
      minimumWorkingHours: '',
      locationValidationCheck: '',
    };
  }

  const employeeDoc = employeeQueryResult.docs[0];

  return {
    phoneNumber,
    id: employeeDoc.id,
    locationValidationCheck: employeeDoc.get('attachment.Location Validation Check.value'),
    activationDate: employeeDoc.createTime.toMillis(),
    employeeName: employeeDoc.get('attachment.Name.value'),
    employeeCode: employeeDoc.get('attachment.Employee Code.value'),
    baseLocation: employeeDoc.get('attachment.Base Location.value'),
    region: employeeDoc.get('attachment.Region.value'),
    department: employeeDoc.get('attachment.Department.value'),
    minimumDailyActivityCount: employeeDoc.get('attachment.Minimum Daily Activity Count.value'),
    minimumWorkingHours: employeeDoc.get('attachment.Minimum Working Hours.value'),
  };
};


const populateWeeklyOffInAttendance = async params => {
  const {
    month,
    year,
    employeeDoc,
    uid,
  } = params;

  if (!employeeDoc) {
    return;
  }

  const {
    office,
    officeId,
    attachment: {
      'Employee Contact': {
        value: phoneNumber,
      },
      'Base Location': {
        value: baseLocation,
      },
    },
  } = employeeDoc.data();

  const attendanceDoc = (
    await rootCollections
      .offices
      .doc(officeId)
      .collection('Attendances')
      .where('phoneNumber', '==', phoneNumber)
      .where('month', '==', month)
      .where('year', '==', year)
      .limit(1)
      .get()
  ).docs[0];

  console.log('baseLocation', baseLocation);

  const attendanceData = attendanceDoc ? attendanceDoc.data() : {};
  const attendanceRef = attendanceDoc ? attendanceDoc.ref : rootCollections
    .offices
    .doc(officeId)
    .collection('Attendances')
    .doc();
  const branchDoc = (
    await rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('template', '==', 'branch')
      .where('attachment.Name.value', '==', baseLocation)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get()
  ).docs[0];

  /**
   * Redundant because branch should exist
   * if assigned to an employee
   */
  if (!branchDoc) {
    console.log('no branch set');
    return;
  }

  attendanceData
    .attachment = attendanceData
      .attachment || {};

  const batch = db.batch();
  const weeklyOff = branchDoc.get('attachment.Weekly Off.value');
  const datesInMonth = getNumbersbetween(
    1,
    momentTz().month(month).year(year).daysInMonth() + 1
  );

  datesInMonth.forEach(date => {
    attendanceData
      .attendance[
      date
    ] = attendanceData.attendance[date] || getDefaultAttendanceObject();

    if (!weeklyOff) {
      return;
    }

    const weekdayName = momentTz()
      .month(month)
      .year(year)
      .date(date)
      .format('dddd')
      .toLowerCase();

    if (weekdayName !== weeklyOff) {
      return;
    }

    attendanceData
      .attendance[
      date
    ].weeklyOff = true;
    attendanceData
      .attendance[
      date
    ] = 1;

    const updatesRef = rootCollections
      .updates
      .doc(uid)
      .collection('Addendum')
      .doc();

    batch
      .set(updatesRef, {
        uid,
        date,
        month,
        year,
        office,
        officeId,
        phoneNumber,
        key: momentTz()
          .date(date)
          .month(month)
          .year(year)
          .startOf('date')
          .valueOf(),
        id: `${date}${month}${year}${officeId}`,
        _type: addendumTypes.ATTENDANCE,
        timestamp: Date.now(),
      });
  });

  const holidays = branchDoc.get('schedule');

  holidays
    .forEach(holiday => {
      const { startTime } = holiday;

      if (!Number.isInteger(startTime)) {
        return;
      }

      // Not adjusting timezone
      const momentStartTime = momentTz(startTime);
      // .tz(timezone);
      const startTimeDate = momentStartTime.date();

      if (momentStartTime.month() !== month) {
        return;
      }

      if (momentStartTime.year() !== year) {
        return;
      }

      attendanceData
        .attendance[
        startTimeDate
      ] = attendanceData.attendance[startTimeDate] || getDefaultAttendanceObject();

      attendanceData
        .attendance[
        startTimeDate
      ].holiday = true;

      attendanceData
        .attendance[
        startTimeDate
      ].attendance = 1;

      const updatesRef = rootCollections
        .updates
        .doc(uid)
        .collection('Addendum')
        .doc();

      batch
        .set(updatesRef, {
          uid,
          month,
          year,
          office,
          officeId,
          phoneNumber,
          date: startTimeDate,
          key: momentTz()
            .date(startTimeDate)
            .month(month)
            .year(year)
            .startOf('date')
            .valueOf(),
          id: `${startTimeDate}${month}${year}${officeId}`,
          _type: addendumTypes.ATTENDANCE,
          timestamp: Date.now(),
        });
    });

  const employeeData = {
    phoneNumber,
    id: employeeDoc.id,
    activationDate: employeeDoc.createTime.toMillis(),
    employeeName: employeeDoc.get('attachment.Name.value'),
    employeeCode: employeeDoc.get('attachment.Employee Code.value'),
    baseLocation: employeeDoc.get('attachment.Base Location.value'),
    region: employeeDoc.get('attachment.Region.value'),
    department: employeeDoc.get('attachment.Department.value'),
    minimumDailyActivityCount: employeeDoc.get('attachment.Minimum Daily Activity Count.value'),
    minimumWorkingHours: employeeDoc.get('attachment.Minimum Working Hours.value'),
  };

  batch
    .set(attendanceRef,
      Object.assign({}, employeeData, attendanceData), {
      merge: true,
    });

  return batch
    .commit();
};


const getScheduleDates = scheduleObjects => {
  const allDateStrings = [];

  scheduleObjects.forEach(o => {
    const { startTime: startDate, endTime: endDate } = o;
    const items = enumerateDaysBetweenDates(startDate, endDate, dateFormats.DATE);

    items
      .forEach(i => allDateStrings.push(i));
  });

  return allDateStrings;
};

const getLatLngString = location =>
  `${location._latitude || location.latitude}`
  + `,`
  + `${location._longitude || location.longitude}`;

const getDistanceFromDistanceMatrix = async (origin, destination) => {
  const result = await googleMapsClient
    .distanceMatrix({
      /**
       * Ordering is important here. The `legal` distance
       * between A to B might not be the same as the legal
       * distance between B to A. So, do not mix the ordering.
       */
      origins: getLatLngString(origin),
      destinations: getLatLngString(destination),
      units: 'metric',
    })
    .asPromise();

  const distanceData = result
    .json
    .rows[0]
    .elements[0]
    .distance;

  /**
   * Not all origin => destinations might have a legal
   * road path
   * For those cases, distance travelled will be assumed
   * to be 0. And km allowance will not be created.
   */
  return distanceData ? distanceData.value / 1000 : 0;
};


module.exports = {
  getLatLngString,
  getDistanceFromDistanceMatrix,
  populateWeeklyOffInAttendance,
  getScheduleDates,
  getAuth,
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
  getBranchName,
  findKeyByValue,
  disableAccount,
  hasAdminClaims,
  getSearchables,
  getISO8601Date,
  isValidTimezone,
  getRelevantTime,
  getCanEditValue,
  isValidGeopoint,
  multipartParser,
  hasSupportClaims,
  isNonEmptyString,
  cloudflareCdnUrl,
  adjustedGeopoint,
  filterPhoneNumber,
  getCustomerObject,
  isE164PhoneNumber,
  addressToCustomer,
  getNumbersbetween,
  getObjectFromSnap,
  hasSuperUserClaims,
  getAttendancesPath,
  isValidCanEditRule,
  promisifiedRequest,
  getUsersWithCheckIn,
  getSitemapXmlString,
  promisifiedExecFile,
  getDatesToMonthsMap,
  getRegistrationToken,
  replaceNonASCIIChars,
  getEmployeeReportData,
  millitaryToHourMinutes,
  handleDailyStatusReport,
  hasManageTemplateClaims,
  addEmployeeToRealtimeDb,
  getEmployeeFromRealtimeDb,
  enumerateDaysBetweenDates,
  getDefaultAttendanceObject,
  getAdjustedGeopointsFromVenue,
  getEmployeesMapFromRealtimeDb,
};
