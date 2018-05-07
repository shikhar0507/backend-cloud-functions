const {
  parse,
} = require('url');

const {
  rootCollections,
  users,
} = require('../admin/admin');

const {
  getUserByUid,
  verifyIdToken,
} = users;

const {
  handleError,
  sendResponse,
  now,
} = require('../admin/utils');

const {
  isValidPhoneNumber,
} = require('../firestore/activity/helperLib');

const {
  profiles,
} = rootCollections;

const activity = {
  onRead: require('../firestore/activity/onRead'),
  onCreate: require('../firestore/activity/onCreate'),
  onUpdate: require('../firestore/activity/onUpdate'),
  onComment: require('../firestore/activity/onComment'),
};

const authUsers = {
  onRead: require('../auth/user/onRead'),
  onUpdate: require('../auth/user/onUpdate'),
};


/**
 * Calls the resource related to an activity depending on the action
 * from the url.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const activitiesHandler = (conn) => {
  const method = conn.req.method;
  const action = parse(conn.req.url).path.split('/')[2];

  if (method === 'GET') {
    if (conn.req.query.from) {
      activity.onRead(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else if (method === 'POST') {
    if (action === 'create') {
      activity.onCreate(conn);
    } else if (action === 'comment') {
      activity.onComment(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else if (method === 'PATCH') {
    if (action === 'update') {
      activity.onUpdate(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else {
    sendResponse(conn, 405, 'METHOD NOT ALLOWED');
  }
};

const handleUserProfiles = (conn) => {
  const action = parse(conn.req.url).path.split('/')[3];

  if (conn.req.method === 'GET') {
    if (action.startsWith('read')) {
      authUsers.onRead(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else if (conn.req.method === 'PATCH') {
    if (action === 'update') {
      authUsers.onUpdate(conn);
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
  } else {
    sendResponse(conn, 405, 'METHOD NOT ALLOWED');
  }
};


/**
 * Calls the resource related to a service depending on the action
 * from the url.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const servicesHandler = (conn) => {
  const action = parse(conn.req.url).path.split('/')[2];

  if (action === 'users') {
    handleUserProfiles(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};


/**
 * Fetches the phone number of the requester and verifies
 * if the document for this phone number inside the /Profiles
 * has the same uid as the requester.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const verifyUidAndPhoneNumberCombination = (conn) => {
  profiles.doc(conn.requester.phoneNumber).get().then((doc) => {
    if (!doc.exists) {
      sendResponse(conn, 403, 'FORBIDDEN');
      return;
    } else if (doc.get('uid') !== conn.requester.uid) {
      // this uid & phoneNumber combination is not valid
      // TODO: updatePhoneNumber(conn);
      sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }

    const method = conn.req.method;
    const action = parse(conn.req.url).path.split('/')[1];

    if (action === 'activities') {
      activitiesHandler(conn);
    } else if (action === 'services') {
      servicesHandler(conn);
    } else if (action === 'now') {
      now(conn); // server timestamp
    } else {
      sendResponse(conn, 400, 'BAD REQUEST');
    }
    return;
  }).catch((error) => handleError(conn, error));
};

/**
 * Fetches the requestor's phone number from auth.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const getCreatorsPhoneNumber = (conn) => {
  // getUserByUid(conn.requester.uid).then((userRecord) => {
  // if (userRecord.disabled) {
  //   sendResponse(conn, 403, 'FORBIDDEN');
  //   return;
  // }

  conn.requester.phoneNumber = '+918178135274';
  // conn.requester.phoneNumber = userRecord.phoneNumber;

  verifyUidAndPhoneNumberCombination(conn);
  return;
  // }).catch((error) => {
  //   console.log(error);
  //   sendResponse(conn, 403, 'FORBIDDEN');
  // });
};

/**
 * Verifies the id-token form the Authorization header in the request.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const checkAuthorizationToken = (conn) => {
  // if (conn.req.headers['Content-Type'] !== 'application/json') {
  //   sendResponse(conn, 415, 'UNSUPPORTED MEDIA TYPE');
  //   return;
  // }

  if (conn.req.headers.authorization) {
    const idToken = conn.req.headers.authorization.split('Bearer ')[1];

    // verifyIdToken(idToken).then((decodedIdToken) => {
    conn.requester = {};
    conn.requester.uid = '4uwC9a7VZBYMnm6V1vCVCrZnUbx2';
    // conn.requester.uid = decodedIdToken.uid;

    getCreatorsPhoneNumber(conn);
    return;
    // }).catch((error) => {
    //   console.log(error);
    //   sendResponse(conn, 403, 'FORBIDDEN');
    // });
  } else {
    conn.headers['WWW-Authenticate'] = 'Bearer ';
    sendResponse(conn, 401, 'UNAUTHORIZED');
  }
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
    'Content-Type': 'application/json',
    'Access-Control-Max-Age': 2592000, // 30 days
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
