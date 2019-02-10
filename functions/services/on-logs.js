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


const {
  rootCollections,
  db,
} = require('../admin/admin');
const {
  sendResponse,
  handleError,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');


module.exports = (conn) => {
  if (conn.req.method !== 'POST') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed for ${conn.req.url}. Use 'POST'.`
    );

    return;
  }

  console.warn('Error:', conn.requester, conn.req.body);

  const phoneNumber = conn.requester.phoneNumber;
  const message = conn.req.body.message;
  const dateObject = new Date();
  const date = dateObject.getDate();
  const month = dateObject.getMonth();
  const year = dateObject.getFullYear();

  // message, body, device
  rootCollections
    .errors
    .where('message', '==', message)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((docs) => {
      if (docs.empty) {
        return rootCollections
          .errors
          .doc()
          .set({
            message,
            date,
            month,
            year,
            count: 1,
            affectedUsers: {
              [phoneNumber]: 1,
            },
            bodyObject: {
              [phoneNumber]: conn.req.body.body || '',
            },
            deviceObject: {
              [phoneNumber]: conn.req.body.device || '',
            },
          });
      }

      const doc = docs.docs[0];
      const {
        affectedUsers,
        bodyObject,
        deviceObject,
      } = doc.data();

      if (!bodyObject[phoneNumber]) {
        bodyObject[phoneNumber] = `${conn.req.body.body || ''}`;
      }

      if (!deviceObject[phoneNumber]) {
        deviceObject[phoneNumber] = `${conn.req.body.body || ''}`;
      }

      affectedUsers[phoneNumber] = (affectedUsers[phoneNumber] || 0) + 1;

      return doc.ref.set({
        affectedUsers,
        bodyObject,
        deviceObject,
      }, {
          merge: true,
        });
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};
