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
  // serverTimestamp,
  fieldPath,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');
const {
  now,
  sendJSON,
  handleError,
  sendResponse,
  disableAccount,
  hasSupportClaims,
} = require('../admin/utils');


const getHeaders = (req) => {
  const headerObject = {
    /** The pre-flight headers */
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, HEAD, POST, GET, PATCH, PUT',
    'Access-Control-Allow-Headers': 'X-Requested-With, Authorization,' +
      'Content-Type, Accept',
    // 30 days
    'Access-Control-Max-Age': 2592000,
    'Content-Type': 'application/json',
    'Content-Language': 'en-US',
    'Cache-Control': 'no-cache',
  };

  // const isProduction = require('../admin/env').isProduction;

  // if (isProduction) {
  //   headerObject['Access-Control-Allow-Origin'] = req.get('host');
  // }

  return headerObject;
};


const handleAdminUrl = (conn, urlParts) => {
  const resource = urlParts[2];

  console.log('resource', resource);

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
    require('../firestore/bulk')(conn);

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

  if (resource === 'users') {
    require('../services/users/on-read')(conn);

    return;
  }

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

  sendResponse(
    conn,
    code.notFound,
    `No resource found at the path: ${(conn.req.url)}.`
  );
};


const handleRequestPath = (conn, parsedUrl) => {
  const urlParts = parsedUrl.pathname.split('/');
  const parent = urlParts[1];

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
      const authCreationTime =
        new Date(conn.requester.creationTime).getTime();
      const NUM_MILLI_SECS_IN_MINUTE = 60000;

      if (Date.now() - authCreationTime < NUM_MILLI_SECS_IN_MINUTE) {
        handleRequestPath(conn, pathName);

        return;
      }

      if (doc.get('uid') !== conn.requester.uid) {
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
        disableAccount(
          conn,
          `The uid and phone number of the requester does not match.`
        );

        return;
      }

      handleRequestPath(conn, pathName);

      return;
    })
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
        phoneNumber: userRecord.phoneNumber,
        displayName: userRecord.displayName || '',
        customClaims: userRecord.customClaims || null,
        creationTime: userRecord.metadata.creationTime,
      };

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
        now(conn);

        return;
      }

      getProfile(conn, parsedUrl);

      return;
    })
    .catch((error) => handleError(conn, error));


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
    .catch((error) => {
      if (error.code === 'auth/id-token-revoked') {
        sendResponse(
          conn,
          code.unauthorized,
          'The idToken was revoked recently. Please re-authenticate.'
        );

        return;
      }

      if (error.code === 'auth/argument-error') {
        sendResponse(
          conn,
          code.unauthorized,
          `The idToken in the request header is invalid/expired.`
          + ` Please re-authenticate.`
        );

        return;
      }

      console.error(error);

      sendResponse(
        conn,
        code.forbidden,
        `There was an error processing the idToken sent in the request.`
        + ` Please re-authenticate.`
      );
    });
};


const handleBulkObject = (conn) => {
  const csvtojsonV2 = require('csvtojson/v2');
  const path = require('path');

  const templateName = 'customer';
  const office = 'Puja Capital';

  // TODO: Add csv file name
  const filePath =
    path.join(process.cwd(), 'file.csv');

  console.log({ filePath });

  Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', templateName)
        .limit(1)
        .get(),
      csvtojsonV2()
        .fromFile(filePath),
    ])
    .then((result) => {
      const [
        templateQuery,
        arrayOfObjects,
      ] = result;
      const templateObject =
        templateQuery.docs[0].data();

      const myObject = {
        timestamp: Date.now(),
        geopoint: {
          latitude: 28.6998822,
          longitude: 77.2549399,
        },
        template: templateName,
        office,
        data: [],
      };

      const attachmentFieldsSet =
        new Set(Object.keys(templateObject.attachment));

      const scheduleFieldsSet = new Set();
      const venueFieldsSet = new Set();

      templateObject
        .schedule
        .forEach((field) => scheduleFieldsSet.add(field));

      templateObject
        .venue
        .forEach((field) => venueFieldsSet.add(field));

      arrayOfObjects
        .forEach((object, index) => {
          const fields = Object.keys(object);
          const obj = {
            attachment: {},
            schedule: [],
            venue: [],
            share: [],
          };

          fields.forEach((field) => {
            if (attachmentFieldsSet.has(field)) {
              obj.attachment[field] = {
                type: templateObject.attachment[field].type,
                value: arrayOfObjects[index][field],
              };
            }

            if (scheduleFieldsSet.has(field)) {
              const ts = (() => {
                const date = arrayOfObjects[index][field];
                if (!date) return date;

                return new Date(date).getTime();
              })();

              obj.schedule.push({
                startTime: ts,
                name: field,
                endTime: ts,
              });
            }

            if (venueFieldsSet.has(field)) {
              const geopoint = (() => {
                const split =
                  arrayOfObjects[index][field].split(',');

                return {
                  latitude: Number(split[0]),
                  longitude: Number(split[1]),
                };
              })();

              const address = (() => {
                return '';
              })();

              const location = (() => {
                return '';
              })();

              // obj.venue.push({
              //   geopoint,
              //   venueDescriptor: field,
              //   address,
              //   location,
              // });

              obj.venue.push({
                venueDescriptor: 'Customer Office',
                address: 'Siddharth Palace, 301, 3rd Floor, Nehru Place, New Delhi, Delhi 110019',
                geopoint: {
                  latitude: 28.548201,
                  longitude: 77.2496963,
                },
                location: 'System 3',
              });
            }
          });

          myObject.data.push(obj);
        });

      conn.req.body = myObject;

      console.log(JSON.stringify(myObject, '', 2));

      // checkAuthorizationToken(conn);

      // getUserAuthFromIdToken(conn, {
      //   uid: 'hwgega5YSLTiDBS2hSd5bSv8HNL2',
      // });

      sendResponse(conn, code.ok, 'done');

      return;
    })
    .catch((error) => handleError(conn, error));
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
    headers: getHeaders(req),
  };

  if (!new Set()
    .add('OPTIONS')
    .add('HEAD')
    .add('GET')
    .add('POST')
    .add('PATCH')
    .add('PUT')
    .has(req.method)) {
    sendResponse(
      conn,
      code.notImplemented,
      `${req.method} is not supported for any request.`
      + ' Please use `GET`, `POST`, `PATCH`, or `PUT` to make your requests.'
    );

    return;
  }

  /** For handling CORS */
  if (req.method === 'HEAD' || req.method === 'OPTIONS') {
    sendResponse(conn, code.noContent);

    return;
  }

  checkAuthorizationToken(conn);
};
