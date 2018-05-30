const {
  users,
} = require('../../admin/admin');

const {
  sendResponse,
  handleError,
} = require('../../admin/utils');

const {
  isValidPhoneNumber,
} = require('../../firestore/activity/helper');

const {
  code,
} = require('../../admin/responses');

const {
  setCustomUserClaims,
  getUserByPhoneNumber,
  getUserByUid,
} = users;


const setClaims = (conn, userRecord) => {
  setCustomUserClaims(userRecord.uid, {
    support: conn.req.body.permissions.support || false,
    templatesManager: conn.req.body.permissions.manageTemplates || false,
  }).then(() => {
    sendResponse(
      conn,
      code.ok,
      `Updated permissions for ${conn.req.body.phoneNumber} successfully.`
    );
    return;
  }).catch((error) => handleError(conn, error));
};


const getUserRecordFromPhoneNumber = (conn) => {
  getUserByPhoneNumber(conn.req.body.phoneNumber).then((userRecord) => {
    if (!userRecord[conn.req.body.phoneNumber].uid) {
      sendResponse(
        conn,
        code.badRequest,
        `No user with phone number ${conn.req.body.phoneNumber} exists.`);
      return;
    }

    setClaims(conn, {
      uid: userRecord[conn.req.body.phoneNumber].uid,
    });
    return;
  }).catch((error) => handleError(conn, error));
};


const validateRequestBody = (conn) => {
  if (!isValidPhoneNumber(conn.req.body.phoneNumber)) {
    sendResponse(
      conn,
      code.badRequest,
      `${conn.req.body.phoneNumber} is not a valid phone number.`
    );
    return;
  }

  if (conn.requester.phoneNumber === conn.req.body.phoneNumber) {
    sendResponse(
      conn,
      code.forbidden,
      'You cannot change your own permissions.'
    );
    return;
  }

  if (!conn.req.body.permissions) {
    sendResponse(
      conn,
      code.badRequest,
      'The "permisssions" object is missing from the request body.'
    );
    return;
  }

  /** The only object we need here is {...}. Anything else like an `Array`
   * is should is not allowed.
   */
  if (Object.prototype.toString
    .call(conn.req.body.permissions) !== '[object Object]') {
    sendResponse(
      conn,
      code.badRequest,
      'The "permissions" object in request body is invalid.'
    );
    return;
  }

  getUserRecordFromPhoneNumber(conn);
};


const app = (conn) => {
  getUserByUid(conn.requester.uid).then((userRecord) => {
    if (!userRecord.customClaims) {
      sendResponse(conn, code.forbidden, 'You cannot perform this operation');
      return;
    }


    /** The superUser field can be `undefined', true` or `false`. So, we are
     * explictly checking its value against a boolean. Only a `truthy`/`falsey`
     * check will fail here.
    */
    if (userRecord.customClaims.superUser !== true) {
      sendResponse(conn, code.forbidden, 'You cannot perform this operation');
      return;
    }

    validateRequestBody(conn);
    return;
  }).catch((error) => handleError(conn, error));
};

module.exports = app;
