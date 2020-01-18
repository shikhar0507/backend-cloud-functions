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

const {rootCollections, db} = require('../admin/admin');
const {subcollectionNames} = require('../admin/constants');
const {handleError, sendJSON} = require('../admin/utils');
const {requestBatchTransfer} = require('../cash-free/payout');
const currency = require('currency.js');
const env = require('../admin/env');
const crypto = require('crypto');
const depositEvents = new Set([
  'AMOUNT_SETTLED',
  'AMOUNT_COLLECTED',
  'TRANSFER_REJECTED',
]);
const paymentEvents = new Set([
  'TRANSFER_FAILED',
  'TRANSFER_SUCCESS',
  'TRANSFER_REVERSED',
  'LOW_BALANCE_ALERT',
  'CREDIT_CONFIRMATION',
  'TRANSFER_ACKNOWLEDGED',
  'INVALID_BENEFICIARY_ACCOUNT',
]);

const getClientSecret = isPaymentEvent => {
  if (isPaymentEvent) {
    return env.cashFree.payout.clientSecret;
  }

  return env.cashFree.autocollect.clientSecret;
};

const verifyWebhookPost = webhookData => {
  let concatenatedValues = '';
  const {signature: receivedSignature, event} = webhookData;
  const isPaymentEvent = paymentEvents.has(event);

  delete webhookData.signature;

  Object.keys(webhookData)
    .sort()
    .forEach(key => (concatenatedValues += `${webhookData[key]}`));

  const calculatedSignature = crypto
    .createHmac('sha256', getClientSecret(isPaymentEvent))
    .update(concatenatedValues)
    .digest('base64');

  return calculatedSignature === receivedSignature;
};

const handlePayment = async requestBody => {
  // payment
  // 'TRANSFER_FAILED',
  // 'TRANSFER_SUCCESS',
  // 'TRANSFER_REVERSED',
  // 'LOW_BALANCE_ALERT',
  // 'CREDIT_CONFIRMATION',
  // 'TRANSFER_ACKNOWLEDGED',
  // 'INVALID_BENEFICIARY_ACCOUNT',
  const {
    event,
    // The `transferId` is the same as the `voucherId`
    transferId,
    signature,
  } = requestBody;
  const batch = db.batch();
  const paymentDoc = await rootCollections.payments.doc(transferId).get();
  const paymentData = paymentDoc.data();

  paymentData.events = paymentData.events || [];
  paymentData.events.push(requestBody);

  const isRepeatedEvent =
    paymentData.events.findIndex(
      ({signature: payloadSignature}) => payloadSignature === signature,
    ) > -1;

  if (event !== 'TRANSFER_SUCCESS' || isRepeatedEvent) {
    batch.set(paymentDoc.ref, paymentData, {merge: true});

    return batch.commit();
  }

  // transfer completed successfully.
  const {officeId} = paymentDoc.data();
  const voucherDoc = await rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.VOUCHERS)
    .doc(transferId)
    .get();

  batch.set(
    paymentDoc.ref,
    Object.assign({}, paymentData, {
      cycleStart: voucherDoc.get('cycleStart'),
      cycleEnd: voucherDoc.get('cycleEnd'),
      updatedAt: Date.now(),
    }),
    {merge: true},
  );

  // Voucher update with status
  batch.set(
    voucherDoc.ref,
    Object.assign({}, voucherDoc.data(), {
      status: event,
      updatedAt: Date.now(),
    }),
    {merge: true},
  );

  // TODO: Create payments info in Updates/{uid}/Addendum/{autoId} with _type = "payments"

  return batch.commit();
};

const handleDeposit = async requestBody => {
  const batch = db.batch();
  const {
    utr,
    vAccountId,
    signature,
    event,
    amount: amountInWebhook,
  } = requestBody;
  const {
    docs: [batchDoc],
  } = await rootCollections.batches
    .where('vAccountId', '==', vAccountId)
    .limit(1)
    .get();

  const {
    office,
    officeId,
    linkedDeposits = [],
    linkedVouchers = [],
  } = batchDoc.data();
  const batchUpdate = batchDoc.data();
  const bankDetailsMap = new Map();
  const expectedAmount = currency(batchDoc.get('amount'));
  const currentlyReceivedAmount = currency(amountInWebhook);
  const usersWithoutPaymentAccount = [];

  const {
    docs: [depositDoc],
  } = await rootCollections.deposits
    .where('utr', '==', utr)
    .where('officeId', '==', officeId)
    .limit(1)
    .get();

  const depositDocRef = depositDoc
    ? depositDoc.ref
    : rootCollections.deposits.doc();
  const depositData = depositDoc ? depositDoc.data() : {};

  depositData.events = depositData.events || [];
  depositData.events.push(requestBody);

  linkedDeposits.push(depositDocRef.id);

  batch.set(
    depositDocRef,
    Object.assign({}, depositData, {
      office,
      officeId,
      createdAt: depositData.createdAt || Date.now(),
      updatedAt: Date.now(),
    }),
    {merge: true},
  );

  const isRepeatedEvent =
    depositData.events.findIndex(
      ({signature: payloadSignature}) => payloadSignature === signature,
    ) > -1;

  if (isRepeatedEvent || event !== 'AMOUNT_COLLECTED') {
    return batch.commit();
  }

  const {value: receivedAmount} = currency(
    batchDoc.get('receivedAmount') || 0,
  ).add(amountInWebhook);

  let amountThisInstance = currency(currentlyReceivedAmount);

  if (currentlyReceivedAmount.value < expectedAmount.value) {
    // fetch other deposits with same batchId
    // add their sum.
    // if that sum is at least equal to the expected amount
    //   start payments
    // else
    //   exit
    const deposits = await rootCollections.deposits
      .where('batchId', '==', vAccountId)
      .where('officeId', '==', officeId)
      .get();

    deposits.forEach(deposit => {
      amountThisInstance = amountThisInstance.add(deposit.get('amount'));
    });
  }

  // Amount received during this instance + amount received
  // during all previous deposits during this payment flow
  // is less than what was expected, then we wait for
  // another deposit and run this flow again.
  // As soon as the money received is at least the expected value
  // we create payments and payment docs in `Payments/{voucherId}`.
  if (expectedAmount.value < amountThisInstance.value) {
    return batch.commit();
  }

  // start with payments here.
  // `amountThisInstance` <== this amount is now at least
  // what we were expecting when compared to the amount in
  // batch.
  // We can proceed with the payments flow.
  const voucherDocs = await db.getAll(
    ...linkedVouchers.map(voucherId =>
      rootCollections.offices
        .doc(officeId)
        .collection(subcollectionNames.VOUCHERS)
        .doc(voucherId),
    ),
  );

  const updateCollectionRefs = await db.getAll(
    ...voucherDocs.map(voucher => {
      const {beneficiaryId} = voucher.data();

      return rootCollections.updates.doc(beneficiaryId);
    }),
  );

  updateCollectionRefs.forEach(updateDoc => {
    const {id: uid} = updateDoc;
    const {linkedAccounts} = updateDoc.data();
    const [{bankAccount, ifsc} = {}] = linkedAccounts || [];

    bankDetailsMap.set(uid, {bankAccount, ifsc});
  });

  const bulkTransferApiRequestBody = {
    batchTransferId: batchDoc.id,
    batchFormat: 'BANK_ACCOUNT',
    batch: [],
  };

  voucherDocs.forEach(voucher => {
    const {
      email,
      amount,
      phoneNumber,
      displayName,
      beneficiaryId,
    } = voucher.data();
    const {id: transferId} = voucher;

    const {bankAccount, ifsc} = bankDetailsMap.get(beneficiaryId) || {};

    // Money can't be transferred to users without bankAccount.
    if (!bankAccount || !ifsc) {
      usersWithoutPaymentAccount.push(beneficiaryId);

      return;
    }

    batch.set(
      rootCollections.payments.doc(transferId),
      {
        office,
        officeId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        merge: true,
      },
    );

    bulkTransferApiRequestBody.batch.push({
      ifsc,
      email,
      amount,
      transferId,
      bankAccount,
      phone: phoneNumber,
      name: displayName,
    });
  });

  console.log('bulkTransferApiRequestBody', bulkTransferApiRequestBody);
  console.log('usersWithoutPaymentAccount', usersWithoutPaymentAccount);

  batch.set(
    batchDoc.ref,
    Object.assign({}, batchUpdate, {
      receivedAmount,
      linkedDeposits,
      updatedAt: Date.now(),
    }),
    {
      merge: true,
    },
  );

  // TODO: Handle case where bulkTransferApiRequestBody.batch.length is 0
  // This would be possible in the case where all the beneficiaries
  // haven't added their bank account.

  const batchTransferResponse = await requestBatchTransfer({
    batch: bulkTransferApiRequestBody.batch,
    batchTransferId: bulkTransferApiRequestBody.batchTransferId,
  });

  console.log('r', batchTransferResponse);

  return batch.commit();
};

const cashfreeWebhookHandler = async conn => {
  console.log('cashfree webhook', conn.req.body);
  const {signature, event} = conn.req.body;

  // Invalid request sent to the API
  if (typeof signature !== 'string') {
    return sendJSON(conn, '');
  }

  // This is a simple object with key and value (strings).
  // While verifying the signature of the request, we are
  // modifying the request body by removing the field
  // `signature`.
  // To avoid missing any field value during data processing, we can simply
  const isValidRequest = verifyWebhookPost(Object.assign({}, conn.req.body));
  const logBatch = db.batch();

  if (!isValidRequest) {
    logBatch.set(rootCollections.instant.doc(), {
      subject: 'Invalid Signature in Cashfree webhook',
      messageBody: JSON.stringify(conn.req.body, ' ', 2),
    });
  }

  await logBatch.commit();

  if (paymentEvents.has(event)) {
    await handlePayment(conn.req.body);
  }

  if (depositEvents.has(event)) {
    await handleDeposit(conn.req.body);
  }

  return sendJSON(conn, '');
};

module.exports = async conn => {
  try {
    return cashfreeWebhookHandler(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
