'use strict';


const {
  sendResponse,
  isNonEmptyString,
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

  if (!conn.req.query.hasOwnProperty('deviceId')
    || !isNonEmptyString(conn.req.query.deviceId)) {
    sendResponse(
      conn,
      code.forbidden,
      `The request URL does not have a valid 'deviceId' param`
    );

    return;
  }

  const ddmmyyyyString = getISO8601Date();

  Promise
    .all([
      rootCollections
        .updates
        .doc(conn.requester.uid)
        .get(),
      rootCollections
        .timers
        .doc(ddmmyyyyString)
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

        return latestVersion !== appVersion;
      })();

      const batch = db.batch();
      // const timestamp = serverTimestamp;
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
      newDeviceIdsArray.push(conn.req.query.deviceId);

      const updatesDocData = updatesDoc.data();
      updatesDocData.lastNowRequestTimestamp = Date.now();

      // Saving the regestration token in the /Updates/{uid} doc 
      // of the user to 
      if (conn.req.query.hasOwnProperty('regestrationToken')) {
        updatesDocData.regestrationToken = conn.req.query.regestrationToken;
      }

      /** Only logging when changed. */
      if (conn.req.query.deviceId !== updatesDoc.get('latestDeviceId')) {
        updatesDocData.deviceIdsArray = [...new Set(newDeviceIdsArray)];
        updatesDocData.latestDeviceId = conn.req.query.deviceId;
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
