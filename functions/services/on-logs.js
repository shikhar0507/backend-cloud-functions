'use strict';

const {
  rootCollections,
  db,
} = require('../admin/admin');

const {
  sendResponse,
  handleError,
  isNonEmptyString,
} = require('../admin/utils');

const {
  code,
} = require('../admin/responses');

const {
  reportingActions,
} = require('../admin/constants');


module.exports = (conn) => {
  if (conn.req.method !== 'POST') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for ${conn.req.url}. Use 'POST'.`
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('message')) {
    sendResponse(
      conn,
      code.badRequest,
      'The request body is missing the message object.'
    );

    return;
  }

  if (!isNonEmptyString(conn.req.body.message)) {
    sendResponse(
      conn,
      code.badRequest,
      'The message object in the request body should be of type string.'
    );

    return;
  }

  rootCollections
    .updates
    .doc(conn.requester.uid)
    .get()
    .then((doc) => {
      const batch = db.batch();

      const body = conn.req.body;
      body.requester = conn.requester;
      body.url = conn.req.url;
      body.updatesDoc = doc.data();

      const docRef = rootCollections.instant.doc();

      console.log(docRef.path);

      batch.set(docRef, {
        messageBody: JSON.stringify(conn.req.body, ' ', 2),
        subject: 'A new error showed up in the Growthfile Frontend.',
        action: reportingActions.clientError,
      });

      return batch.commit();
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};
