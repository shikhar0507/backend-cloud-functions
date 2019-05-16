'use strict';

const {
  sendJSON,
  sendResponse,
  hasSupportClaims,
  hasAdminClaims,
  handleError,
} = require('../admin/utils');
const {
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');

module.exports = (conn) => {
  if (conn.req.method !== 'GET') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} not allowed. Use GET`
    );
  }

  if (!hasAdminClaims(conn.requester.customClaims)
    && !hasSupportClaims(conn.requester.customClaims)) {
    return sendResponse(
      conn,
      code.unauthorized,
      'You are not allowed to access this resource'
    );
  }

  /**
   * params -> office, template, query
   */

  if (conn.req.query.hasOwnProperty('query')) {
    return sendResponse(
      conn,
      code.badRequest,
      `Missing 'query' param in the url`
    );
  }

  if (!conn.req.query.hasOwnProperty('office')) {
    return sendResponse(
      conn,
      code.badRequest,
      `Missing 'office' param in the url`
    );
  }

  return rootCollections
    .offices
    .where('office', '==', conn.req.query.office)
    .limit(1)
    .get()
    .then((docs) => {
      return docs
        .docs[0]
        .ref
        .collection('Activities')
        .where('searchables', 'array-contains', conn.req.query.query)
        .get();
    })
    .then((docs) => {
      const json = {
        results: docs.docs.map((doc) => {
          return {
            attachment: doc.get('attachment'),

          };
        }),
      };

      return sendJSON(conn, json);
    })
    .catch((error) => handleError(conn, error));
};
