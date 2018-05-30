
const {
  sendResponse,
} = require('../admin/utils');

const {
  code,
} = require('../admin/responses');

const onPermissions = require('./manage/on-permissions');
const onTemplates = require('./manage/on-templates');

const {
  parse,
} = require('url');


const app = (conn) => {
  if (!conn.requester.customClaims) {
    sendResponse(
      code,
      code.forbidden,
      'You are unauthorized to perform this operation.'
    );
    return;
  }

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

  if (action.startsWith('templates')) {
    /** GET, POST, PUT are allowed */
    if (method === 'PATCH') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        /** not templating the `action` here because for all the
         * requests which have a query string in the url, the endpoint
         * name in the response will show up with the query string.
         */
        `${method} is not allowed for /templates endpoint.`
      );
      return;
    }

    onTemplates(conn);
    return;
  }

  sendResponse(conn, code.badRequest, 'The request path is not valid.');
};


module.exports = app;
