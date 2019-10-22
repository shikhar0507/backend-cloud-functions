'use strict';

const {
  rootCollections,
} = require('../admin/admin');
const {
  sendResponse,
  handleError,
} = require('../admin/utils');
const {
  removeBeneficiary,
} = require('../cash-free/payout');
const {
  code,
} = require('../admin/responses');
const admin = require('firebase-admin');

const validator = body => {
  return null;
};


module.exports = async conn => {
  if (conn.req.method !== 'DELETE') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use "DELETE"`
    );
  }

  const v = validator();

  if (v) {
    return sendResponse(
      conn,
      code.badRequest,
      v
    );
  }

  try {
    const response = await removeBeneficiary(
      conn.requester.uid
    );

    if (response.subCode === '404') {
      return sendResponse(
        conn,
        code.conflict,
        `No bank account is linked to your account`
      );
    }

    await rootCollections
      .updates
      .doc(conn.requester.uid)
      .set({
        linkedAccounts: admin.firestore.FieldValue.delete(),
      }, {
        method: true,
      });

    return sendResponse(
      conn,
      code.ok,
      `Bank account deleted successfully`,
    );
  } catch (error) {
    return handleError(conn, error);
  }
};
