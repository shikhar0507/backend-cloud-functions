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

const {createVirtualAccount} = require('../../cash-free/autocollect');
const {code} = require('../../admin/responses');
const {
  sendResponse,
  sendJSON,
  isNonEmptyString,
  handleError,
} = require('../../admin/utils');
const {subcollectionNames} = require('../../admin/constants');
const {rootCollections, db} = require('../../admin/admin');
const currency = require('currency.js');
const env = require('../../admin/env');

const validator = requestBody => {
  const {office, vouchers} = requestBody;

  if (!isNonEmptyString(office)) {
    return `Invalid/Missing field 'office'`;
  }

  const invalidDepositMessage =
    `Expected 'vouchers' field to be an array of objects` +
    ` in the form [{voucherId: 'id1'}]`;

  if (!Array.isArray(vouchers) || vouchers.length === 0) {
    return invalidDepositMessage;
  }

  const invalidDepositObjects = vouchers.filter(({voucherId}) =>
    isNonEmptyString(voucherId),
  );

  if (vouchers.length !== invalidDepositObjects.length) {
    return invalidDepositMessage;
  }

  return null;
};

const getVouchers = async ({vouchers, officeId}) => {
  const voucherIds = new Set();
  const existingVouchers = [];
  const nonExistingVouchers = [];
  const batchedVouchers = [];
  const voucherRefs = vouchers.reduce((prevIterationResult, {voucherId}) => {
    // Uniques required.
    const isDuplicate = voucherIds.has(voucherId);

    if (!isDuplicate) {
      prevIterationResult.push(
        rootCollections.offices
          .doc(officeId)
          .collection(subcollectionNames.VOUCHERS)
          .doc(voucherId),
      );
    }

    voucherIds.add(voucherId);

    return prevIterationResult;
  }, []);

  const voucherDocs = await db.getAll(...voucherRefs);

  for (const doc of voucherDocs) {
    const {exists} = doc;
    const {batchId} = doc.data();

    if (!exists) {
      nonExistingVouchers.push(doc);

      continue;
    }

    if (batchId) {
      batchedVouchers.push(doc);

      continue;
    }

    existingVouchers.push(doc);
  }

  return {existingVouchers, nonExistingVouchers, batchedVouchers};
};

const getVirtualAccount = async ({officeDoc, batchId, email, phone}) => {
  const vaResponse = await createVirtualAccount({
    email,
    phone,
    name: officeDoc.get('office'),
    vAccountId: batchId,
  });

  console.log('vaResponse', vaResponse);

  const {data} = vaResponse;

  if (!data) {
    return null;
  }

  const {ifsc, accountNumber} = data;

  return {ifsc, bankAccount: accountNumber};
};

const getPercentOf = (number, percentage) => (percentage / 100) * number;

const getBatchesAndDeposits = async ({officeId}) => {
  const [deposits, batches] = await Promise.all([
    rootCollections.deposits.where('officeId', '==', officeId).get(),
    rootCollections.batches.where('officeId', '==', officeId).get(),
  ]);

  return {
    deposits: deposits.docs.map(doc =>
      Object.assign({}, doc.data(), {id: doc.id}),
    ),
    batches: batches.docs.map(doc =>
      Object.assign({}, doc.data(), {id: doc.id}),
    ),
  };
};

const generateVirtualAccountId = id => id.substring(0, 10).toUpperCase();

const getBatchId = async seed => {
  const {id: tempId} = rootCollections.batches.doc();
  const batchId = seed || generateVirtualAccountId(tempId);
  const {empty} = await rootCollections.batches
    .where('batchId', '==', batchId)
    .limit(1)
    .get();

  if (empty) {
    return batchId;
  }

  return getBatchId(null);
};

const depositsHandler = async conn => {
  const {body} = conn.req;
  const {office, vouchers} = body;
  const batch = db.batch();
  // const batchRef = await getBatchRef();
  const batchRef = rootCollections.batches.doc();
  const v = validator(body);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'POST'`,
    );
  }

  /**
   * A certain percentage of amount is added to the batch
   * which is created in this instance. This is the `supplier`
   * voucher.
   */
  const mainOffice = env.isProduction
    ? 'Growthfile Analytics Private Limited'
    : 'Puja Capital';

  const [
    {
      docs: [officeDoc],
    },
    {
      docs: [
        /**
         * Growthfile Analytics Private Limited
         * A single voucher doc will be created on
         * creation of batches.
         */
        gapl,
      ],
    },
  ] = await Promise.all([
    rootCollections.offices
      .where('office', '==', office)
      .limit(1)
      .get(),
    rootCollections.offices
      .where('office', '==', mainOffice)
      .limit(1)
      .get(),
  ]);

  if (!officeDoc) {
    return sendResponse(conn, code.conflict, `${office} not found`);
  }

  const {id: officeId} = officeDoc;
  const {
    existingVouchers,
    nonExistingVouchers,
    batchedVouchers,
  } = await getVouchers({vouchers, officeId});

  if (nonExistingVouchers.length > 0) {
    return sendResponse(
      conn,
      code.conflict,
      `Found non-existing voucher ids. Nothing was changed.`,
    );
  }

  if (batchedVouchers.length > 0) {
    return sendResponse(
      conn,
      code.conflict,
      `One or more batches already in processing. Nothing was changed.`,
    );
  }

  let totalPayableByUser = currency(0);
  const newVouchers = [];
  /**
   * This ID acts just as a seed to generate the 6-10 character
   * uppercase aplhabetic string. The vAccountId field in the
   * cashfree api requires it to be uniuque.
   */
  const tempId = batchRef.id;
  const seed = generateVirtualAccountId(tempId);
  /**
   * Cashfree requires the batchId to be a 6 to 10 UPPER CASE string
   */
  const batchId = await getBatchId(seed);
  const batchObject = {
    office,
    officeId,
    batchId,
    linkedVouchers: [],
    phoneNumber: conn.requester.phoneNumber,
    uid: conn.requester.uid,
    displayName: conn.requester.displayName || '',
    photoURL: conn.requester.photoURL || '',
    email: conn.requester.email || '',
    /**
     * Start with 0
     */
    amount: currency(0),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const vaResponse = await getVirtualAccount({
    officeDoc,
    batchId,
    email: conn.requester.email,
    phone: conn.requester.phoneNumber,
  });

  if (!vaResponse) {
    return sendResponse(conn, code.conflict, 'API unavailable at the moment');
  }

  const {bankAccount, ifsc} = vaResponse;

  existingVouchers.forEach(doc => {
    const {id: voucherId} = doc;
    const {amount = 0} = doc.data();

    batchObject.linkedVouchers.push(voucherId);
    totalPayableByUser = totalPayableByUser.add(amount);

    const voucherUpdate = Object.assign({}, doc.data(), {
      batchId,
      updatedAt: Date.now(),
    });

    newVouchers.push(
      Object.assign({}, voucherUpdate, {
        id: voucherId,
      }),
    );

    batch.set(doc.ref, voucherUpdate, {merge: true});
  });

  const halfPercentOfTotal = getPercentOf(totalPayableByUser.value, 0.5);
  const calculatedGstOnTotal = getPercentOf(halfPercentOfTotal, 18);
  const convenienceFee = currency(halfPercentOfTotal).add(calculatedGstOnTotal);
  const payableAmount = currency(totalPayableByUser).add(convenienceFee);

  // serviceVoucher
  batch.set(officeDoc.ref.collection(subcollectionNames.VOUCHERS).doc(), {
    office,
    batchId,
    officeId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    type: 'supplier',
    amount: `${convenienceFee.value}`,
    beneficiaryId: gapl.id,
  });

  batch.set(
    batchRef,
    Object.assign({}, batchObject, {
      ifsc,
      bankAccount,
      amount: `${payableAmount.value}`,
    }),
  );

  await batch.commit();

  return sendJSON(
    conn,
    Object.assign(
      {},
      {
        ifsc,
        bankAccount,
        amount: `${payableAmount.value}`,
        vouchers: newVouchers,
      },
      await getBatchesAndDeposits({officeId}),
    ),
  );
};

module.exports = async conn => {
  try {
    return depositsHandler(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
