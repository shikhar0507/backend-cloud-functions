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

const {db, rootCollections} = require('../../admin/admin');
const {sendJSON, sendResponse, handleError} = require('../../admin/utils');
const {code} = require('../../admin/responses');
const dinero = require('dinero.js');

module.exports = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'POST'`,
    );
  }

  const {paymentIds, officeId} = conn.req.body;
  const paymentRefs = [];

  paymentIds.forEach(docId => {
    const ref = rootCollections.offices
      .doc(officeId)
      .collection('PendingPayments')
      .doc(docId);

    paymentRefs.push(ref);
  });

  try {
    const paymentDocs = await db.getAll(...paymentRefs);
    const total = dinero({
      amount: 0,
    });
    let numberOfPayments = 0;
    const results = [];

    paymentDocs.forEach(doc => {
      if (!doc.exists) {
        return;
      }

      // TRANSFER_SUCCESS, TRANSFER_FAILED
      // TRANSFER_REVERSED,CREDIT_CONFIRMATION
      // TRANSFER_ACKNOWLEDGED, INVALID_BENEFICIARY_ACCOUNT,
      // LOW_BALANCE_ALERT
      // const status = doc.get('status');
      const amount = dinero({
        amount: doc.get('amount'),
      });

      total.add(amount);

      numberOfPayments++;
    });

    const autocollectRef = rootCollections.inboundPayments.doc();

    // TODO: ADD 0.59% to
    const batch = db.batch();
    const amountWithCharges = total.getAmount() + (0.59 % total.getAmount());

    batch.set(
      autocollectRef,
      {
        officeId,
        numberOfPayments,
        paymentMethod: '',
        status: 'PENDING',
        amountWithoutCharges: total.getAmount(),
        amount: amountWithCharges,
        phoneNumber: conn.requester.phoneNumber,
        uid: conn.requester.uid,
        provider: 'cashfree',
        createTimestamp: Date.now(),
      },
      {
        merge: true,
      },
    );

    await batch.commit();

    return sendJSON(conn, {
      numberOfPayments,
      transactionId: autocollectRef.id,
      amount: amountWithCharges,
      results,
    });
  } catch (error) {
    return handleError(conn, error);
  }
};
