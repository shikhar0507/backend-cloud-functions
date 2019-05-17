'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const {
  sendJSON,
  handleError,
  sendResponse,
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

  if (!conn.requester.isSupportRequest
    && !conn.req.query.office) {
    sendResponse(
      conn,
      code.badRequest,
      `Query param 'office' invalid/missing`
    );

    return;
  }

  rootCollections
    .offices
    .where('namePermutations', 'array-contains', conn.req.query.office || conn.req.query.query)
    .get()
    .then((docs) => docs.docs.map((doc) => doc.get('attachment.Name.value')))
    .then((namesArray) => sendJSON(conn, namesArray))
    .catch((error) => handleError(conn, error));
};
