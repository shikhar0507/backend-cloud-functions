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
const { httpsActions, vowels, } = require('../../admin/constants');


const getUpdatedScheduleNames = (requestBody, schedule) => {
  let commentString = '';

  schedule.forEach((item, index) => {
    const name = item.name;
    let oldStartTime = requestBody.schedule[index].startTime;
    let oldEndTime = requestBody.schedule[index].endTime;
    let newStartTime = item.startTime;
    let newEndTime = item.endTime;

    if (oldEndTime !== '') {
      oldEndTime = new Date(oldEndTime).getTime();
    }

    if (oldStartTime !== '') {
      oldStartTime = new Date(oldStartTime).getTime();
    }

    if (newEndTime !== '') {
      newEndTime = new Date(newEndTime).getTime();
    }

    if (newStartTime !== '') {
      newStartTime = new Date(newStartTime).getTime();
    }

    if (oldEndTime === newEndTime) return;
    if (oldStartTime === newEndTime) return;

    const isFirstElement = index === 0;

    if (isFirstElement) {
      commentString += `${name}`;

      return;
    } else {
      commentString += `, `;
    }

    commentString += `${name}`;
  });

  return commentString;
};


const getUpdatedVenueDescriptors = (requestBody, venue) => {
  let commentString = '';

  venue.forEach((item, index) => {
    const venueDescriptor = item.venueDescriptor;
    const oldLocation = item.location;
    const oldAddress = item.address;
    const oldGeopoint = item.geopoint;
    let oldLongitude = '';
    let oldLatitude = '';

    if (oldGeopoint !== '') {
      oldLongitude = oldGeopoint._longitude;
      oldLatitude = oldGeopoint._latitude;
    }

    const newLocation = requestBody.venue[index].location;
    const newAddress = requestBody.venue[index].address;
    const newGeopoint = requestBody.venue[index].geopoint;
    let newLatitude = '';
    let newLongitude = '';

    if (newGeopoint !== '') {
      newLatitude = newGeopoint.latitude;
      newLongitude = newGeopoint.longitude;
    }

    if (oldLocation === newLocation) return;
    if (oldAddress === newAddress) return;
    if (oldLatitude === newLatitude) return;
    if (oldLongitude === newLongitude) return;

    const isFirstElement = index === 0;

    if (isFirstElement) {
      commentString += `${venueDescriptor}`;

      return;
    } else {
      commentString += `, `;
    }

    commentString += `${venueDescriptor}`;
  });

  return commentString;
};

const getUpdatedAttachmentFieldNames = (requestBody, attachment) => {
  let commentString = '';
  const newAttachment = requestBody.attachment;

  Object
    .keys(newAttachment)
    .forEach((field, index) => {
      const oldFieldValue = attachment[field].value;
      const newFieldValue = newAttachment[field].value;
      const isUpdated = oldFieldValue !== newFieldValue;

      if (!isUpdated) return;

      const isFirstElement = index === 0;

      if (isFirstElement) {
        commentString += `${field}`;

        return;
      } else {
        commentString += `, `;
      }

      commentString += `${field}`;
    });

  return commentString;
};


const getUpdatedFieldNames = (updatedFields) => {
  const { requestBody, activityBody, } = updatedFields;

  const schedule = activityBody.schedule;
  const venue = activityBody.venue;
  const attachment = activityBody.attachment;
  let finalComment = '';

  const updatedNames = getUpdatedScheduleNames(requestBody, schedule);
  const updatedDescriptors = getUpdatedVenueDescriptors(requestBody, venue);
  const updatedFieldsInAttachment =
    getUpdatedAttachmentFieldNames(requestBody, attachment);

  if (updatedNames) {
    finalComment += updatedNames;
  }

  if (updatedDescriptors) {
    if (finalComment === '') {
      finalComment += `${updatedDescriptors}`;
    } else {
      finalComment += `, ${updatedDescriptors}`;
    }
  }

  if (updatedFieldsInAttachment) {
    if (finalComment === '') {
      finalComment += `${updatedFieldsInAttachment}`;
    } else {
      finalComment += `, ${updatedFieldsInAttachment}`;
    }
  }

  return finalComment;
};


const commentBuilder = (addendum, recipient) => {
  const addendumCreator = addendum.get('user');
  const action = addendum.get('action');
  const isSupportRequest = addendum.get('isSupportRequest');

  /**
   * People are denoted with their phone numbers unless
   * the person creating the addendum is the same as the one
   * receiving it.
   */
  let pronoun;

  /**
   * With support requests, the person creating that
   * request never gets added to the assignees of the activity.
   *
   * Because of this, the `isSame` variable never gets `true`.
   */
  if (isSupportRequest) {
    pronoun = addendumCreator;
  } else if (addendumCreator === recipient) {
    pronoun = 'You';
  } else {
    pronoun = addendumCreator;
  }

  if (action === httpsActions.create) {
    const template = addendum.get('template');
    const templateNameFirstCharacter = template[0];
    const article = vowels.has(templateNameFirstCharacter) ? 'an' : 'a';

    return `${pronoun} created ${article} ${template}.`;
  }

  if (action === httpsActions.changeStatus) {
    const activityName = addendum.get('activityName');
    const status = addendum.get('status');
    let displayStatus = status;

    /** `PENDING` isn't grammatically correct with the comment here. */
    if (status === 'PENDING') displayStatus = 'reversed';

    return `${pronoun} ${displayStatus.toLowerCase()} ${activityName}.`;
  }

  if (action === httpsActions.remove) {
    const remove = addendum.get('remove');

    return `${pronoun} removed ${remove}.`;
  }

  if (action === httpsActions.updatePhoneNumber) {
    const updatedPhoneNumber = addendum.get('updatedPhoneNumber');
    let pronoun = `${addendumCreator} changed their`;

    if (addendumCreator === recipient) pronoun = 'You changed your';

    return `${pronoun} phone number from ${addendumCreator} to`
      + ` ${updatedPhoneNumber}.`;
  }

  if (action === httpsActions.share) {
    const share = addendum.get('share');
    let str = `${pronoun} added`;

    if (share.length === 1) return `${str} ${share[0]}`;

    /** The `share` array will never have the `user` themselves */
    share.forEach((phoneNumber, index) => {
      if (recipient === phoneNumber) phoneNumber = 'you';

      /**
       * Creates a string to show to the user
       * `${ph1} added ${ph2}, ${ph3}, & ${ph4}`
       */
      if (index === share.length - 1) {
        str += ` & ${phoneNumber}`;

        return;
      } else {
        str += `, `;
      }

      str += `${phoneNumber}`;
    });
  }

  if (action === httpsActions.update) {
    const updatedFields = addendum.get('updatedFields');

    return `${pronoun} updated ${getUpdatedFieldNames(updatedFields)}.`;
  }

  /** Action is `comment` */
  return addendum.get('comment');
};


/**
 * Copies the addendum doc to the path `Updates/(uid)/Addendum/(auto-id)`
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
         * system in from other than `auth`. Like `creating/sharing`
         * an activity.
        */
        if (!uid) return;

        const profileAddendumDocRef = rootCollections
          .updates
          .doc(uid)
          .collection('Addendum')
          .doc();

        batch.set(profileAddendumDocRef, {
          activityId: addendumDoc.get('activityId'),
          timestamp: addendumDoc.get('timestamp'),
          userDeviceTimestamp: addendumDoc.get('userDeviceTimestamp'),
          location: addendumDoc.get('location'),
          user: addendumDoc.get('user'),
          /**
           * The `.id` property returns the phone number of the person who will
           * see this comment.
           */
          comment: commentBuilder(addendumDoc, profile.id),
        });
      });

      return batch.commit();
    })
    .catch(console.error);
