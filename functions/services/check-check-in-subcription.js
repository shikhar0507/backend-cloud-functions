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

const { rootCollections } = require('../admin/admin');
const { code } = require('../admin/responses');
const { subcollectionNames } = require('../admin/constants');
const { sendJSON, sendResponse, handleError } = require('../admin/utils');

const hasCheckInSubscription = async conn => {
  if (conn.req.method !== 'GET') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'GET'`,
    );
  }

  // Check self subscription of check-in
  const {
    docs: [checkInSubscriptionDoc],
  } = await rootCollections.profiles
    .doc(conn.requester.phoneNumber)
    .collection(subcollectionNames.SUBSCRIPTIONS)
    .where('template', '==', 'check-in')
    .where('status', '==', 'CONFIRMED')
    .limit(1)
    .get();

  return sendJSON(conn, {
    hasCheckInSubscription: !!checkInSubscriptionDoc,
  });
};

module.exports = async conn => {
  try {
    return hasCheckInSubscription(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
