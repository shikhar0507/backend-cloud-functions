const {
  code,
} = require('../../admin/responses');

const {
  sendResponse,
} = require('../../admin/utils');


const onRead = require('../../firestore/activityTemplates/on-read');
const onCreate = require('../../firestore/activityTemplates/on-create');
const onUpdate = require('../../firestore/activityTemplates/on-update');


const app = (conn) => {
  if (!conn.requester.customClaims.manageTemplates) {
    sendResponse(
      conn,
      code.forbidden,
      'You are not authorized to handle templates.'
    );
    return;
  }

  if (conn.req.method === 'GET') {
    onRead(conn);
    return;
  }

  if (conn.req.method === 'POST') {
    onCreate(conn);
    return;
  }

  if (conn.req.method === 'PUT') {
    onUpdate(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request is invalid.'
  );
};

module.exports = app;
