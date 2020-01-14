/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const {rootCollections} = require('../admin/admin');
const {sendResponse, handleError, isNonEmptyString} = require('../admin/utils');
const {addBeneficiary, removeBeneficiary} = require('../cash-free/payout');
const {code} = require('../admin/responses');
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

const handlePost = async conn => {
  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  try {
    const userRecord = await admin.auth().getUser(conn.requester.uid);

    if (
      !userRecord.email ||
      !userRecord.emailVerified ||
      !userRecord.displayName
    ) {
      return sendResponse(
        conn,
        code.conflict,
        `Email/Display Name is missing` + ` Please complete your profile`,
      );
    }

    const response = await addBeneficiary({
      beneId: conn.requester.uid,
      name: userRecord.displayName,
      email: userRecord.email,
      phone: userRecord.phoneNumber.split('+91')[1],
      bankAccount: String(conn.req.body.bankAccount),
      ifsc: conn.req.body.ifsc,
      address1: conn.req.body.address1,
    });

    if (response.subCode !== '200') {
      console.error('add_bene_err:', response);

      return sendResponse(
        conn,
        code.conflict,
        `Account cannot be added right now.` + ` ${response.message}`,
      );
    }

    await rootCollections.updates.doc(conn.requester.uid).set(
      {
        linkedAccounts: [
          {
            ifsc: conn.req.body.ifsc,
            bankAccount: String(conn.req.body.bankAccount),
            address1: conn.req.body.address1,
          },
        ],
      },
      {
        merge: true,
      },
    );

    return sendResponse(conn, code.created, `Account added successfully`);
  } catch (error) {
    return handleError(conn, error);
  }
};

const handleDelete = async conn => {
  const validator = body => {
    if (!isNonEmptyString(body.bankAccount)) {
      return `Invalid/missing bankAccount in the request body`;
    }

    return null;
  };

  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  try {
    const response = await removeBeneficiary(conn.requester.uid);

    console.log('response', response);

    if (response.subCode === '404') {
      return sendResponse(
        conn,
        code.conflict,
        `No bank account is linked to your account`,
      );
    }
    if (response.subCode !== '200') {
      console.log(response);

      return sendResponse(
        conn,
        code.badRequest,
        `There was a problem removing your account. Please try again later`,
      );
    }

    const updatesDoc = await rootCollections.updates
      .doc(conn.requester.uid)
      .get();
    const linkedAccounts = updatesDoc.get('linkedAccounts') || [];

    const indexOfAccountToDelete = linkedAccounts.findIndex(account => {
      return account.bankAccount.endsWith(conn.req.body.bankAccount);
    });

    if (indexOfAccountToDelete === -1) {
      return sendResponse(conn, code.conflict, `Account not found`);
    }

    linkedAccounts.splice(indexOfAccountToDelete, 1);

    await updatesDoc.ref.set(
      {
        linkedAccounts,
      },
      {
        merge: true,
      },
    );

    return sendResponse(conn, code.ok, `Bank account deleted successfully`);
  } catch (error) {
    return handleError(conn, error);
  }
};

module.exports = async conn => {
  if (conn.req.method === 'POST') {
    return handlePost(conn);
  }

  if (conn.req.method === 'DELETE') {
    return handleDelete(conn);
  }

  return sendResponse(
    conn,
    code.methodNotAllowed,
    `${conn.req.method} is not allowed. Use GET/POST`,
  );
};
