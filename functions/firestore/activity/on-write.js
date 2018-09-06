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


const { db,
  users,
  rootCollections,
  serverTimestamp,
} = require('../../admin/admin');
const { httpsActions, vowels, } = require('../../admin/constants');


const setAdminCustomClaims = (locals, batch) => {
  const activityDocNew = locals.change.after;
  const status = activityDocNew.get('status');
  const phoneNumber = activityDocNew.get('attachment').Admin.value;

  return users
    .getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      const phoneNumber = Object.keys(userRecord)[0];
      const record = userRecord[phoneNumber];
      const uid = record.uid;
      const customClaims = record.customClaims;
      const office = activityDocNew.get('office');
      let newClaims = {
        admin: [office,],
      };

      /**
       * The `statusOnCreate` for `admin` template is `CONFIRMED`.
       * This block should not run when the activity has been
       * created by someone.
       * In the case of `/change-status` however, chances are
       * that the status becomes `CANCELLED`.
       *
       * When that happens, the name of the office from
       * the `admin` array is removed from the `customClaims.admin`
       * of the admin user.
       */
      if (status === 'CANCELLED') {
        const index = customClaims.admin.indexOf(office);

        if (index > -1) {
          customClaims.admin.splice(index, 1);
          newClaims = customClaims;
        }

      } else {
        /**
         * The user already is `admin` of another office.
         * Preserving their older permission for that case..
         */
        if (customClaims && customClaims.admin) {
          if (customClaims.admin.indexOf(office) === -1) {
            customClaims.admin.push(office);
            newClaims = customClaims;
          }
        }
      }

      return Promise
        .all([
          users
            .setCustomUserClaims(uid, newClaims),
          batch
            .commit(),
        ]);
    })
    .catch(console.error);
};

const handleReport = (locals, batch) => {
  const activityDocNew = locals.change.after.activityDocNew;
  const activityId = activityDocNew.id;
  const template = activityDocNew.get('template');

  const collectionName = `${template} Mailing List`;

  batch.set(db
    .collection(collectionName)
    .doc(activityId), {
      cc: 'help@growthfile.com',
      office: activityDocNew.get('office'),
      include: locals.assigneePhoneNumbersArray,
    });

  return batch
    .commit()
    .catch(console.error);
};

const addSubscriptionToUserProfile = (locals, batch) => {
  const activityDocNew = locals.change.after;

  const subscriberPhoneNumber =
    activityDocNew.get('attachment.Subscriber.value');
  const templateName = activityDocNew.get('attachment.Template.value');

  return rootCollections
    .activityTemplates
    .where('name', '==', templateName)
    .limit(1)
    .get()
    .then((docs) => {
      const doc = docs.docs[0];
      const include = [];

      locals.assigneePhoneNumbersArray.forEach((phoneNumber) => {
        const addToInclude = locals.assigneesMap.get(phoneNumber).addToInclude;

        /** The user's own phone number is redundant in the include array. */
        if (subscriberPhoneNumber === phoneNumber) return;

        /**
         * For the subscription template, people from
         * the share array are not added to the include array.
         */
        if (!addToInclude) return;

        include.push(phoneNumber);
      });

      batch.set(rootCollections
        .profiles
        .doc(subscriberPhoneNumber)
        .collection('Subscriptions')
        .doc(activityDocNew.id), {
          include,
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          template: doc.get('name'),
          attachment: doc.get('attachment'),
          timestamp: activityDocNew.get('timestamp'),
          office: activityDocNew.get('office'),
          status: activityDocNew.get('status'),
          canEditRule: doc.get('canEditRule'),
          hidden: doc.get('hidden'),
          statusOnCreate: doc.get('statusOnCreate'),
        });

      return batch
        .commit();
    })
    .catch(console.error);
};


const getUpdatedScheduleNames = (requestBody, oldSchedule) => {
  let commentString = '';

  oldSchedule.forEach((item, index) => {
    const name = item.name;
    /** Request body ===> Update API request body. */
    let newStartTime = requestBody.schedule[index].startTime;
    let newEndTime = requestBody.schedule[index].endTime;
    let oldStartTime = item.startTime;
    let oldEndTime = item.endTime;

    /**
     * Values not equal to an empty string are `Date` objects.
     * Firestore stores the `Date` as a custom object with two properties
     * `seconds` and `nanoseconds`.
     * To get an actual JS `Date` object, we use the `toDate()` method
     * on Firestore custom object.
     */
    if (newEndTime !== '') {
      newEndTime = new Date(newEndTime).getTime();
    }

    if (newStartTime !== '') {
      newStartTime = new Date(newStartTime).getTime();
    }

    if (oldEndTime !== '') {
      oldEndTime = oldEndTime.toDate().getTime();
    }

    if (oldStartTime !== '') {
      oldStartTime = oldStartTime.toDate().getTime();
    }

    if (newEndTime === oldEndTime
      && newStartTime === oldStartTime) return;

    if (index === 0) {
      commentString += `${name}`;

      return;
    } else {
      commentString += `, `;
    }

    commentString += `${name}`;
  });

  return commentString;
};


const getUpdatedVenueDescriptors = (requestBody, oldVenue) => {
  let commentString = '';

  oldVenue.forEach((item, index) => {
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

    if (oldLocation === newLocation
      && oldAddress === newAddress
      && oldLatitude === newLatitude
      && oldLongitude === newLongitude) return;

    if (index === 0) {
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

  const oldSchedule = activityBody.schedule;
  const oldVenue = activityBody.venue;
  const attachment = activityBody.attachment;

  const updatedNames = getUpdatedScheduleNames(requestBody, oldSchedule);
  const updatedDescriptors = getUpdatedVenueDescriptors(requestBody, oldVenue);
  const updatedFieldsInAttachment =
    getUpdatedAttachmentFieldNames(requestBody, attachment);

  let finalComment = '';

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

const getPronoun = (locals, recipient) => {
  const addendum = locals.addendum;
  const addendumCreator = addendum.get('user');
  const assigneesMap = locals.assigneesMap;
  /**
     * People are denoted with their phone numbers unless
     * the person creating the addendum is the same as the one
     * receiving it.
     */
  let pronoun = addendumCreator;

  if (addendumCreator === recipient) {
    pronoun = 'You';
  }

  if (pronoun !== 'You'
    && assigneesMap.get(addendumCreator)
    && assigneesMap.get(addendumCreator).displayName) {
    pronoun = assigneesMap.get(addendumCreator).displayName;
  }

  if (!assigneesMap.get(addendumCreator)
    && !locals.addendumCreatorInAssignees) {
    pronoun = locals.addendumCreator.displayName;
  }

  return pronoun;
};


const commentBuilder = (locals, recipient) => {
  const addendum = locals.addendum;
  const addendumCreator = addendum.get('user');
  const action = addendum.get('action');
  const pronoun = getPronoun(locals, recipient);

  if (action === httpsActions.create) {
    const template = addendum.get('template');

    const templateNameFirstCharacter = template[0];
    const article = vowels.has(templateNameFirstCharacter) ? 'an' : 'a';

    return `${pronoun} created ${article} ${template}`;
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


const isComment = (action) => {
  if (action === httpsActions.comment) return 1;

  return 0;
};


module.exports = (change, context) => {
  const addendumRef = change.after.get('addendumDocRef');
  const activityId = context.params.activityId;

  console.log({ activityId, });

  const batch = db.batch();

  const locals = {
    change,
    assigneesMap: new Map(),
    assigneePhoneNumbersArray: [],
    addendumCreator: {},
    addendumCreatorInAssignees: false,
  };

  return Promise
    .all([
      db
        .doc(addendumRef.path)
        .get(),
      rootCollections
        .activities
        .doc(activityId)
        .collection('Assignees')
        .get(),
    ])
    .then((docs) => {
      const [addendum, assigneesSnapShot,] = docs;

      locals.assigneesSnapShot = assigneesSnapShot;
      locals.addendum = addendum;

      const authFetchPromises = [];
      const addendumCreator = locals.addendum.get('user');
      locals.addendumCreator.phoneNumber = addendumCreator;

      locals.assigneesSnapShot.forEach((doc) => {
        authFetchPromises.push(users.getUserByPhoneNumber(doc.id));

        locals.assigneesMap.set(doc.id, {
          canEdit: doc.get('canEdit'),
          addToInclude: doc.get('addToInclude'),
        });

        locals.assigneePhoneNumbersArray.push(doc.id);

        if (doc.id === addendumCreator) {
          locals.addendumCreatorInAssignees = true;
        }
      });

      console.log('locals.assigneePhoneNumbersArray:', locals.assigneePhoneNumbersArray);

      if (!locals.addendumCreatorInAssignees) {
        authFetchPromises
          .push(users.getUserByPhoneNumber(addendumCreator));
      }

      console.log('locals.addendumCreatorInAssignees:', locals.addendumCreatorInAssignees);

      return Promise.all(authFetchPromises);
    })
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!locals.addendumCreatorInAssignees
          && phoneNumber === locals.addendumCreator.phoneNumber) {
          locals.addendumCreator.displayName = record.displayName;

          return;
        }

        locals.assigneesMap.get(phoneNumber).displayName = record.displayName;
        locals.assigneesMap.get(phoneNumber).uid = record.uid;

        const profileRef = rootCollections.profiles.doc(phoneNumber);

        if (!record.uid) {
          batch.set(profileRef, {
            uid: null,
          });
        }

        const activityData = locals.change.after.data();

        activityData.canEdit = locals.assigneesMap.get(phoneNumber).canEdit;
        activityData.assignees = locals.assigneePhoneNumbersArray;

        batch.set(profileRef
          .collection('Activities')
          .doc(activityId),
          activityData
        );
      });

      console.log('locals.assigneesMap:', locals.assigneesMap);

      return batch;
    })
    .then((batch) => {
      locals
        .assigneePhoneNumbersArray
        .forEach((phoneNumber) => {
          if (!locals.assigneesMap.get(phoneNumber).uid) return;

          batch.set(rootCollections
            .updates
            .doc(locals.assigneesMap.get(phoneNumber).uid)
            .collection('Addendum')
            .doc(), {
              activityId,
              comment: commentBuilder(locals, phoneNumber),
              isComment: isComment(locals.addendum.get('action')),
              timestamp: serverTimestamp,
              userDeviceTimestamp: locals.addendum.get('userDeviceTimestamp'),
              location: locals.addendum.get('location'),
              user: locals.addendum.get('user'),
            });
        });

      return batch;
    })
    .then((batch) => {
      const template = locals.change.after.get('template');

      console.log({ template, });

      let docRef = rootCollections
        .offices
        .doc(locals.change.after.get('officeId'))
        .collection('Activities')
        .doc(locals.change.after.id);

      if (template === 'office') {
        docRef = rootCollections
          .offices
          .doc(locals.change.after.id);
      }

      const activityData = locals.change.after.data();
      activityData.timestamp = serverTimestamp;

      batch.set(docRef, activityData);

      if (template === 'subscription') {
        return addSubscriptionToUserProfile(locals, batch);
      }

      if (template === 'report') {
        return handleReport(locals, batch);
      }

      if (template === 'admin') {
        return setAdminCustomClaims(locals, batch);
      }

      return batch
        .commit();
    })
    .catch(console.error);
};
