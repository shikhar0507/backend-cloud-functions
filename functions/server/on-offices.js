'use strict';

const {
  sendResponse,
  isValidDate,
} = require('../admin/utils');

const { code, } = require('../admin/responses');


const handleAction = (conn, action) => {
  if (action.startsWith('read')) {
    if (!conn.req.query.hasOwnProperty('from')) {
      sendResponse(
        conn,
        code.badRequest,
        `The request URL is missing the 'from' query parameter.`
      );

      return;
    }

    if (!isValidDate(conn.req.query.from)) {
      sendResponse(
        conn,
        code.badRequest,
        `The value in the 'from' query parameter is not a valid unix timestamp.`
      );

      return;
    }

    const onRead = require('../firestore/offices/on-read');
    onRead(conn);

    return;
  }
};


module.exports = (conn) => {
  const action = require('url').parse(conn.req.url).path.split('/')[2];

  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'GET' for /read`
    );

    return;
  }

  if (action.startsWith('read')) {
    handleAction(conn, action);
  }
};
