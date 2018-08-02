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
  db,
  users,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');


const activityChanged = (oldDocRef, newDocRef) => {
  let isSame = true;

  if (oldDocRef.get('title') !== newDocRef.get('title')) {
    isSame = false;
  }

  if (oldDocRef.get('status') !== newDocRef.get('status')) {
    isSame = false;
  }

  if (JSON.stringify(oldDocRef.get('schedule')) !== JSON.stringify(newDocRef.get('schedule'))) {
    isSame = false;
  }

  if (JSON.stringify(oldDocRef.get('venue')) !== JSON.stringify(newDocRef.get('venue'))) {
    isSame = false;
  }

  if (JSON.stringify(oldDocRef.get('attachment')) !== JSON.stringify(newDocRef.get('attachment'))) {
    isSame = false;
  }

  const timestampChanged = JSON.stringify(oldDocRef.get('timestamp')) !== JSON.stringify(newDocRef.get('timestamp'));

  return isSame && timestampChanged;
};



module.exports = (change, context) => {
  const activityDocNew = change.after;
  const activityId = context.params.activityId;
  const timestamp = activityDocNew.get('timestamp');
  const locals = {};

  return activityDocNew
    .ref
    .collection('Assignees')
    .get()
    .then((assigneeCollectionSnapshot) => {
      const promises = [];
      locals.assignees = {};

      assigneeCollectionSnapshot.forEach((assignee) => {
        const phoneNumber = assignee.id;

        const profileDoc = rootCollections.profiles.doc(phoneNumber);

        promises.push(profileDoc.get());

        locals.assignees[phoneNumber] = assignee.get('canEdit');
      });

      return promises;
    })
    .then((promises) => Promise.all(promises))
    .then((profileDocsSnapshot) => {
      const batch = db.batch();

      profileDocsSnapshot.forEach((profileDoc) => {
        const phoneNumber = profileDoc.id;

        if (!profileDoc.exists) {
          batch.set(profileDoc.ref, { uid: null, });
        }

        batch.set(profileDoc
          .ref
          .collection('Activities')
          .doc(activityId), {
            canEdit: locals.assignees[phoneNumber],
            timestamp,
          });
      });

      return batch.commit();
    })
    .catch(console.error);
};
