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
  deleteField,
  rootCollections,
  serverTimestamp,
} = require('../../admin/admin');
const {
  httpsActions,
  vowels,
} = require('../../admin/constants');


const setAdminCustomClaims = (locals, batch) => {
  const activityDocNew = locals.change.after;
  const status = activityDocNew.get('status');
  const phoneNumber = activityDocNew.get('attachment.Admin.value');

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
          /**
           * If this office is already present in the user's custom claims,
           * there's no need to add it again.
           * This fixes the case of duplication in the `offices` array in the
           * custom claims.
           */
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

  batch.set(rootCollections
    .reports
    .doc(activityId), {
      cc: 'help@growthfile.com',
      office: activityDocNew.get('office'),
      include: locals.assigneePhoneNumbersArray,
      timestamp: serverTimestamp,
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
  const updatedFields = [];

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

    updatedFields.push(name);
  });

  return updatedFields;
};


const getUpdatedVenueDescriptors = (requestBody, oldVenue) => {
  const updatedFields = [];

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

    updatedFields.push(venueDescriptor);
  });

  return updatedFields;
};

const getUpdatedAttachmentFieldNames = (requestBody, oldAttachment) => {
  const updatedFields = [];
  const newAttachment = requestBody.attachment;

  Object
    .keys(newAttachment)
    .forEach((field) => {
      const oldFieldValue = oldAttachment[field].value;
      const newFieldValue = newAttachment[field].value;
      const isUpdated = oldFieldValue !== newFieldValue;

      if (!isUpdated) return;

      updatedFields.push(field);
    });

  return updatedFields;
};


const getUpdatedFieldNames = (eventData) => {
  const { requestBody, activityBody, } = eventData;

  const oldSchedule = activityBody.schedule;
  const oldVenue = activityBody.venue;
  const oldAttachment = activityBody.attachment;

  const allFields = [
    ...getUpdatedScheduleNames(requestBody, oldSchedule),
    ...getUpdatedVenueDescriptors(requestBody, oldVenue),
    ...getUpdatedAttachmentFieldNames(requestBody, oldAttachment),
  ];

  let commentString = '';

  if (allFields.length === 1) return commentString += `${allFields[0]}`;

  allFields
    .forEach((field, index) => {
      const isLastField = index === allFields.length - 1;

      if (isLastField) {
        commentString += `& ${field}`;

        return;
      }

      commentString += `${field}, `;
    });

  return commentString;
};


const getPronoun = (locals, recipient) => {
  const addendumCreator = locals.addendum.get('user');
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

const getCreationActionComment = (template, pronoun) => {
  const templateNameFirstCharacter = template[0];
  const article = vowels.has(templateNameFirstCharacter) ? 'an' : 'a';

  return `${pronoun} created ${article} ${template}`;
};

const getChangeStatusComment = (status, activityName, pronoun) => {
  /** `PENDING` isn't grammatically correct with the comment here. */
  if (status === 'PENDING') status = 'reversed';

  return `${pronoun} ${status.toLowerCase()} ${activityName}.`;
};


const getCommentString = (locals, recipient) => {
  const addendumCreator = locals.addendum.get('user');
  const action = locals.addendum.get('action');
  const pronoun = getPronoun(locals, recipient);

  if (action === httpsActions.create) {
    const template = locals.addendum.get('template');

    return getCreationActionComment(template, pronoun);
  }

  if (action === httpsActions.changeStatus) {
    const activityName = locals.addendum.get('activityName');
    const status = locals.addendum.get('status');

    return getChangeStatusComment(status, activityName, pronoun);
  }

  if (action === httpsActions.share) {
    const share = locals.addendum.get('share');
    let str = `${pronoun} added`;

    if (share.length === 1) {
      const name = locals.authMap.get(share[0]).displayName || share[0];

      return str += ` ${name}`;
    }

    /** The `share` array will never have the `user` themselves */
    share.forEach((phoneNumber, index) => {
      const name = locals.authMap.get(phoneNumber).displayName || phoneNumber;
      const isLastItem = share.length - 1 === index;
      /**
       * Creates a string to show to the user
       * `${ph1} added ${ph2}, ${ph3}, & ${ph4}`
       */
      if (isLastItem) {
        str += ` & ${name}`;

        return;
      }

      str += ` ${name}, `;
    });

    return str;
  }

  if (action === httpsActions.update) {
    const eventData = locals.addendum.get('updatedFields');

    return `${pronoun} updated ${getUpdatedFieldNames(eventData)}.`;
  }

  if (action === httpsActions.updatePhoneNumber) {
    const updatedPhoneNumber = locals.addendum.get('updatedPhoneNumber');
    let pronoun = `${addendumCreator} changed their`;

    if (addendumCreator === recipient) pronoun = 'You changed your';

    return `${pronoun} phone number from ${addendumCreator} to`
      + ` ${updatedPhoneNumber}.`;
  }

  /** Action is `comment` */
  return locals.addendum.get('comment');
};


/**
 * Checks if the action was a comment.
 * @param {string} action Can be one of the activity actions from HTTPS functions.
 * @returns {number} 0 | 1 depending on whether the action was a comment or anything else.
 */
const isComment = (action) => {
  if (action === httpsActions.comment) return 1;

  return 0;
};

const addOfficeToProfile = (locals, batch) => {
  const phoneNumber = locals.change.after.get('attachment.Employee Contact.value');
  const officeId = locals.change.after.get('officeId');
  const officeName = locals.change.after.get('office');
  const status = locals.change.after.get('status');

  const employeeOf = {
    [officeName]: officeId,
  };

  if (status === 'CANCELLED') {
    employeeOf[officeName] = deleteField();
  }

  batch.set(rootCollections
    .profiles
    .doc(phoneNumber), {
      employeeOf,
    }, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};


module.exports = (change, context) => {
  if (!change.after) {
    /** For debugging only... */
    console.log('Activity was deleted...');

    return Promise.resolve();
  }

  const addendumRef = change.after.get('addendumDocRef');
  const activityId = context.params.activityId;

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
      console.log('action:', addendum.get('action'));

      locals.assigneesSnapShot = assigneesSnapShot;
      locals.addendum = addendum;

      const authFetchPromises = [];
      locals.addendumCreator.phoneNumber = locals.addendum.get('user');

      locals.assigneesSnapShot.forEach((doc) => {
        authFetchPromises
          .push(users.getUserByPhoneNumber(doc.id));

        locals.assigneesMap.set(doc.id, {
          canEdit: doc.get('canEdit'),
          addToInclude: doc.get('addToInclude'),
        });

        locals.assigneePhoneNumbersArray.push(doc.id);

        if (doc.id === locals.addendumCreator.phoneNumber) {
          locals.addendumCreatorInAssignees = true;
        }
      });

      if (!locals.addendumCreatorInAssignees) {
        authFetchPromises
          .push(users.getUserByPhoneNumber(locals.addendumCreator.phoneNumber));
      }

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
        activityData.timestamp = serverTimestamp;

        batch.set(profileRef
          .collection('Activities')
          .doc(activityId),
          activityData
        );
      });

      return batch;
    })
    .then((batch) => {
      /**
       * Skipping comment creation for the case when the activity
       * is not visible in the front-end.
       */
      if (change.after.get('hidden') === 1) return batch;

      locals
        .assigneePhoneNumbersArray
        .forEach((phoneNumber) => {
          /** Without `uid` the doc in `Updates/(uid)` will not exist. */
          if (!locals.assigneesMap.get(phoneNumber).uid) return;

          const comment = getCommentString(locals, phoneNumber);

          console.log({
            phoneNumber,
            comment,
          });

          batch.set(rootCollections
            .updates
            .doc(locals.assigneesMap.get(phoneNumber).uid)
            .collection('Addendum')
            .doc(), {
              activityId,
              comment,
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

      console.log({ activityId, template, locals, });

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

      if (template === 'employee') {
        return addOfficeToProfile(locals, batch);
      }

      return batch
        .commit();
    })
    .catch(console.error);
};
