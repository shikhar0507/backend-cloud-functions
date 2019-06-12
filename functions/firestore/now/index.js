'use strict';


const {
  sendResponse,
  getISO8601Date,
  handleError,
  sendJSON,
} = require('../../admin/utils');
const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  code,
} = require('../../admin/responses');


/**
 * Returns the server timestamp on a `GET` request.
 *
 * @param {Object} conn Object containing Express's Request and Response objects.
 * @returns {void}
 */
module.exports = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for the /now endpoint.`
    );

    return;
  }

  if (conn.req.query.hasOwnProperty('registrationToken')
    && typeof conn.req.query.registrationToken !== 'string'
    && conn.req.query.registrationToken !== null) {
    sendResponse(
      conn,
      code.badRequest,
      `The query param 'registrationToken' can either be a non-empty`
      + ` string or 'null'`
    );

    return;
  }

  let removeFromOffice = [];

  Promise
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
    ])
    .then((result) => {
      const [updatesDoc, timerDoc, appVersionDoc] = result;

      /**
       * The `authOnCreate` function executed, when the user signed up, but
       * the `/api` was executed before `authOnCreate` completed. This will result
       * in this function to crash since it assumes that the doc in the `Updates/{uid}`
       * doc exists.
       */
      if (!updatesDoc.exists) {
        return Promise.resolve([false, false]);
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

        const os = conn.req.query.os;
        /** Version sent by the client */
        const usersAppVersion = Number(conn.req.query.appVersion);
        const latestVersionFromDb = (() => {
          if (os === 'ios') return iosLatestVersion;

          // Default is `android`
          return androidLatestVersion;
        })();

        // Temporary until iOS app gets updated.
        if (os === 'ios') return false;

        // Ask to update if the client's version is behind the latest version
        return Number(usersAppVersion) < Number(latestVersionFromDb);
      })();

      const batch = db.batch();
      const revokeSession = false;

      if (!timerDoc.exists) {
        batch.set(timerDoc.ref, {
          timestamp: Date.now(),
          // Prevents multiple trigger events for reports.
          sent: false,
        }, {
            merge: true,
          });
      }

      const updatesDocData = updatesDoc.data();
      updatesDocData.lastNowRequestTimestamp = Date.now();
      const oldDeviceIdsArray = updatesDoc.get('deviceIdsArray') || [];

      if (conn.req.query.deviceId) {
        oldDeviceIdsArray.push(conn.req.query.deviceId);

        updatesDocData.latestDeviceId = conn.req.query.deviceId;
      }

      updatesDocData.deviceIdsArray = [...new Set(oldDeviceIdsArray)];

      /** Only logging when changed */
      if (conn.req.query.hasOwnProperty('deviceId')
        && conn.req.query.deviceId
        && conn.req.query.deviceId !== updatesDoc.get('latestDeviceId')) {

        if (!updatesDocData.deviceIdsObject) {
          updatesDocData.deviceIdsObject = {};
        }

        if (!updatesDocData.deviceIdsObject[conn.req.query.deviceId]) {
          updatesDocData.deviceIdsObject[conn.req.query.deviceId] = {};
        }

        const oldCount =
          updatesDocData
            .deviceIdsObject[conn.req.query.deviceId]
            .count || 0;

        updatesDocData.deviceIdsObject = {
          [conn.req.query.deviceId]: {
            count: oldCount + 1,
            timestamp: Date.now(),
          },
        };
      }

      if (conn.req.query.hasOwnProperty('registrationToken')
        && typeof conn.req.query.registrationToken === 'string') {
        updatesDocData.registrationToken = conn.req.query.registrationToken;
      }

      updatesDocData.latestDeviceOs = conn.req.query.os || '';
      updatesDocData.latestAppVersion = conn.req.query.appVersion || '';

      if (updatesDocData.removeFromOffice) {
        removeFromOffice = updatesDocData.removeFromOffice;

        if (typeof conn.req.query.removeFromOffice === 'string') {
          const index =
            updatesDocData
              .removeFromOffice
              .indexOf(conn.req.query.removeFromOffice);

          if (index > -1) {
            updatesDocData.removeFromOffice.splice(index, 1);
          }
        }

        if (Array.isArray(conn.req.query.removeFromOffice)) {
          conn.req.query.removeFromOffice.forEach((name) => {
            const index = updatesDocData.removeFromOffice.indexOf(name);

            if (index > -1) {
              updatesDocData.removeFromOffice.splice(index, 1);
            }
          });
        }
      }

      if (conn.req.query.hasOwnProperty('deviceBrand')) {
        updatesDocData.latestDeviceBrand = conn.req.query.deviceBrand;
      }

      if (conn.req.query.hasOwnProperty('deviceModel')) {
        updatesDocData.latestDeviceModel = conn.req.query.deviceModel;
      }

      // Delete venues on acknowledgement
      if (updatesDocData.venues
        && conn.req.query.mapsSet === 'true') {
        const admin = require('firebase-admin');

        updatesDocData.venues = admin.firestore.FieldValue.delete();
      }

      batch.set(updatesDoc.ref, updatesDocData, {
        merge: true,
      });

      return Promise
        .all([
          Promise
            .resolve(revokeSession),
          Promise
            .resolve(updateClient),
          batch
            .commit(),
        ]);
    })
    .then((result) => {
      if (!result) {
        return Promise.resolve();
      }

      const [
        revokeSession,
        updateClient,
      ] = result;

      const responseObject = {
        revokeSession,
        updateClient,
        success: true,
        timestamp: Date.now(),
        code: code.ok,
      };

      if (removeFromOffice && removeFromOffice.length > 0) {
        responseObject.removeFromOffice = removeFromOffice;
      }

      return sendJSON(conn, responseObject);
    })
    .catch((error) => handleError(conn, error));
};
