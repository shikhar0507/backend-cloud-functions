'use strict';

const {
  sendJSON,
  sendResponse,
} = require('../admin/utils');
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

  return sendJSON(conn, {});
};
