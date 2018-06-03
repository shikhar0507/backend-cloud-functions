const {
  sendResponse,
} = require('../admin/utils');

const {
  code,
} = require('../admin/responses');

const {
  parse,
} = require('url');

const onPermissions = require('./manage/on-permissions');
const onTemplates = require('./manage/on-templates');


const app = (conn) => {
  if (!conn.requester.customClaims) {
    sendResponse(
      code,
      code.forbidden,
      'You are unauthorized to perform this operation.'
    );
    return;
  }

  const action = parse(conn.req.url).path.split('/')[3];

  if (action === 'permissions') {
    if (conn.req.method !== 'PUT') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${conn.req.method} is not allowed for /${action}`
        + ' endpoint. Use PUT.'
      );
      return;
    }

    onPermissions(conn);
    return;
  }

  if (action.startsWith('templates')) {
    /** GET, POST, PUT are allowed */
    if (conn.req.method === 'PATCH') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        /** not templating the `action` here because for all the
         * requests which have a query string in the url, the endpoint
         * name in the response will show up with the query string.
         */
        `${conn.req.method} is not allowed for /templates endpoint.`
        + ' Use GET (reading), POST (creating),'
        + ' or PUT (updating)  for /templates.'
      );
      return;
    }

    onTemplates(conn);
    return;
  }

  sendResponse(
    conn,
    code.notImplemented,
    'This request path is invalid for /manage.'
  );
};


module.exports = app;
