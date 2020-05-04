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
  sendResponse,
  getISO8601Date,
  sendJSON,
  maskLastDigits,
} = require('../../admin/utils');
const { subcollectionNames } = require('../../admin/constants');
const { db, rootCollections } = require('../../admin/admin');
const { code } = require('../../admin/responses');
const momentTz = require('moment-timezone');

const getUsersWithProbablySameDevice = async (
  deviceId,
  phoneNumber,
  authCreatedAt,
) => {
  const result = [];

  if (momentTz().diff(momentTz(authCreatedAt), 'minutes') > 5) {
    return result;
  }

  if (typeof deviceId !== 'string') {
    return result;
  }

  const potentialNumbers = (
    await rootCollections.updates
      .where('deviceIdsArray', 'array-contains', deviceId)
      .select('phoneNumber')
      .get()
  ).docs.reduce((prev, doc) => {
    const { phoneNumber } = doc.data();
    prev.push(phoneNumber);

    return prev;
  }, []);

  const usersCurrentNumberIndex = potentialNumbers.indexOf(phoneNumber);

  if (usersCurrentNumberIndex > -1) {
    potentialNumbers.splice(usersCurrentNumberIndex, 1);
  }

  const subscriptionPromises = potentialNumbers
    .filter(Boolean)
    .map(phoneNumber =>
      rootCollections.profiles
        .doc(phoneNumber)
        .collection(subcollectionNames.SUBSCRIPTIONS)
        .get(),
    );

  const snaps = await Promise.all(subscriptionPromises);
  const uniqueCombinations = new Set();

  snaps.forEach(snap => {
    snap.forEach(doc => {
      const { office, template } = doc.data();
      const { path } = doc.ref;
      const phoneNumber = path.split('/')[1];
      const id = `${office}${template}${phoneNumber}`;

      if (uniqueCombinations.has(id)) {
        return;
      }

      result.push({ office, phoneNumber });
      uniqueCombinations.add(id);
    });
  });

  return result;
};

/**
 * Returns the server timestamp on a `GET` request.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @returns {void}
 */
module.exports = async conn => {
  if (conn.req.method !== 'GET') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /now endpoint.`,
    );
  }

  if (
    conn.req.query.hasOwnProperty('registrationToken') &&
    typeof conn.req.query.registrationToken !== 'string' &&
    conn.req.query.registrationToken !== null
  ) {
    return sendResponse(
      conn,
      code.badRequest,
      `The query param 'registrationToken' can either be a non-empty` +
        ` string or 'null'`,
    );
  }

  let removeFromOffice = [];
  const batch = db.batch();
  const [updatesDoc, timerDoc, appVersionDoc] = await Promise.all([
    rootCollections.updates.doc(conn.requester.uid).get(),
    rootCollections.timers.doc(getISO8601Date()).get(),
    rootCollections.versions.doc('version').get(),
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
      success: true,
      timestamp: Date.now(),
      code: code.ok,
    });
  }

  // update only if latestVersion >
  const updateClient = (() => {
    const { iosLatestVersion, androidLatestVersion } = appVersionDoc.data();

    if (!conn.req.query.hasOwnProperty('os')) {
      return true;
    }

    /** Version sent by the client */
    const usersAppVersion = Number(conn.req.query.appVersion);
    const latestVersionFromDb = (() => {
      if (conn.req.query.os === 'ios') {
        return iosLatestVersion;
      }

      // Default is `android`
      return androidLatestVersion;
    })();

    // Temporary until iOS app gets updated.
    if (conn.req.query.os === 'ios') {
      return false;
    }

    // Ask to update if the client's version is behind the latest version
    return Number(usersAppVersion) < Number(latestVersionFromDb);
  })();

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

  const updatesDocData = Object.assign({}, updatesDoc.data(), {
    lastNowRequestTimestamp: Date.now(),
    latestDeviceOs: conn.req.query.os || '',
    latestAppVersion: conn.req.query.appVersion || '',
    latestDeviceBrand: conn.req.query.deviceBrand || '',
    latestOsVersion: conn.req.query.osVersion || '',
    latestDeviceModel: conn.req.query.deviceModel || '',
    latestDeviceId: conn.req.query.deviceId || '',
  });

  const oldDeviceIdsArray = updatesDoc.get('deviceIdsArray') || [];
  oldDeviceIdsArray.push(conn.req.query.deviceId);
  updatesDocData.deviceIdsArray = [...new Set(oldDeviceIdsArray)].filter(
    Boolean,
  );

  /** Only logging when changed */
  if (
    conn.req.query.hasOwnProperty('deviceId') &&
    conn.req.query.deviceId &&
    conn.req.query.deviceId !== updatesDoc.get('latestDeviceId')
  ) {
    if (!updatesDocData.deviceIdsObject) {
      updatesDocData.deviceIdsObject = {};
    }

    if (!updatesDocData.deviceIdsObject[conn.req.query.deviceId]) {
      updatesDocData.deviceIdsObject[conn.req.query.deviceId] = {};
    }

    const oldCount =
      updatesDocData.deviceIdsObject[conn.req.query.deviceId].count || 0;

    updatesDocData.deviceIdsObject = {
      [conn.req.query.deviceId]: {
        count: oldCount + 1,
        timestamp: Date.now(),
      },
    };
  }

  if (
    conn.req.query.hasOwnProperty('registrationToken') &&
    typeof conn.req.query.registrationToken === 'string'
  ) {
    updatesDocData.registrationToken = conn.req.query.registrationToken;
    batch.set(
      rootCollections.profiles.doc(conn.requester.phoneNumber),
      {
        registrationToken: conn.req.query.registrationToken;
      },
      {
        merge: true,
      },
    );
  }

  if (updatesDocData.removeFromOffice) {
    removeFromOffice = updatesDocData.removeFromOffice;

    if (typeof conn.req.query.removeFromOffice === 'string') {
      const index = updatesDocData.removeFromOffice.indexOf(
        conn.req.query.removeFromOffice,
      );

      if (index > -1) {
        updatesDocData.removeFromOffice.splice(index, 1);
      }
    }

    if (Array.isArray(conn.req.query.removeFromOffice)) {
      conn.req.query.removeFromOffice.forEach(name => {
        const index = updatesDocData.removeFromOffice.indexOf(name);

        if (index > -1) {
          updatesDocData.removeFromOffice.splice(index, 1);
        }
      });
    }
  }

  if (
    updatesDoc.get('lastStatusDocUpdateTimestamp') >
    updatesDoc.get('lastNowRequestTimestamp')
  ) {
    batch.set(
      rootCollections.profiles.doc(conn.requester.phoneNumber),
      {
        lastStatusDocUpdateTimestamp: Date.now(),
      },
      {
        merge: true,
      },
    );
  }

  if (
    updatesDoc.get('lastLocationMapUpdateTimestamp') >
    updatesDoc.get('lastNowRequestTimestamp')
  ) {
    batch.set(
      rootCollections.profiles.doc(conn.requester.phoneNumber),
      {
        lastLocationMapUpdateTimestamp: Date.now(),
      },
      {
        merge: true,
      },
    );
  }

  batch.set(updatesDoc.ref, updatesDocData, {
    merge: true,
  });

  const responseObject = {
    updateClient,
    revokeSession: false,
    success: true,
    timestamp: Date.now(),
    code: code.ok,
    idProof: updatesDoc.get('idProof') || null,
    potentialAlternatePhoneNumbers: await getUsersWithProbablySameDevice(
      conn.req.query.deviceId,
      conn.requester.phoneNumber,
      conn.requester.creationTime,
    ),
    linkedAccounts: (updatesDoc.get('linkedAccounts') || []).map(account => {
      return Object.assign(account, {
        bankAccount: maskLastDigits(account.bankAccount),
      });
    }),
  };

  if (removeFromOffice && removeFromOffice.length > 0) {
    responseObject.removeFromOffice = removeFromOffice;
  }

  await batch.commit();

  return sendJSON(conn, responseObject);
};
