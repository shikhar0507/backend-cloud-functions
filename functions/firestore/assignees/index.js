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
  subcollectionNames
} = require('../../admin/constants');
const {
  rootCollections,
  db
} = require('../../admin/admin');
const admin = require('firebase-admin');

const getChildDoc = async ({
  template,
  phoneNumber,
  report,
  officeId,
  activityId
}) => {
  if (template === 'subscription') {
    return rootCollections
      .profiles
      .doc(phoneNumber)
      .collection(subcollectionNames.SUBSCRIPTIONS)
      .doc(activityId)
      .get();
  }

  if (template === 'recipient') {
    const [recipientDoc] = (
      await rootCollections
      .recipients
      .where('report', '==', report)
      .where('officeId', '==', officeId)
      .limit(1)
      .get()
    ).docs;

    return recipientDoc;
  }

  return null;
};

const getSubcriptionActivityQuery = ({
  officeId,
  phoneNumber,
  template
}) => {
  return rootCollections
    .activities
    .where('officeId', '==', officeId)
    .where('template', '==', 'subscription')
    .where('attachment.Phone Number.value', '==', phoneNumber)
    .where('attachment.Template.value', '==', template)
    .limit(1)
    .get();
};


/**
 * Removes the doc from the `Profile/(phoneNumber)/Activities/(activityId)`
 * of the assignee who has been unassigned from this activity.
 *
 * When someone is unassigned from an activity, they will no longer see any
 * further updates from the activity on hitting
 * the `/api/read?from=unix timestamp`
 *
 * @Trigger: `onDelete`
 * @Path: `Activities/(activityId)/Assignees/(doc)`
 *
 * @param {Object} doc Contains the Profile doc of the removed assignee.
 * @param {Object} context Data related to the `onDelete` event.
 * @returns {Promise <Object>} Firestore `Batch` object.
 */
const assigneeOnDelete = async ({
  phoneNumber,
  activityId
}) => {
  const profileRef = rootCollections.profiles.doc(phoneNumber);
  const timestamp = Date.now();
  const batch = db.batch();

  const [profileDoc, activityDoc] = await db
    .getAll(profileRef, rootCollections.activities.doc(activityId));
  const {
    uid
  } = profileDoc.data();
  const {
    hidden,
    template,
    officeId
  } = activityDoc.data();

  console.log({
    phoneNumber,
    activityId,
    template,
    uid,
    hidden,
  });

  /**
   * Delete Activity from profile
   */
  batch.delete(profileRef.collection(subcollectionNames.ACTIVITIES).doc(activityId));

  if (uid && hidden !== 1) {
    batch.set(
      rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), {
        timestamp,
        activityId,
        isComment: 0,
        location: {
          _latitude: '',
          _longitude: '',
        },
        userDeviceTimestamp: timestamp,
        user: phoneNumber,
        unassign: true,
        comment: '',
      });
  }

  /**
   * In case for subscriptino/recipient, we have to remove the phone number from
   * the `include` array in the respective docs.
   */
  const doc = await getChildDoc({
    activityId,
    template,
    phoneNumber,
    officeId,
    report: activityDoc.get('attachment.Name.value'),
  });

  /**
   * This doc might not exist.
   * Eg. In case of recipient, if the activity status is CANCELLED
   * the doc in Recipients/{activityId} will not exist.
   */
  if (doc) {
    console.log('childDoc', doc);

    batch.set(doc.ref, Object.assign({}, doc.data(), {
      include: admin.firestore.FieldValue.arrayRemove(phoneNumber),
    }), {
      merge: true,
    });
  }

  if (template === 'subscription') {
    // fetch leave, check-in, attendance regularization subscription
    // of the user (attachment.Phone Number.value)
    // unassign the number phoneNumber from those activities
    const {
      value: subscribersPhoneNumber,
    } = activityDoc.get('attachment.Phone Number');

    const [checkInSub, leaveSub, arSub] = await Promise.all([
      getSubcriptionActivityQuery({
        officeId,
        phoneNumber: subscribersPhoneNumber,
        template: 'check-in',
      }),
      getSubcriptionActivityQuery({
        officeId,
        phoneNumber: subscribersPhoneNumber,
        template: 'leave',
      }),
      getSubcriptionActivityQuery({
        officeId,
        phoneNumber: subscribersPhoneNumber,
        template: 'attendance regularization',
      }),
    ]);

    const [checkInSubActivity] = checkInSub.docs;
    const [leaveSubActivity] = leaveSub.docs;
    const [arSubActivity] = arSub.docs;

    const update = {
      addendumDocRef: null,
      timestamp: Date.now(),
    };
    const merge = {
      merge: true
    };

    if (checkInSubActivity) {
      console.log('deleting from check-in', checkInSubActivity.id);

      batch.set(checkInSubActivity.ref, update, merge);

      batch.delete(
        checkInSubActivity.ref.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber)
      );
    }

    if (leaveSubActivity) {
      console.log('deleting from leave', leaveSubActivity.id);
      batch.set(leaveSubActivity.ref, update, merge);

      batch.delete(
        leaveSubActivity.ref.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber)
      );
    }

    if (arSubActivity) {
      console.log('deleting from ar', arSubActivity.id);
      batch.set(arSubActivity.ref, update, merge);

      batch.delete(
        arSubActivity.ref.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber)
      );
    }
  }

  return batch.commit();
};

module.exports = async (_, context) => {
  try {
    return assigneeOnDelete(context.params);
  } catch (error) {
    console.error(error);
  }
};
