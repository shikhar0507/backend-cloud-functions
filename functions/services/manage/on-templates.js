const {
  code,
} = require('../../admin/responses');

const {
  sendResponse,
} = require('../../admin/utils');


const onRead = require('../../firestore/activity-templates/on-read');
const onCreate = require('../../firestore/activity-templates/on-create');
const onUpdate = require('../../firestore/activity-templates/on-update');


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
