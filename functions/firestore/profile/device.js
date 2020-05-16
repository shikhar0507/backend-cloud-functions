/**
 * Copyright (c) 2020 GrowthFile
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

const { sendResponse, getISO8601Date, sendJSON } = require('../../admin/utils');
const { db, rootCollections } = require('../../admin/admin');
const { code } = require('../../admin/responses');

const validator = ({
  id,
  deviceBrand,
  deviceModel,
  baseOs,
  appVersion,
  osVersion,
  radioVersion,
  idbVersion,
}) => {
  // making all fields optional as told by UI, may be enforced in future
  // eslint-disable-next-line no-constant-condition
  if (true) {
    return false;
  }

  if (!(id && id !== '')) {
    return 'id cannot be empty';
  }

  if (!(deviceBrand && deviceBrand !== '')) {
    return 'deviceBrand cannot be empty';
  }

  if (!(deviceModel && deviceModel !== '')) {
    return 'deviceModel cannot be empty';
  }

  if (!(baseOs && baseOs !== '')) {
    return 'baseOs cannot be empty';
  }

  if (!(appVersion && appVersion !== '')) {
    return 'appVersion cannot be empty';
  }

  if (!(osVersion && osVersion !== '')) {
    return 'osVersion cannot be empty';
  }

  if (!(radioVersion && radioVersion !== '')) {
    return 'radioVersion cannot be empty';
  }
  if (!(idbVersion && idbVersion !== '')) {
    return 'idbVersion cannot be empty';
  }
  return false;
};

/**
 * Returns the server timestamp on a `GET` request.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @returns {void}
 */
module.exports = async conn => {
  if (conn.req.method !== 'PUT') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /profile/device endpoint.`,
    );
  }
  const validationResult = validator(conn.req.body);
  if (validationResult) {
    return sendResponse(conn, code.badRequest, validationResult);
  }
  const {
    id,
    deviceBrand,
    deviceModel,
    baseOs,
    appVersion,
    osVersion,
    radioVersion,
    idbVersion,
  } = conn.req.body;

  const batch = db.batch();
  const [updatesDoc, timerDoc] = await Promise.all([
    rootCollections.updates.doc(conn.requester.uid).get(),
    rootCollections.timers.doc(getISO8601Date()).get(),
  ]);

  /**
   * The `authOnCreate` function executed, when the user signed up, but
   * the `/api` was executed before `authOnCreate` completed. This will result
   * in this function to crash since it assumes that the doc in the `Updates/{uid}`
   * doc exists.
   */
  if (!updatesDoc.exists) {
    return sendJSON(conn, {
      revokeSession: false,
      updateClient: false,
      success: false,
      timestamp: Date.now(),
      code: code.forbidden,
    });
  }

  if (!timerDoc.exists) {
    batch.set(
      timerDoc.ref,
      {
        timestamp: Date.now(),
        // Prevents multiple trigger events for reports.
        sent: false,
      },
      {
        merge: true,
      },
    );
  }

  const updateObject = {};
  if (!(id && id !== '')) {
    updateObject.latestDeviceId = id;
  }

  if (!(deviceBrand && deviceBrand !== '')) {
    updateObject.latestDeviceBrand = deviceBrand;
  }

  if (!(deviceModel && deviceModel !== '')) {
    updateObject.latestDeviceModel = deviceModel;
  }

  if (!(baseOs && baseOs !== '')) {
    updateObject.latestDeviceOs = baseOs;
  }

  if (!(appVersion && appVersion !== '')) {
    updateObject.latestAppVersion = appVersion;
  }

  if (!(osVersion && osVersion !== '')) {
    updateObject.latestOsVersion = osVersion;
  }

  if (!(radioVersion && radioVersion !== '')) {
    updateObject.latestRadioVersion = radioVersion;
  }
  if (!(idbVersion && idbVersion !== '')) {
    updateObject.latestIdbVersion = idbVersion;
  }

  batch.set(updatesDoc.ref, updateObject, { merge: true });

  await batch.commit();
  return sendResponse(conn, code.ok, 'Device Synced');
};
