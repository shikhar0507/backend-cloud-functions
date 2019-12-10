'use strict';

const {
  rootCollections,
} = require('../admin/admin');
const {
  sendResponse,
  handleError,
  isNonEmptyString,
} = require('../admin/utils');
const {
  addBeneficiary,
} = require('../cash-free/payout');
const {
  code,
} = require('../admin/responses');
const admin = require('firebase-admin');

const validator = body => {
  // bankAccount: conn.req.body.bankAccount,
  //   ifsc: conn.req.body.ifsc,
  //     address1: conn.req.body.address1,
  if (!isNonEmptyString(body.bankAccount)) {
    return `Invalid 'bankAccount'`;
  }

  if (!isNonEmptyString(body.ifsc)) {
    return `Invalid 'ifsc'`;
  }

  if (!isNonEmptyString(body.address1)) {
    return `Invalid 'address1'`;
  }

  return null;
};


module.exports = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use "POST"`
    );
  }

  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(
      conn,
      code.badRequest,
      v
    );
  }

  try {
    const userRecord = await admin
      .auth()
      .getUser(conn.requester.uid);

    if (!userRecord.email ||
      !userRecord.emailVerified ||
      !userRecord.displayName) {
      return sendResponse(
        conn,
        code.conflict,
        `Email/Display Name is missing` +
        ` Please complete your profile`
      );
    }

    const response = await addBeneficiary({
      beneId: conn.requester.uid,
      name: userRecord.displayName,
      email: userRecord.email,
      phone: userRecord.phoneNumber,
      bankAccount: String(conn.req.body.bankAccount),
      ifsc: conn.req.body.ifsc,
      address1: conn.req.body.address1,
    });

    if (response.subCode !== '200') {
      console.error('add_bene_err:', response);

      return sendResponse(
        conn,
        code.conflict,
        `Account cannot be added right now.` +
        ` ${response.message}`
      );
    }

    await rootCollections
      .updates
      .doc(conn.requester.uid)
      .set({
        linkedAccounts: {
          ifsc: conn.req.body.ifsc,
          bankAccount: String(conn.req.body.bankAccount),
          address1: conn.req.body.address1,
        },
      }, {
        merge: true,
      });

    return sendResponse(
      conn,
      code.created,
      `Account added successfully`
    );
  } catch (error) {
    return handleError(conn, error);
  }
};
