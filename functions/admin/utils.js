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


const { code, } = require('./responses');

const { rootCollections, disableUser, getGeopointObject, } = require('./admin');


/**
 * Ends the response by sending the `JSON` to the client with `200 OK` response.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} json The response object to send to the client.
 * @returns {void}
 */
const sendJSON = (conn, json) => {
  conn.res.writeHead(code.ok, conn.headers);
  conn.res.end(JSON.stringify(json));
};


/**
 * Ends the response of the request after successful completion of the task
 * or on an error.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 * @param {number} statusCode A standard HTTP status code.
 * @param {string} [message] Response message for the request.
 * @returns {void}
 */
const sendResponse = (conn, statusCode, message = '') => {
  let success = true;

  /** 2xx codes denote success. */
  if (statusCode > 226) success = false;

  conn.res.writeHead(statusCode, conn.headers);
  conn.res.end(JSON.stringify({ success, message, code: statusCode, }));
};


/**
 * Ends the response when there is an error while handling the request.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 * @param {Object} error Firebase Error object.
 * @returns {void}
 */
const handleError = (conn, error) => {
  /* eslint no-console: "off" */
  console.error(error);

  sendResponse(
    conn,
    code.internalServerError,
    'There was an error handling the request. Please try again later.'
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


/**
 * Returns the server timestamp on a `GET` request.
 *
 * @param {Object} conn Object containing Express's Request and Reponse objects.
 * @returns {void}
 */
const now = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /now endpoint.`
    );

    return;
  }

  /** Ends response. */
  sendJSON(conn, { success: true, timestamp: Date.now(), code: code.ok, });
};


/**
 * Returns the date in ISO 8601 (DD-MM-YYYY) format.
 *
 * @param {Object} date A valid Date object.
 * @returns {String} An ISO 8601 (DD-MM-YYYY) date string.
 * @see https://en.wikipedia.org/wiki/ISO_8601
 */
const getISO8601Date = (date) =>
  require('moment')(date || new Date())
    .format('DD-MM-YYYY');


/**
 * Disables the user account in auth based on uid and writes the reason to
 * the document in the profiles collection for which the account was disabled.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {string} reason For which the account is being disabled.
 * @returns {void}
 */
const disableAccount = (conn, reason) => {
  const date = new Date();

  const docId = getISO8601Date(date);

  const docObject = {
    disabledFor: reason,
    disabledTimestamp: date,
  };

  Promise
    .all([
      rootCollections
        .dailyDisabled
        .doc(docId)
        .set({
          [conn.requester.phoneNumber]: docObject,
        }, {
            /** This doc may have other fields too. */
            merge: true,
          }),
      rootCollections
        .profiles
        .doc(conn.requester.phoneNumber)
        .set(docObject, {
          /** This doc may have other fields too. */
          merge: true,
        }),
      disableUser(conn.requester.uid),
    ])
    .then(() => sendResponse(
      conn,
      code.forbidden,
      'Your account has been disabled. Please contact support.'
    ))
    .catch((error) => handleError(conn, error));
};


/**
 * Checks if the location is valid with respect to the standard
 * lat and lng values.
 *
 * @param {Object} location Contains `lat` and `lng` values.
 * @returns {boolean} If the input `latitude` & `longitude` pair is valid.
 */
const isValidGeopoint = (location) => {
  if (!location) return false;

  if (!location.hasOwnProperty('latitude')) return false;

  if (!location.hasOwnProperty('longitude')) return false;

  const lat = location.latitude;
  const lng = location.longitude;

  /** @see https://msdn.microsoft.com/en-in/library/aa578799.aspx */
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return false;

  return true;
};


/**
 * Checks for a `non-null`, `non-empty` string.
 *
 * @param {string} str A string.
 * @returns {boolean} If `str` is a non-empty string.
 */
const isNonEmptyString = (str) => {
  if (typeof str !== 'string') return false;
  if (str.trim() === '') return false;

  return true;
};


/**
 * Checks whether the number is a valid Unix timestamp.
 *
 * @param {Object} date Javascript Date object.
 * @returns {boolean} Whether the number is a *valid* Unix timestamp.
 */
const isValidDate = (date) => !isNaN(new Date(parseInt(date)));


/**
 * Verifies a phone number based on the E.164 standard.
 *
 * @param {string} phoneNumber A phone number.
 * @returns {boolean} If the number is a *valid* __E.164__ phone number.
 * @see https://en.wikipedia.org/wiki/E.164
 */
const isE164PhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return false;

  /**
   * RegExp *Explained*...
   * * ^: Matches the beginning of the string, or the beginning of a line if the multiline flag (m) is enabled.
   * * \+: Matches the `+` character
   * *[1-9]: Matches the character in range `1` to `9`
   * *\d: Matches any digit character
   * * *{5-14}: Match between 5 and 14 characters after the preceeding `+` token
   * *$: Matches the end of the string, or the end of a line if the multiple flag (m) is enabled.
   */
  const re = /^\+[1-9]\d{5,14}$/;

  return re.test(phoneNumber);
};


/**
 * Adds a doc in `/DailyActivities` collection in the path:
 * `DailyActivities/(DD-MM-YYYY)/Logs/(auto-id)` with the
 * user's phone number, timestamp of the request and the api used.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @param {number} responseCode HTTP response code.
 * @returns {void}
 */
const logDailyActivities = (conn, locals, responseCode) => {
  const docId = getISO8601Date(locals.timestamp);
  let activityId;
  let office;
  let template;

  if (conn.req.url.startsWith('/activities/create')) {
    /** For creating an activity, the request body
     * will have the `template` + `office` name.
     * AND, the activity ID will be generated by the
     * cloud function.
     */
    activityId = locals.activityRef.id;
    office = conn.req.body.office;
    template = conn.req.body.template;

    locals.responseMessage = 'The activity was successfully created.';
  } else {
    /** For all other actions related to activity,
     * the `template` + `office` will come from the activity
     * doc stored in the DB, but the activityID will come
     * from the request body.
     */
    activityId = conn.req.body.activityId;
    office = locals.activity.get('office');
    template = locals.activity.get('template');
  }

  locals.batch.set(rootCollections
    .dailyActivities
    .doc(docId)
    .collection('Logs')
    .doc(), {
      activityId,
      office,
      template,
      phoneNumber: conn.requester.phoneNumber,
      url: conn.req.url,
      timestamp: locals.timestamp,
      geopoint: getGeopointObject(conn.req.body.geopoint),
    });

  locals.batch.commit()
    .then(() => sendResponse(
      conn,
      responseCode,
      locals.responseMessage
    ))
    .catch((error) => handleError(conn, error));
};


module.exports = {
  now,
  sendJSON,
  isValidDate,
  handleError,
  sendResponse,
  disableAccount,
  getISO8601Date,
  isValidGeopoint,
  hasSupportClaims,
  isNonEmptyString,
  isE164PhoneNumber,
  logDailyActivities,
  hasSuperUserClaims,
  hasManageTemplateClaims,
};
