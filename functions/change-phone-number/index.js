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

const { db, rootCollections } = require('../admin/admin');
const {
  handleError,
  sendResponse,
  isE164PhoneNumber,
} = require('../admin/utils');
const { httpsActions, subcollectionNames } = require('../admin/constants');
const { code } = require('../admin/responses');
const admin = require('firebase-admin');

const validator = body => {
  if (!body.hasOwnProperty('newPhoneNumber')) {
    return `Missing the field 'newPhoneNumber' from the request body.`;
  }

  if (!isE164PhoneNumber(body.newPhoneNumber)) {
    return `Invalid phone number: '${body.newPhoneNumber}'`;
  }

  return null;
};

const populateActivities = async (oldPhoneNumber, newPhoneNumber) => {
  const updateActivities = async (query, resolve, reject) => {
    const batch = db.batch();
    const snap = await query.get();

    console.log('docs', snap.size);

    if (snap.empty) {
      return resolve();
    }

    snap.forEach(doc => {
      const activityOld = doc.data();
      // replace old phone number in activities
      // creator, creator.phoneNumber
      if (doc.get('template') === 'check-in') {
        batch.delete(doc.ref);

        return;
      }

      const data = Object.assign({}, doc.data(), {
        addendumDocRef: null,
        timestamp: Date.now(),
      });

      const attachment = doc.get('attachment');

      console.log('Activity:', doc.ref.path);

      const creator = (() => {
        if (typeof doc.get('creator') === 'string') {
          return {
            displayName: '',
            photoURL: '',
            phoneNumber: doc.get('creator'),
          };
        }

        return doc.get('creator');
      })();

      if (creator.phoneNumber === oldPhoneNumber) {
        data.creator = Object.assign({}, creator, {
          phoneNumber: newPhoneNumber,
        });
      }

      const fields = Object.keys(attachment);

      fields.forEach(field => {
        const { value, type } = attachment[field];

        if (type !== 'phoneNumber') {
          return;
        }

        if (value === oldPhoneNumber) {
          data.attachment[field].value = newPhoneNumber;
        }
      });

      const ref = rootCollections.activities.doc(doc.id);

      if (
        data.template === 'employee' &&
        data.attachment['Phone Number'] &&
        data.attachment['Phone Number'].value === oldPhoneNumber
      ) {
        const { officeId } = data;

        const ref = rootCollections.offices
          .doc(officeId)
          .collection(subcollectionNames.ADDENDUM)
          .doc();

        data.addendumDocRef = ref;

        batch.set(ref, {
          activityOld,
          oldPhoneNumber,
          newPhoneNumber,
          activityData: data,
          timestamp: Date.now(),
          action: httpsActions.update,
          user: newPhoneNumber,
          activityId: doc.id,
          userDeviceTimestamp: Date.now(),
          template: data.template,
          isSupportRequest: false,
          isAdminRequest: false,
          geopointAccuracy: null,
          provider: null,
          userDisplayName: '',
          location: null,
        });
      }

      delete data.customerObject;
      delete data.canEdit;
      delete data.activityId;
      delete data.assignees;

      batch.set(ref, Object.assign({}, data), { merge: true });
      batch.delete(
        ref.collection(subcollectionNames.ASSIGNEES).doc(oldPhoneNumber),
      );
      batch.set(
        ref.collection(subcollectionNames.ASSIGNEES).doc(newPhoneNumber),
        { addToInclude: data.template === 'subscription' },
      );
    });

    await batch.commit();

    const lastDoc = snap.docs[snap.size - 1];

    if (!lastDoc) {
      return resolve();
    }

    process.nextTick(() => {
      const newQuery = query.startAfter(lastDoc.id);

      return updateActivities(newQuery, resolve, reject);
    });
  };

  const promiseExecutor = (resolve, reject) => {
    const query = rootCollections.profiles
      .doc(oldPhoneNumber)
      .collection(subcollectionNames.ACTIVITIES)
      .orderBy('__name__')
      .limit(100);

    return updateActivities(query, resolve, reject);
  };

  return new Promise(promiseExecutor);
};

module.exports = async conn => {
  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  const { uid, phoneNumber } = conn.requester;

  try {
    return Promise.all([
      /**
       * Disabling user until all the activity
       * onWrite instances have triggered.
       */
      admin.auth().updateUser(uid, { disabled: true }),
      populateActivities(phoneNumber, conn.req.body.newPhoneNumber),
      rootCollections.updates
        .doc(uid)
        .set({ phoneNumber: conn.req.body.newPhoneNumber }, { merge: true }),
    ]);
  } catch (error) {
    return handleError(conn, error);
  } finally {
    await admin.auth().updateUser(uid, { disabled: false });

    sendResponse(conn, code.accepted, 'Phone Number change is in progress.');
  }
};
