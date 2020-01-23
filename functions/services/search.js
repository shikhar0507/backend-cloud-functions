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
const {
  isNonEmptyString,
  sendResponse,
  sendJSON,
  handleError,
} = require('../admin/utils');
const { code } = require('../admin/responses');

const searchOffice = async conn => {
  if (conn.req.method !== 'GET') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `Method '${conn.req.method}' is not allowed. Use 'GET'`,
    );
  }

  const { q: placeId } = conn.req.query;

  if (!isNonEmptyString(placeId)) {
    return sendResponse(conn, code.badRequest, `Query param 'q' is missing`);
  }

  const branches = await rootCollections.activities
    .where('placeId', '==', placeId)
    .where('status', '==', 'CONFIRMED')
    .get();

  const officeNames = new Set();
  const officePromises = [];

  branches.forEach(branch => {
    const { office } = branch.data();

    if (officeNames.has(office)) {
      return;
    }

    officePromises.push(
      rootCollections.offices
        .where('office', '==', office)
        .select(
          'status',
          'office',
          'attachment.Registered Office Address.value',
        )
        .limit(1)
        .get(),
    );

    officeNames.add(office);
  });

  const officeSnaps = await Promise.all(officePromises);

  const results = [];
  officeSnaps.forEach(snap => {
    const [doc] = snap.docs;

    if (doc.get('status') === 'CANCELLED') {
      return;
    }

    results.push({
      status: doc.get('status'),
      name: doc.get('office'),
      registeredOfficeAddress: doc.get(
        'attachment.Registered Office Address.value',
      ),
    });
  });

  return sendJSON(conn, results);
};

module.exports = async conn => {
  try {
    return searchOffice(conn);
  } catch (error) {
    return handleError(conn, error);
  }
};
