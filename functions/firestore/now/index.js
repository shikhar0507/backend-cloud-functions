'use strict';


const {
  sendResponse,
  getISO8601Date,
  sendJSON,
} = require('../../admin/utils');
const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  code,
} = require('../../admin/responses');

const mask = str => {
  return new Array(str.length - 4 + 1).join('x') +
    str.slice(-4);
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
      `${conn.req.method} is not allowed for the /now endpoint.`
    );
  }

  if (conn.req.query.hasOwnProperty('registrationToken') &&
    typeof conn.req.query.registrationToken !== 'string' &&
    conn.req.query.registrationToken !== null) {
    return sendResponse(
      conn,
      code.badRequest,
      `The query param 'registrationToken' can either be a non-empty` +
      ` string or 'null'`
    );
  }

  let removeFromOffice = [];
  const batch = db.batch();

  const [
    updatesDoc,
    timerDoc,
    appVersionDoc,
  ] = await Promise
    .all([
      rootCollections
      .updates
      .doc(conn.requester.uid)
      .get(),
      rootCollections
      .timers
      .doc(getISO8601Date())
      .get(),
      rootCollections
      .versions
      .doc('version')
      .get(),
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
    const {
      iosLatestVersion,
      androidLatestVersion,
    } = appVersionDoc.data();

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
      timerDoc.ref, {
        timestamp: Date.now(),
        // Prevents multiple trigger events for reports.
        sent: false,
      }, {
        merge: true,
      });
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
  updatesDocData.deviceIdsArray = [...new Set(oldDeviceIdsArray)].filter(Boolean);

  /** Only logging when changed */
  if (conn.req.query.hasOwnProperty('deviceId') &&
    conn.req.query.deviceId &&
    conn.req.query.deviceId !== updatesDoc.get('latestDeviceId')) {

    if (!updatesDocData.deviceIdsObject) {
      updatesDocData.deviceIdsObject = {};
    }

    if (!updatesDocData.deviceIdsObject[conn.req.query.deviceId]) {
      updatesDocData
        .deviceIdsObject[conn.req.query.deviceId] = {};
    }

    const oldCount = updatesDocData
      .deviceIdsObject[conn.req.query.deviceId]
      .count || 0;

    updatesDocData.deviceIdsObject = {
      [conn.req.query.deviceId]: {
        count: oldCount + 1,
        timestamp: Date.now(),
      },
    };
  }

  if (conn.req.query.hasOwnProperty('registrationToken') &&
    typeof conn.req.query.registrationToken === 'string') {
    updatesDocData
      .registrationToken = conn.req.query.registrationToken;
  }

  if (updatesDocData.removeFromOffice) {
    removeFromOffice = updatesDocData.removeFromOffice;

    if (typeof conn.req.query.removeFromOffice === 'string') {
      const index = updatesDocData
        .removeFromOffice
        .indexOf(conn.req.query.removeFromOffice);

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

  if (updatesDoc.get('lastStatusDocUpdateTimestamp') >
    updatesDoc.get('lastNowRequestTimestamp')) {
    batch.set(
      rootCollections
      .profiles
      .doc(conn.requester.phoneNumber), {
        // lastStatuseUpdateTimestamp: Date.now(),
        lastStatusDocUpdateTimestamp: Date.now(),
      }, {
        merge: true,
      });
  }

  if (updatesDoc.get('lastLocationMapUpdateTimestamp') >
    updatesDoc.get('lastNowRequestTimestamp')) {
    batch.set(
      rootCollections
      .profiles
      .doc(conn.requester.phoneNumber), {
        lastLocationMapUpdateTimestamp: Date.now(),
      }, {
        merge: true,
      });
  }

  batch.set(
    updatesDoc.ref,
    updatesDocData, {
      merge: true,
    });

  await batch.commit();

  const responseObject = {
    revokeSession: false,
    updateClient,
    success: true,
    timestamp: Date.now(),
    code: code.ok,
  };

  responseObject.linkedAccounts = (updatesDoc.get('linkedAccounts') || []).map(account => {
    return Object.assign(account, {
      bankAccount: mask(account.bankAccount),
    });
  });

  if (removeFromOffice && removeFromOffice.length > 0) {
    responseObject.removeFromOffice = removeFromOffice;
  }

  return sendJSON(conn, responseObject);
};
