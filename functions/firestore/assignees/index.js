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


const { rootCollections } = require('../../admin/admin');

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
module.exports = async (doc, context) => {
  const {
    phoneNumber,
    activityId,
  } = context.params;

  const profileRef = rootCollections
    .profiles
    .doc(phoneNumber);
  const promises = [
    profileRef
      .get(),
    rootCollections
      .activities
      .doc(activityId)
      .get(),
    profileRef
      .collection('Activities')
      .doc(activityId)
      .delete(),
  ];

  try {
    const [profileDoc, activityDoc] = await Promise.all(promises);

    const timestamp = Date.now();
    const uid = profileDoc.get('uid');

    if (!uid
      || activityDoc.get('hidden') === 1) {
      return Promise.resolve();
    }

    const addendumRef = rootCollections
      .updates
      .doc(uid)
      .collection('Addendum')
      .doc();

    return addendumRef
      .set({
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
  } catch (error) {
    console.error(error);
  }
};
