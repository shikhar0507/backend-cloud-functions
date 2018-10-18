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


const { code } = require('../../admin/responses');
const {
  db,
  users,
  rootCollections,
  serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');
const {
  isValidDate,
  handleError,
  sendResponse,
  getISO8601Date,
  isValidGeopoint,
  isE164PhoneNumber,
} = require('../../admin/utils');


const updateUserDocs = (conn) => {
  const profile = rootCollections.profiles.doc(conn.requester.phoneNumber);

  Promise
    .all([
      profile.get(),
      profile.collection('Activities').get(),
      profile.collection('Subscriptions').get(),
    ])
    .then((result) => {
      const batch = db.batch();
      const profileDoc = result[0];
      const activities = result[1];
      const subscriptions = result[2];

      const newProfileData = profileDoc.data();
      newProfileData.phoneNumber = conn.req.body.phoneNumber;

      batch.set(profile, {
        uid: null,
      }, {
          merge: true,
        });

      batch.set(rootCollections
        .profiles
        .doc(conn.req.body.phoneNumber),
        newProfileData
      );

      batch.set(rootCollections
        .updates
        .doc(conn.requester.uid), {
          phoneNumber: conn.req.body.phoneNumber,
        }, {
          merge: true,
        });

      /** Logs the phone number changes per day. */
      batch.set(rootCollections
        .dailyPhoneNumberChanges
        .doc(getISO8601Date()), {
          [newProfileData.phoneNumber]: {
            newPhoneNumber: conn.req.body.phoneNumber,
          },
        }, {
          merge: true,
        });

      subscriptions.forEach((doc) => batch.delete(doc.ref));

      const userDeviceTimestamp = new Date(conn.req.body.timestamp);
      const geopoint = getGeopointObject(conn.req.body.geopoint);

      activities.forEach((doc) => {
        batch.set(rootCollections
          .phoneNumberUpdates
          .doc(doc.id), {
            userDeviceTimestamp,
            location: geopoint,
            canEdit: doc.get('canEdit'),
            timestamp: serverTimestamp,
            user: conn.requester.phoneNumber,
            updatedPhoneNumber: conn.req.body.phoneNumber,
            isSupportRequest: conn.requester.isSupportRequest,
          });
      });

      return batch.commit();
    })
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  const fields = [
    'phoneNumber',
    'geopoint',
    'timestamp',
  ];

  const result = {
    isValid: true,
    message: null,
  };

  for (const field of fields) {
    if (!conn.req.body.hasOwnProperty(field)) {
      result.isValid = false;
      result.message = `The field: '${field}' is missing from the`
        + ` request body.`;
    }

    const value = conn.req.body[field];

    if (field === 'timestamp') {
      if (typeof value !== 'number') {
        result.isValid = false;
        result.message = `The value in the field '${field}' should be a valid`
          + ` unix timestamp (number).`;
        break;
      }

      if (!isValidDate(value)) {
        result.isValid = false;
        result.message = `The value in the field '${field}' should be a valid`
          + ` unix timestamp (number).`;
        break;
      }
    }

    if (field === 'phoneNumber') {
      if (!isE164PhoneNumber(value)) {
        result.isValid = false;
        result.message = `The field 'phoneNumber' should be a valid E.164`
          + ` phone number string.`;
        break;
      }
    }

    if (field === 'geopoint') {
      if (!isValidGeopoint(value)) {
        result.isValid = false;
        result.message = `The field 'geopoint' should be a valid`
          + ` geopoint object.`;
        break;
      }
    }
  }

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  users
    .updateUserPhoneNumberInAuth(
      conn.requester.uid,
      conn.req.body.phoneNumber
    )
    .then(() => updateUserDocs(conn))
    .catch((error) => {
      if (error.code === 'auth/invalid-phone-number') {
        sendResponse(
          conn,
          code.badRequest,
          'Invalid phone number found in the request body.'
        );

        return;
      }

      if (error.code === 'auth/phone-number-already-exists') {
        sendResponse(
          conn,
          code.conflict,
          `${conn.req.body.phoneNumber} is already in use.`
        );

        return;
      }

      handleError(conn, error);
    });
};
