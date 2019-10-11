'use strict';

const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  sendJSON,
  sendResponse,
  handleError,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const dinero = require('dinero.js');


module.exports = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,

    );
  }

  const { paymentIds, officeId } = conn.req.body;
  const paymentRefs = [];

  paymentIds.forEach(docId => {
    const ref = rootCollections
      .offices
      .doc(officeId)
      .collection('PendingPayments')
      .doc(docId);

    paymentRefs
      .push(ref);
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

      total
        .add(amount);

      numberOfPayments++;
    });

    const autocollectRef = rootCollections
      .inboundPayments
      .doc();

    // TODO: ADD 0.59% to
    const batch = db.batch();
    const amountWithCharges = total.getAmount() + (0.59 % total.getAmount());

    batch
      .set(autocollectRef, {
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
      }, {
        merge: true,
      });

    await batch
      .commit();

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
