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

      const updateClient = (() => {
        const {
          iosLatestVersion,
          androidLatestVersion,
        } = appVersionDoc.data();

        if (!conn.req.query.hasOwnProperty('os')) return true;

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

      const deviceIdsObject = (() => {
        const object = updatesDoc.get('deviceIdsObject') || {};

        /** Only adding when changed */
        if (object[conn.req.query.deviceId]
          && updatesDoc.get('latestDeviceId') !== conn.req.query.deviceId) {
          object[conn.req.query.deviceId] = {
            timestamp: Date.now(),
            count: object[conn.req.query.deviceId].count + 1,
          };
        } else {
          object[conn.req.query.deviceId] = {
            timestamp: Date.now(),
            count: 1,
          };
        }

        return object;
      })();

      /** Only logging when changed. */
      if (conn.req.query.deviceId !== updatesDoc.get('latestDeviceId')) {
        batch.set(updatesDoc.ref, {
          deviceIdsObject,
          latestDeviceId: conn.req.query.deviceId,
        }, {
            merge: true,
          });
      }

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
    .then((result) => sendJSON(conn, {
      revokeSession: result[0],
      updateClient: result[1],
      success: true,
      timestamp: Date.now(),
      code: code.ok,
    }))
    .catch((error) => handleError(conn, error));
};
