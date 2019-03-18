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

  const phoneNumber = conn.requester.phoneNumber;
  const message = conn.req.body.message;

  if (!message) {
    sendResponse(conn, code.noContent);

    return;
  }

  const MAX_THRESHOLD = 10;
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
        emailSent,
      } = doc.data();

      if (!bodyObject[phoneNumber]) {
        const data = (() => {
          if (typeof conn.req.body.body === 'string') {
            return conn.req.body.body;
          }

          return JSON.stringify(conn.req.body.body);
        })();

        bodyObject[phoneNumber] = `${data || ''}`;
      }

      if (!deviceObject[phoneNumber]) {
        const data = (() => {
          if (typeof conn.req.body.device === 'string') {
            return conn.req.body.device;
          }

          return JSON.stringify(conn.req.body.device);
        })();

        deviceObject[phoneNumber] = `${data || ''}`;
      }

      const batch = db.batch();

      // Increment the count
      affectedUsers[phoneNumber] = (affectedUsers[phoneNumber] || 0) + 1;

      const docData = {
        affectedUsers,
        bodyObject,
        deviceObject,
      };

      if (conn.req.body.hasOwnProperty('locationError')
        && typeof conn.req.body.locationError === 'boolean') {
        docData.locationError = conn.req.body.locationError;
      }

      if (!emailSent
        && Object.keys(affectedUsers).length >= MAX_THRESHOLD) {
        const getSubject = (message) =>
          `Error count >= 10: '${message}': ${process.env.GCLOUD_PROJECT}`;

        batch
          .set(rootCollections
            .instant
            .doc(), {
              subject: getSubject(message),
              messageBody: JSON.stringify(docData, ' ', 2),
            });

        docData.emailSent = true;
      }

      batch.set(doc.ref, docData, {
        merge: true,
      });

      return batch.commit();
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};
