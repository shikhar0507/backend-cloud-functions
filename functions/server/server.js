const url = require('url');

const onRead = require('../firestore/activity/onRead');
const onCreate = require('../firestore/activity/onCreate');
const onUpdate = require('../firestore/activity/onUpdate');
const onComment = require('../firestore/activity/onComment');
const utils = require('../admin/utils');

const sendResponse = require('../admin/utils').sendResponse;
const now = utils.now;

const handleActivityRequest = (conn) => {
  const method = conn.req.method;
  const action = url.parse(conn.req.url).path.split('/')[2];

  if (method === 'GET') {
    // In the “happy” (or non-error) path, GET returns a representation
    // in XML or JSON and an HTTP response code of 200 (OK). In an
    // error case, it most often returns a 404 (NOT FOUND) or
    // 400(BADREQUEST).
    if (conn.req.query.readFrom) {
      onRead(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else if (method === 'POST') {
    // On successful creation, return HTTP status 201, returning a
    // Location header with a link to the newly-created resource
    // with the 201 HTTP status.
    if (action === 'create') {
      onCreate(conn);
    } else if (action === 'comment') {
      onComment(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else if (method === 'PATCH') {
    if (action === 'update') {
      // Response: On successful update it returns 200
      // (or 204 if not returning any content in the body) from a PUT.
      onUpdate(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else {
    sendResponse(conn, 405, 'METHOD NOT ALLOWED');
  }
};

const handleAdminRequest = (conn) => {
  const action = url.parse(conn.req.url).path.split('/');
  sendResponse(conn, 200, 'OK');
};

const checkAuthorizationToken = (conn) => {
  if (conn.req.headers.authorization) {
    let idToken = conn.req.headers.authorization.split('Bearer ')[1];
    admin.manageUsers.verifyUserByIdToken(idToken).then((decoded) => {
      conn.uid = decoded.uid;
      const method = conn.req.method;
      const action = url.parse(conn.req.url).path.split('/')[1];

      if (action === 'activity') {
        handleActivityRequest(conn);
      } else if (action === 'admin') {
        handleAdminRequest(conn);
      } else if (action === 'now') {
        now(conn); // server timestamp
      } else {
        sendResponse(conn, 400, 'BAD REQUEST');
      }
      return null;
    }).catch((error) => {
      console.log(error);
      sendResponse(conn, 403, 'FORBIDDEN');
    });
  } else {
    sendResponse(conn, 403, 'FORBIDDEN');
  }
  return null;
};

const server = (req, res) => {
  const conn = {
    req,
    res,
  };

  // preflight headers
  const accept = 'X-Requested-With, Authorization, Content-Type, Accept';
  conn.headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET, PATCH',
    'Access-Control-Allow-Headers': accept,
  };

  if (req.method === 'OPTIONS') {
    sendResponse(conn, 200, 'OK');
  } else if (req.method === 'GET' || req.method === 'POST' ||
    req.method === 'PATCH') {
    checkAuthorizationToken(conn);
  } else {
    sendResponse(conn, 405, 'METHOD NOT ALLOWED');
  }
};

module.exports = server;
