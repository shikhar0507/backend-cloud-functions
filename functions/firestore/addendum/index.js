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


const { rootCollections, db, } = require('../../admin/admin');

const getComment = (addendumDoc, profile) => {
  const user = addendumDoc.get('user');
  const share = addendumDoc.get('share');
  const remove = addendumDoc.get('remove');
  const action = addendumDoc.get('action');
  const status = addendumDoc.get('status');
  const comment = addendumDoc.get('comment');
  const template = addendumDoc.get('template');
  const activityName = addendumDoc.get('activityName');
  const updatedFields = addendumDoc.get('updatedFields');
  const updatedPhoneNumber = addendumDoc.get('updatedPhoneNumber');

  const profilePhoneNumber = profile.id;
  const isSame = user === profilePhoneNumber;

  let pronoun = profilePhoneNumber;

  if (isSame) pronoun = 'You';

  if (action === 'create') {
    return `${pronoun} created ${template}.`;
  }

  if (action === 'change-status') {
    let displayStatus = status;

    if (status === 'PENDING') {
      displayStatus = 'reversed';
    }

    return `${pronoun} ${displayStatus} ${activityName}.`;
  }


  if (action === 'remove') {
    return `${pronoun} removed ${remove}.`;
  }

  if (action === 'phone-number-update') {
    pronoun = `${user} changed their`;

    if (isSame) {
      pronoun = 'You changed your';
    }

    return `${pronoun} phone number from ${user} to ${updatedPhoneNumber}.`;
  }

  if (action === 'share') {
    if (share.length === 1) {
      // [ph1]
      // You added ${ph1}.
      return `${pronoun} added ${share[0]}.`;
    }

    let str = `${pronoun}`;

    share.forEach((phoneNumber, index) => {
      // [ph1, ph2, ph3]
      // You added ${ph1}, ${ph2} & ${ph3}.
      if (index !== share.length - 1) {
        str += ` added ${phoneNumber}, `;
      } else {
        str += ` & ${phoneNumber}`;
      }
    });

    return `${pronoun} added ${str}`;
  }

  if (action === 'update') {
    return `${pronoun} updated ${updatedFields}.`;
  }

  /** Action is `comment` */
  return comment;
};


/**
 * Copies the addendum doc to the path `Updates/(uid)/Addendum(auto-id)`
 * for the activity assignees who have auth.
 *
 * @param {Object} addendumDoc Firebase doc Object.
 * @returns {Promise <Object>} A `batch` object.
 */
module.exports = (addendumDoc) =>
  rootCollections
    .activities
    .doc(addendumDoc.get('activityId'))
    .collection('Assignees')
    .get()
    .then((assignees) => {
      const promises = [];

      /** The doc.id is the phone number of the assignee. */
      assignees.forEach((doc) => promises
        .push(rootCollections.profiles.doc(doc.id).get()));

      return Promise.all(promises);
    })
    .then((profiles) => {
      const batch = db.batch();

      profiles.forEach((profile) => {
        /**
         * An assignee (phone number) who's doc is added
         * to the promises array above, may not have auth.
         */
        if (!profile.exists) return;

        const uid = profile.get('uid');

        /**
         * No `uid` means that the user has not signed up
         * for the app. Not writing addendum for those users.
         * The `uid` field can be `null` too. This is for the
         * cases when the phone number was introduced to the
         * system in from other than `auth`. Like creating/sharing
         * an activity.
        */
        if (!uid) return;

        const profileAddendumDocRef = rootCollections
          .updates
          .doc(uid)
          .collection('Addendum')
          .doc();

        batch.set(profileAddendumDocRef, {
          addendumId: addendumDoc.id,
          activityId: addendumDoc.get('activityId'),
          timestamp: addendumDoc.get('userDeviceTimestamp'),
          location: addendumDoc.get('location'),
          user: addendumDoc.get('user'),
          comment: getComment(addendumDoc, profile),
        });
      });

      return batch.commit();
    })
    .catch(console.error);
