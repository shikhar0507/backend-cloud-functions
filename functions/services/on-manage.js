
const {
  sendResponse,
} = require('../admin/utils');

const {
  code,
} = require('../admin/responses');

const onPermissions = require('./manage/permissions');
const onTemplates = require('./manage/templates');

const {
  parse,
} = require('url');

const app = (conn) => {
  const method = conn.req.method;
  const action = parse(conn.req.url).path.split('/')[3];

  if (action === 'permissions') {
    if (method !== 'PUT') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${method} is not allowed for /${action} endpoint.`
      );
      return;
    }

    onPermissions(conn);
    return;
  }

  if (action === 'templates') {
    if (method !== 'POST') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${method} is not allowed for /${action} endpoint.`
      );
      return;
    }

    onTemplates(conn);
    return;
  }

  sendResponse(conn, code.badRequest, 'The request path is not valid.');
};

module.exports = app;
