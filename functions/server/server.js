const url = require('url');
const admin = require('../admin/admin');
const utils = require('../admin/utils');
const helpers = require('../firestore/activity/helperLib');

const onRead = require('../firestore/activity/onRead');
const onCreate = require('../firestore/activity/onCreate');
const onUpdate = require('../firestore/activity/onUpdate');
const onComment = require('../firestore/activity/onComment');

const onRequest = require('../firestore/services/onRequest');

const fetchUserRecord = onRequest.fetchUserRecord;

const sendResponse = require('../admin/utils').sendResponse;
const now = utils.now;

const isValidPhoneNumber = helpers.isValidPhoneNumber;

const profiles = admin.rootCollections.profiles;
const getUserByUid = admin.users.getUserByUid;

// https://firebase.google.com/docs/reference/node/firebase.auth.Error

const activitiesHandler = (conn) => {
  const method = conn.req.method;
  const action = url.parse(conn.req.url).path.split('/')[2];

  if (method === 'GET') {
    if (conn.req.query.from) {
      onRead(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else if (method === 'POST') {
    if (action === 'create') {
      onCreate(conn);
    } else if (action === 'comment') {
      onComment(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else if (method === 'PATCH') {
    if (action === 'update') {
      onUpdate(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else {
    sendResponse(conn, 405, 'METHOD NOT ALLOWED');
  }
};

const servicesHandler = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(conn, 405, 'METHOD NOT ALLOWED');
    return;
  }

  const action = url.parse(conn.req.url).path.split('/')[2];

  if (action.startsWith('contact') &&
    isValidPhoneNumber(conn.req.query.phoneNumber)) {
    fetchUserRecord(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

const getCreatorsPhoneNumber = (conn) => {
  // https://firebase.google.com/docs/reference/admin/node/admin.auth.DecodedIdToken
  // getUserByUid(conn.creator.uid).then((userRecord) => {
  conn.creator.phoneNumber = '+918178135274';
  // conn.creator.phoneNumber = userRecord.phoneNumber;

  const method = conn.req.method;
  const action = url.parse(conn.req.url).path.split('/')[1];

  if (action === 'activities') {
    activitiesHandler(conn);
  } else if (action === 'services') {
    servicesHandler(conn);
  } else if (action === 'now') {
    now(conn); // server timestamp
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
  // }).catch((error) => {
  //   console.log(error);
  //   sendResponse(conn, 403, 'FORBIDDEN');
  // });
};

const checkAuthorizationToken = (conn) => {
  if (conn.req.headers.authorization) {
    let idToken = conn.req.headers.authorization.split('Bearer ')[1];

    // admin.users.verifyIdToken(idToken).then((decodedIdToken) => {
    conn.creator = {};
    conn.creator.uid = 'jy2aZkvpflRXGwxLKip7opC1HqM2';
    // conn.creator.uid = decodedIdToken.uid;

    getCreatorsPhoneNumber(conn);
    return;
    // }).catch((error) => {
    //   console.log(error);
    //   sendResponse(conn, 403, 'FORBIDDEN');
    // });
  } else {
    sendResponse(conn, 403, 'FORBIDDEN');
  }
  return;
};

const server = (req, res) => {
  const conn = {
    req,
    res,
  };

  // preflight headers
  const control = 'X-Requested-With, Authorization, Content-Type, Accept';
  conn.headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET, PATCH',
    'Access-Control-Allow-Headers': control,
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
