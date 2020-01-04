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

const url = require('url');

module.exports = req => {
  const {pathname} = url.parse(req.url);
  let checkSupport = req.query.support === 'true';
  let checkAdmin = false;
  let func;

  switch (pathname.replace(/^\/|\/$/g, '')) {
    /**
     * Runs on each app(Android/iOS) initialization.
     * Method: GET
     * Request body:
     * `
     * {}
     * `
     *
     * Response body:
     *`
     * {
     *    "updateClient": <boolean>,
     *    "revokeSession": <boolean>,
     *    "success": true,
     *    "timestamp": <number>,
     *    "code": 200,
     *    "idProof": <idProof>,
     *    "potentialAlternatePhoneNumbers": Array<{office: <string>, phoneNumber: <string>}>,
     *    "linkedAccounts": Array<{ifsc: <string>, bankAccount: <string>, address1: <string>}>
     *    removeFromOffice?: Array<String>, // offices from which this user has been removed previously.
     * }
     * `
     *
     * Query params:
     *
     * `
     * {
     *    os?: <String>,
     *    deviceId: <String>
     *    ppVersion?: <String>,
     *    deviceBrand?: <String>,
     *    osVersion?: <String>,
     *    deviceModel?: <String>,
     *    removeFromOffice?: <String>, // 'true' OR 'false' in string
     *    registrationToken?: <String>, // Firebase's notification sdk token
     * }
     * `
     */
    case 'now':
      func = require('../firestore/now');
      break;
    /**
     * Creates a doc in Updates/<uid>/Addendum/<autoId>
     *
     * uid => user mentioned in the field ['assignee']
     * in the request body.
     */
    case 'dm':
      func = require('../firestore/dm');
      break;
    case 'activities/create':
      func = require('../firestore/activity/on-create');
      break;
    case 'activities/update':
      func = require('../firestore/activity/on-update');
      break;
    case 'activities/change-status':
      func = require('../firestore/activity/on-change-status');
      break;
    case 'activities/comment':
      func = require('../firestore/activity/on-comment');
      break;
    case 'activities/share':
      func = require('../firestore/activity/on-share');
      break;
    case 'admin/bulk':
      checkAdmin = true;
      checkSupport = true;
      func = require('../firestore/bulk/script');
      break;
    case 'admin/change-phone-number':
      checkAdmin = true;
      checkSupport = true;
      func = require('../firestore/phone-number-change');
      break;
    case 'remove-employee':
      checkAdmin = true;
      checkSupport = true;
      func = require('../firestore/employee-resign');
      break;
    case 'services/templates/read':
      func = require('../firestore/activity-templates/on-read');
      break;
    case 'services/logs':
      func = require('../services/on-logs');
      break;
    case 'services/images':
      func = require('../services/on-images');
      break;
    case 'parseMail':
      func = require('./../firestore/mail-parser');
      break;
    case 'admin/trigger-report':
      func = require('./../firestore/on-demand-reports');
      break;
    case 'admin/now':
      // Not used
      checkAdmin = true;
      checkSupport = true;
      func = require('./../firestore/offices/now');
      break;
    case 'admin/read':
      // Not used
      checkAdmin = true;
      checkSupport = true;
      func = require('./../firestore/offices/on-read');
      break;
    case 'update-auth':
      // Not used
      checkSupport = true;
      func = require('./../services/update-auth');
      break;
    case 'myGrowthfile':
      func = require('../firestore/my-growthfile/index');
      break;
    case 'search':
      checkAdmin = true;
      checkSupport = true;
      func = require('../firestore/search');
      break;
    case 'changePhoneNumber':
      func = require('../change-phone-number');
      break;
    case 'services/accounts':
      func = require('../services/accounts');
      break;
    case 'read1':
      func = require('../firestore/on-read1');
      break;
    case `trackMail`:
      func = require('../webhooks/sendgrid');
      break;
    case `services/office`:
      func = require('../services/office');
      break;
    case 'services/search':
      func = require('../services/search');
      break;
    case 'services/subscription':
      func = require('../services/subscription');
      break;
    case 'services/checkIns':
      func = require('../services/checkIns');
      break;
    /**
     * Accessible by anyone with auth.
     * Is used to set idProof (PAN/Aadhar) using the images
     * in base64 format.
     *
     * Method: POST
     * Request body:
     *
     * `
     * {
     *    "aadhar": {
     *      "front": <base64(image/jpg;base64)> | <https url>,
     *      "back": <base64(image/jpg;base64)> | <https url>,,
     *      "number": "" // any valid aadhar number
     *    },
     *    "pan": {
     *      "pan": <base64(image/jpg;base64)> | <https url>,,
     *      "number": "", // any valid pan
     *    }
     * }
     * `
     *
     * Response body:
     *
     * `
     * {
     *    "aadhar": {
     *      "front": "backblaze https url",
     *      "back": "backblaze https url",
     *      "number": "" // same value that was passed in the request body
     *    },
     *    "pan": {
     *      "front": "backblaze https url",
     *      "number": "" // same value that was passed in the request body
     *    }
     * }
     * `
     *
     * Query params:
     * `
     * {}
     * `
     */
    case 'services/idProof':
      func = require('../services/id-proof');
      break;
    case 'services/subscription/checkIn':
      /**
       * Accessible by anyone with auth.
       * Is used to check if the user has a check-in subscription
       * for any office
       *
       * Method: GET
       * Request body:
       * `
       * {}
       * `
       *
       * Response body:
       * `
       * {
       *    "hasCheckInSubscription": <boolean>
       * }
       * `
       * Query Params:
       * `
       * {}
       * `
       */
      func = require('../services/check-check-in-subcription');
      break;
    /**
     * 404 not found
     */
    default:
      func = null;
  }

  return {
    func,
    checkAdmin,
    checkSupport,
  };
};
