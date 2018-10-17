'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  sendJSON,
  handleError,
  sendResponse,
  isNonEmptyString,
  hasSupportClaims,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');


module.exports = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'GET'`
    );

    return;
  }

  if (!hasSupportClaims(conn.requester.customClaims)) {
    sendResponse(
      conn,
      code.forbidden,
      `You are not allowed to access this resource`
    );

    return;
  }

  if (!conn.req.query.hasOwnProperty('query')
    || !isNonEmptyString(conn.req.query.query)) {
    sendResponse(
      conn,
      code.badRequest,
      `Missing or invalid query parameter in the request URL.`
    );

    return;
  }

  rootCollections
    .offices
    .where('namePermutations', 'array-contains', conn.req.query.query)
    .get()
    .then((docs) => docs.docs.map((doc) => doc.get('name')))
    .then((namesArray) => sendJSON(conn, namesArray))
    .catch((error) => handleError(conn, error));
};
