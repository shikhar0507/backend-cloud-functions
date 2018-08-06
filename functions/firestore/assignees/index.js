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


const { db, rootCollections, } = require('../../admin/admin');


/**
 * Manages the assignees of the activity. Removes (onDelete)
 * or adds(onCreate, onUpdate) the activity do to the
 * assignee's profile depending on the event type.
 *
 * @param {Object} change Contains the old and the new doc.
 * @param {Object} context Data related to the `onWrite` event.
 * @returns {Promise<Object>} Firestore batch.
 */
module.exports = (change, context) => {
  const assigneeDoc = change.after.exists ? change.after : null;
  const activityId = context.params.activityId;
  const phoneNumber = context.params.phoneNumber;
  const userProfile = rootCollections.profiles.doc(phoneNumber);
  const batch = db.batch();

  /**
   * A user has been `unassigned` from the activity.
   * Remove the activity doc from their profile.
   * The doc was `deleted`.
   */
  if (!assigneeDoc) {
    batch.delete(userProfile
      .collection('Activities')
      .doc(activityId)
    );

    return batch
      .commit()
      .catch(console.error);
  }

  /**
   * A new user has been assigned to this activity.
   * Add the doc with the `id`, `canEdit` and `timestamp`
   * to their `Profile`.
   */
  return userProfile
    .get()
    .then((doc) => {
      if (!doc.exists) {
        /**
         * Profile doesn't exist. Create a placeholder profile
         * doc. Doing this to avoid abandoned docs in the
         * `Profiles` sub-collections.
         */
        batch.set(userProfile, { uid: null, });
      }

      batch.set(userProfile
        .collection('Activities')
        .doc(activityId), {
          canEdit: assigneeDoc.get('canEdit'),
          timestamp: assigneeDoc.createTime,
        });

      return batch.commit();
    })
    .catch(console.error);
};
