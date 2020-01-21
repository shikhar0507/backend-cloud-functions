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
const {subcollectionNames, addendumTypes} = require('../admin/constants');
const {handleError, sendJSON} = require('../admin/utils');
const {requestBatchTransfer} = require('../cash-free/payout');
const currency = require('currency.js');
const env = require('../admin/env');
const crypto = require('crypto');
const momentTz = require('moment-timezone');
const MAIN_OFFICE = env.mainOffice;
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

// doc below `Updates/{beneficiaryId}/Addendum/{autoId}`
const getPaymentObjectForUpdates = ({payment, id}) => {
  const {
    createdAt,
    office,
    officeId,
    amount,
    cycleStart,
    cycleEnd,
    ifsc,
    account, // last 4 digits
    status,
  } = payment;
  const {date, months: month, years: year} = momentTz(createdAt).toObject();

  return {
    date,
    month,
    year,
    office,
    officeId,
    key: momentTz()
      .date(date)
      .month(month)
      .year(year)
      .startOf('date')
      .valueOf(),
    id: `${date}${month}${year}${id}`,
    timestamp: Date.now(),
    _type: addendumTypes.PAYMENT,
    currency: 'INR',
    details: {
      status,
      account,
      ifsc,
      amount,
      cycleStart,
      cycleEnd,
    },
  };
};

const handlePayment = async requestBody => {
  // payment
  // 'TRANSFER_FAILED',
  // 'TRANSFER_SUCCESS',
  // 'TRANSFER_REVERSED',
  // 'LOW_BALANCE_ALERT',
  // 'CREDIT_CONFIRMATION',
  // 'TRANSFER_ACKNOWLEDGED',

  /**
   * Send flag to user in `/now`.
   * Delete bank account in `Updates/{uid}` of this user.
   * Create doc in Updates/{uid}/Addendum/{autoId} with _type = "payment"
   * last 4 digits of bankAccount in `Payroll`.
   */
  // 'INVALID_BENEFICIARY_ACCOUNT',
  const {
    event,
    // The `transferId` is the same as the `voucherId`
    transferId,
    signature,
  } = requestBody;
  const batch = db.batch();
  /**
   * PaymentDoc will always exist because we are creating it when
   * during the deposit webhook flow.
   */
  const paymentDoc = await rootCollections.payments.doc(transferId).get();
  const paymentData = paymentDoc.data();

  paymentData.events = paymentData.events || [];

  /**
   * Test the duplication before pushing the current event into the events array.
   */
  const isRepeatedEvent =
    paymentData.events.findIndex(
      ({signature: payloadSignature}) => payloadSignature === signature,
    ) > -1;

  paymentData.events.push(requestBody);

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

  // const {beneficiaryId} = voucherDoc.data();
  // const updatesRef = rootCollections.updates
  //   .doc(beneficiaryId)
  //   .collection(subcollectionNames.ADDENDUM)
  //   .doc();

  // batch.set(updatesRef, getPaymentObjectForUpdates(paymentData, paymentDoc.id));

  return batch.commit();
};

const handleDeposit = async requestBody => {
  const batch = db.batch();
  const {vAccountId, signature, event, amount: amountInWebhook} = requestBody;
  const {
    docs: [batchDoc],
  } = await rootCollections.batches
    .where('batchId', '==', vAccountId)
    .limit(1)
    .get();
  const {
    office,
    officeId,
    linkedDeposits = [],
    linkedVouchers = [],
  } = batchDoc.data();
  const bankDetailsMap = new Map().set(MAIN_OFFICE.officeId, MAIN_OFFICE);
  const expectedAmount = currency(batchDoc.get('amount'));
  const currentlyReceivedAmount = currency(amountInWebhook);
  const usersWithoutPaymentAccount = [];
  const {
    docs: [depositDoc],
  } = await rootCollections.deposits
    .where('vAccountId', '==', vAccountId)
    .where('officeId', '==', officeId)
    .limit(1)
    .get();
  const depositDocRef = depositDoc
    ? depositDoc.ref
    : rootCollections.deposits.doc();
  const depositData = depositDoc ? depositDoc.data() : {};

  depositData.events = depositData.events || [];

  const isRepeatedEvent =
    depositData.events.findIndex(
      ({signature: payloadSignature}) => payloadSignature === signature,
    ) > -1;

  depositData.events.push(requestBody);
  linkedDeposits.push(depositDocRef.id);

  batch.set(
    depositDocRef,
    Object.assign({}, depositData, {
      vAccountId,
      office,
      officeId,
      createdAt: depositData.createdAt || Date.now(),
      updatedAt: Date.now(),
    }),
    {merge: true},
  );

  if (isRepeatedEvent || event !== 'AMOUNT_COLLECTED') {
    console.log('is repeated', event);
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
      .where('vAccountId', '==', vAccountId)
      .where('officeId', '==', officeId)
      .get();
    console.log('fetching old deposits', deposits.size);

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
  console.log('expectedAmount', expectedAmount.value);
  console.log('amountThisInstance', amountThisInstance.value);

  const isInsufficientAmount = amountThisInstance.value < expectedAmount.value;

  console.log('isInsufficientAmount', isInsufficientAmount);

  if (isInsufficientAmount) {
    console.log('amt less');

    return batch.commit();
  }

  // start with payments here.
  // `amountThisInstance` <== this amount is now at least
  // what we were expecting when compared to the amount in
  // batch.
  // We can proceed with the payments flow.
  const voucherDocs = await db.getAll(
    /**
     * Linked vouchers will never be `undefined` or an empty array.
     */
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
    const {linkedAccounts = []} = updateDoc.data();
    const [{bankAccount, ifsc} = {}] = linkedAccounts;

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

    if (!bankAccount || !ifsc) {
      // Money can't be transferred to users without `bankAccount`.
      usersWithoutPaymentAccount.push(beneficiaryId);

      return;
    }

    // Payment is created when a deposit is done
    // from a user
    batch.set(rootCollections.payments.doc(transferId), {
      office,
      officeId,
      amount,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

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
    Object.assign({}, batchDoc.data(), {
      receivedAmount,
      linkedDeposits,
      updatedAt: Date.now(),
    }),
    {
      merge: true,
    },
  );

  console.log('transfers:', bulkTransferApiRequestBody.batch.length);

  // Handle case where `bulkTransferApiRequestBody.batch.length` is 0
  // This would be possible in the case where all the beneficiaries
  // haven't added their bank account.
  if (bulkTransferApiRequestBody.batch.length > 0) {
    const batchTransferResponse = await requestBatchTransfer({
      batch: bulkTransferApiRequestBody.batch,
      batchTransferId: bulkTransferApiRequestBody.batchTransferId,
    });

    console.log('batchTransferResponse =>', batchTransferResponse);
  }

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
