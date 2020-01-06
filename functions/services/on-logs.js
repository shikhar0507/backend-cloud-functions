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
const {sendResponse, handleError} = require('../admin/utils');
const {code} = require('../admin/responses');

const getSubject = message =>
  `Error count` + ` >= 10: '${message}':` + ` ${process.env.GCLOUD_PROJECT}`;

const getValue = (snap, field) => {
  if (snap.empty) {
    return {};
  }

  return snap.docs[0].get(field) || {};
};

module.exports = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed` + ` for ${conn.req.url}. Use 'POST'.`,
    );
  }

  const special = [`We have blocked all requests`, `help`];

  const THRESHOLD = 10;
  const dateObject = new Date();
  const date = dateObject.getDate();
  const month = dateObject.getMonth();
  const year = dateObject.getFullYear();
  const phoneNumber = conn.requester.phoneNumber;
  const message = conn.req.body.message;
  const batch = db.batch();

  if (!message) {
    return sendResponse(conn, code.noContent);
  }

  try {
    const errorDocsQueryResult = await rootCollections.errors
      .where('message', '==', message)
      .where('date', '==', date)
      .where('month', '==', month)
      .where('year', '==', year)
      .limit(1)
      .get();

    const affectedUsers = getValue(errorDocsQueryResult, 'affectedUsers');
    const bodyObject = getValue(errorDocsQueryResult, 'bodyObject');
    const deviceObject = getValue(errorDocsQueryResult, 'deviceObject');

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

    affectedUsers[phoneNumber] = affectedUsers[phoneNumber] || 0;

    affectedUsers[phoneNumber]++;

    // Increment the count
    const docData = {
      affectedUsers,
      bodyObject,
      deviceObject,
      timestamp: Date.now(),
    };

    if (
      conn.req.body.hasOwnProperty('locationError') &&
      typeof conn.req.body.locationError === 'boolean'
    ) {
      docData.locationError = conn.req.body.locationError;
    }

    if (
      !errorDocsQueryResult.empty &&
      !errorDocsQueryResult.docs[0].get('emailSent') &&
      Object.keys(affectedUsers).length >= THRESHOLD
    ) {
      batch.set(rootCollections.instant.doc(), {
        subject: getSubject(message),
        messageBody: JSON.stringify(docData, ' ', 2),
      });

      docData.emailSent = true;
    }

    if (special.includes(conn.req.body.message)) {
      // last read
      // last now
      // last activity
      // last addendum
      const lastQueryFrom = conn.requester.profileDoc.get('lastQueryFrom');
      const updatesDoc = await rootCollections.updates
        .doc(conn.requester.uid)
        .get();
      const lastNowRequestTimestamp = updatesDoc.get('lastNowRequestTimestamp');
      const latestActivityQuery = await rootCollections.profiles
        .doc(phoneNumber)
        .collection('Activities')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      docData.loggedData = docData.loggedData || {};
      docData.loggedData[phoneNumber] = docData.loggedData[phoneNumber] || [];

      const object = {
        lastQueryFrom: lastQueryFrom || null,
        lastNowRequestTimestamp: lastNowRequestTimestamp || null,
        userRecord: {
          phoneNumber: conn.requester.phoneNumber,
          emailVerified: conn.requester.emailVerified,
          email: conn.requester.email,
        },
      };

      if (!latestActivityQuery.empty) {
        object.latestActivity = latestActivityQuery.docs[0].data();
      }

      const employeeOf = conn.requester.profileDoc.get('employeeOf') || {};
      const officeId = Object.values(employeeOf)[0];

      if (officeId) {
        const latestAddendumQueryResult = await rootCollections.offices
          .doc(officeId)
          .collection('Addendum')
          .where('user', '==', phoneNumber)
          .orderBy('timestamp', 'desc')
          .limit(1)
          .get();

        if (!latestAddendumQueryResult.empty) {
          object.latestAddendumDoc = latestAddendumQueryResult.docs[0].data();
        }
      }

      docData.loggedData[phoneNumber].push(object);
    }

    const errorDocRef = !errorDocsQueryResult.empty
      ? errorDocsQueryResult.docs[0].ref
      : rootCollections.errors.doc();

    batch.set(
      errorDocRef,
      Object.assign({}, docData, {
        date,
        month,
        year,
        message,
      }),
      {
        merge: true,
      },
    );

    console.log('Error Log:', {message, id: errorDocRef.id});

    await batch.commit();

    return sendResponse(conn, code.ok, 'Logged successfully');
  } catch (error) {
    return handleError(conn, error);
  }
};
