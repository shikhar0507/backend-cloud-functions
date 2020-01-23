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
const env = require('../admin/env');
const momentTz = require('moment-timezone');

const storeEvents = async conn => {
  const { date, months: month, years: year } = momentTz().toObject();
  const ref = rootCollections.facebookEvents.doc();

  console.log('ref', ref.path);

  await ref.set({
    date,
    month,
    year,
    type: conn.req.body.object || null,
    body: conn.req.body,
    query: conn.req.query,
    receivedAt: Date.now(),
  });

  return '';
};

module.exports = async conn => {
  // This way of verifying is perhaps not correct.
  // We should store this event details somewhere and then
  // verify them in the subsequent POST request.
  // Not sure, though.
  if (
    conn.req.method === 'GET' &&
    conn.req.query['hub.verify_token'] === env.fbVerificationToken
  ) {
    return parseInt(conn.req.query['hub.challenge']);
  }

  if (conn.req.method === 'POST') {
    return storeEvents(conn);
  }

  return null;
};
