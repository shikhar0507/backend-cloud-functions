'use strict';


const {
  sendResponse,
  getISO8601Date,
  handleError,
  sendJSON,
} = require('../admin/utils');
const {
  db,
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');

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
      const [
        updatesDoc,
        timerDoc,
        appVersionDoc,
      ] = result;

      /**
       * The `authOnCreate` function executed, when the user signed up, but
       * the `/api` was executed before `authOnCreate` completed. This will result
       * in this function to crash since it assumes that the doc in the `Updates/{uid}`
       * doc exists.
       */
      if (!updatesDoc.exists) {
        sendJSON(conn, {
          revokeSession: false,
          updateClient: false,
          success: true,
          timestamp: Date.now(),
          code: code.ok,
        });

        return null;
      }

      const updateClient = (() => {
        const {
          iosLatestVersion,
          androidLatestVersion,
        } = appVersionDoc.data();

        if (!conn.req.query.hasOwnProperty('os')) {
          return true;
        }

        const os = conn.req.query.os;
        const appVersion = conn.req.query.appVersion;
        const latestVersion = (() => {
          if (os === 'ios') return iosLatestVersion;

          // Default is `android`
          return androidLatestVersion;
        })();

        console.log({
          appVersion,
          latestVersion,
          query: conn.req.query,
          requester: conn.requester,
        });

        if (os === 'ios') return false;

        return latestVersion !== appVersion;
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

      const newDeviceIdsArray = updatesDoc.get('newDeviceIdsArray') || [];

      if (conn.req.query.deviceId) {
        newDeviceIdsArray.push(conn.req.query.deviceId);
      }

      const updatesDocData = updatesDoc.data();
      updatesDocData.lastNowRequestTimestamp = Date.now();

      if (conn.req.query.hasOwnProperty('registrationToken')) {
        updatesDocData.registrationToken = conn.req.query.registrationToken;
      }

      /** Only logging when changed */
      if (conn.req.query.deviceId
        && conn.req.query.deviceId !== updatesDoc.get('latestDeviceId')) {
        updatesDocData.deviceIdsArray = [...new Set(newDeviceIdsArray)];
        updatesDocData.latestDeviceId = conn.req.query.deviceId;
      }

      updatesDocData.latestDeviceOs = conn.req.query.os || '';
      updatesDocData.latestAppVersion = conn.req.query.appVersion || '';

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

      console.log({ params: conn.req.query });

      return sendJSON(conn, {
        revokeSession,
        updateClient,
        success: true,
        timestamp: Date.now(),
        code: code.ok,
      });
    })
    .catch((error) => handleError(conn, error));
};
