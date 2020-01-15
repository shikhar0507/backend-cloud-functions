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
const {code} = require('../admin/responses');
const {verifyWebhookPost} = require('../cash-free/payout');
const {sendResponse, handleError} = require('../admin/utils');

const cashFreeWebookHandler = async conn => {
  console.log('cashfree webhook', conn.req.body);
  // const batch = db.batch();
  // const {signature} = conn.req.body;

  // // returns a boolean
  // if (!verifyWebhookPost(conn.req.body)) {
  //   batch.set(rootCollections.instant.doc);
  //   await rootCollections.instant.doc({
  //     subject: 'Invalid Signature in Cashfree webhook',
  //     messageBody: JSON.stringify(conn.req.body, ' ', 2),
  //   });
  // }

  // const depositRef = rootCollections.deposits.doc(conn.req.body.utr);
  // const paymentRef = rootCollections.payments.doc(conn.req.body.utr);

  // const {docs: [batchDoc]} = rootCollections.batches

  // await batch.commit();

  return sendResponse(conn, 200);
};

module.exports = async conn => {
  try {
    return cashFreeWebookHandler(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
