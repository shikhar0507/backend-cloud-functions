const {
  parse,
} = require('url');

const {
  sendResponse,
} = require('../admin/utils');

const {
  code,
} = require('../admin/responses');

const onRead = require('../firestore/activity-templates/on-read');
const onCreate = require('../firestore/activity-templates/on-create');
const onUpdate = require('../firestore/activity-templates/on-update');


const app = (conn) => {
  if (!conn.requester.customClaims.manageTemplates) {
    sendResponse(
      conn,
      code.forbidden,
      'You do not have permission to access /manageTemplates'
    );
    return;
  }

  const action = parse(conn.req.url).path.split('/')[3];

  if (action === 'create') {
    if (conn.req.method !== 'POST') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${conn.req.method} is not allowed for /create. Use POST.`
      );
      return;
    }

    onCreate(conn);
    return;
  }

  if (action === 'update') {
    if (conn.req.method !== 'PUT') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${conn.req.method} is not allowed for /update. Use PUT.`
      );
      return;
    }

    onUpdate(conn);
    return;
  }

  /** `action` can have query string, so /read the equality
   * operator will fail. Thatswhy startsWith method is used.
   */
  if (action.startsWith('read')) {
    if (conn.req.method !== 'GET') {
      sendResponse(
        conn,
        code.methodNotAllowed,
        `${conn.req.method} is not allowed for /read. Use GET.`
      );
      return;
    }

    onRead(conn);
    return;
  }

  sendResponse(
    conn,
    code.notImplemented,
    'This request path is invalid for /templates.'
  );
};

module.exports = app;
