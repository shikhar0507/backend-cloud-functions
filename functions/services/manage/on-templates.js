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
  if (conn.requester.customClaims.manageTemplates !== true) {
    sendResponse(
      conn,
      code.forbidden,
      'You are not authorized to handle templates.'
    );
    return;
  }

  const method = conn.req.method;

  if (method === 'GET') {
    onRead(conn);
    return;
  }

  if (method === 'POST') {
    onCreate(conn);
    return;
  }

  if (method === 'PATCH') {
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
