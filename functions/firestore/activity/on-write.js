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
  auth,
  users,
  deleteField,
  rootCollections,
  serverTimestamp,
} = require('../../admin/admin');
const {
  httpsActions,
  vowels,
} = require('../../admin/constants');


const getValuesFromAttachment = (activity) => {
  const object = {
    activityId: activity.id,
    createTime: activity.createTime,
  };

  const fields = Object.keys(activity.get('attachment'));

  fields.forEach((field) => object[field] = activity.get('attachment')[field].value);

  return object;
};


const setAdminCustomClaims = (locals, batch) =>
  auth
    .getUserByPhoneNumber(locals.change.after.get('attachment.Admin.value'))
    .then((userRecord) => {
      const customClaims = userRecord.customClaims;
      const office = locals.change.after.get('office');
      let newClaims = {
        admin: [
          office,
        ],
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
      const index = customClaims.admin.indexOf(office);

      if (locals.change.after.get('status') === 'CANCELLED'
        && index > -1) {
        customClaims.admin.splice(index, 1);
        newClaims = customClaims;
      } else if (customClaims
        && customClaims.admin
        && index === -1) {
        /**
         * The user already is `admin` of another office.
         * Preserving their older permission for that case..
         * If this office is already present in the user's custom claims,
         * there's no need to add it again.
         * This fixes the case of duplication in the `offices` array in the
         * custom claims.
         */
        customClaims.admin.push(office);
        newClaims = customClaims;
      }

      return Promise
        .all([
          auth
            .setCustomUserClaims(userRecord.uid, newClaims),
          batch
            .commit(),
        ]);
    })
    .catch((error) => JSON.stringify(error));


const handleReport = (locals, batch) => {
  if (locals.addendumDoc
    && locals.addendumDoc.get('action') !== httpsActions.comment) {
    batch.set(rootCollections
      .recipients
      .doc(locals.change.after.id), {
        cc: locals.change.after.get('attachment.cc.value'),
        office: locals.change.after.get('office'),
        include: locals.assigneePhoneNumbersArray,
        report: locals.change.after.get('attachment.Name.value'),
        officeId: locals.change.after.get('officeId'),
        status: locals.change.after.get('status'),
      }, {
        /**
         * Required since anyone updating the this activity will cause
         * the report data to be lost.
         */
        merge: true,
      });
  }

  return batch
    .commit()
    .catch(console.error);
};


const addSubscriptionToUserProfile = (locals, batch) =>
  rootCollections
    .activityTemplates
    .where('name', '==', locals.change.after.get('attachment.Template.value'))
    .limit(1)
    .get()
    .then((docs) => {
      const doc = docs.docs[0];
      const include = [];

      locals.assigneePhoneNumbersArray.forEach((phoneNumber) => {
        const addToInclude = locals.assigneesMap.get(phoneNumber).addToInclude;

        /** The user's own phone number is redundant in the include array. */
        if (locals.change.after.get('attachment.Subscriber.value') === phoneNumber) return;

        /**
         * For the subscription template, people from
         * the share array are not added to the include array.
         */
        if (!addToInclude) return;

        include.push(phoneNumber);
      });

      batch.set(rootCollections
        .profiles
        .doc(locals.change.after.get('attachment.Subscriber.value'))
        .collection('Subscriptions')
        .doc(locals.change.after.id), {
          include,
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          template: doc.get('name'),
          attachment: doc.get('attachment'),
          timestamp: locals.change.after.get('timestamp'),
          office: locals.change.after.get('office'),
          status: locals.change.after.get('status'),
          canEditRule: doc.get('canEditRule'),
          hidden: doc.get('hidden'),
          statusOnCreate: doc.get('statusOnCreate'),
        });

      return batch.commit();
    })
    .catch(console.error);


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

  oldVenue.forEach((venue, index) => {
    const venueDescriptor = venue.venueDescriptor;
    const oldLocation = venue.location;
    const oldAddress = venue.address;
    const oldGeopoint = venue.geopoint;
    const oldLongitude = oldGeopoint._longitude;
    const oldLatitude = oldGeopoint._latitude;
    const newLocation = requestBody.venue[index].location;
    const newAddress = requestBody.venue[index].address;
    const newGeopoint = requestBody.venue[index].geopoint;
    const newLatitude = newGeopoint.latitude;
    const newLongitude = newGeopoint.longitude;

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
      if (index === allFields.length - 1) {
        commentString += `& ${field}`;

        return;
      }

      commentString += `${field}, `;
    });

  return commentString;
};


const getPronoun = (locals, recipient) => {
  const addendumCreator = locals.addendumDoc.get('user');
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

const getCreateActionComment = (template, pronoun) => {
  const templateNameFirstCharacter = template[0];
  const article = vowels.has(templateNameFirstCharacter) ? 'an' : 'a';

  return `${pronoun} created ${article} ${template}`;
};

const getChangeStatusComment = (status, activityName, pronoun) => {
  /** `PENDING` isn't grammatically correct with the comment here. */
  if (status === 'PENDING') status = 'reversed';

  return `${pronoun} ${status.toLowerCase()} ${activityName}`;
};


const getCommentString = (locals, recipient) => {
  const action = locals.addendumDoc.get('action');
  const pronoun = getPronoun(locals, recipient);

  if (action === httpsActions.create) {
    const template = locals.addendumDoc.get('template');

    return getCreateActionComment(template, pronoun);
  }

  if (action === httpsActions.changeStatus) {
    const activityName = locals.addendumDoc.get('activityName');
    const status = locals.addendumDoc.get('status');

    return getChangeStatusComment(status, activityName, pronoun);
  }

  if (action === httpsActions.share) {
    const share = locals.addendumDoc.get('share');
    let str = `${pronoun} added`;

    if (share.length === 1) {
      const name = locals.assigneesMap.get(share[0]).displayName || share[0];

      return str += ` ${name}`;
    }

    /** The `share` array will never have the `user` themselves */
    share.forEach((phoneNumber, index) => {
      const name = locals
        .assigneesMap.get(phoneNumber).displayName || phoneNumber;

      if (share.length - 1 === index) {
        str += ` & ${name}`;

        return;
      }

      str += ` ${name}, `;
    });

    return str;
  }

  if (action === httpsActions.update) {
    const eventData = locals.addendumDoc.get('updatedFields');

    return `${pronoun} updated ${getUpdatedFieldNames(eventData)}`;
  }

  if (action === httpsActions.updatePhoneNumber) {
    let pronoun = `${locals.addendumDoc.get('user')} changed their`;

    if (locals.addendumDoc.get('user') === recipient) pronoun = 'You changed your';

    return `${pronoun} phone number from ${locals.addendumDoc.get('user')} to`
      + ` ${locals.addendumDoc.get('updatedPhoneNumber')}`;
  }

  /** Action is `comment` */
  return locals.addendumDoc.get('comment');
};


const addOfficeToProfile = (locals, batch) => {
  const activityDoc = locals.change.after.data();
  activityDoc.id = locals.change.after.id;
  const office = activityDoc.office;
  const officeId = activityDoc.officeId;
  const attachment = activityDoc.attachment;
  const employeeContact = attachment['Employee Contact'].value;
  const status = activityDoc.status;

  const employeeOf = {
    [office]: activityDoc,
  };

  if (status === 'CANCELLED') {
    employeeOf[office] = deleteField();
  }

  /**
   * TODO: Remove this and update Profile onWrite function to not rely on
   * data from this object.
   * This data is redundant since we can access all employee data that is
   * relevant for the report by reading the Office doc.
   */
  batch.set(rootCollections
    .profiles
    .doc(employeeContact), {
      employeeOf,
    }, {
      merge: true,
    });

  batch.set(rootCollections
    .offices
    .doc(officeId), {
      employeesData: {
        [employeeContact]:
          getValuesFromAttachment(locals.change.after),
      },
    }, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};

const addSupplierToOffice = (locals, batch) => {
  const attachment = locals.change.after.get('attachment');
  const supplierName = attachment.Name.value;
  const officeId = locals.change.after.get('officeId');

  batch.set(rootCollections.offices.doc(officeId), {
    suppliersMap: {
      [supplierName]:
        getValuesFromAttachment(locals.change.after),
    },
  }, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};


const addNewOffice = (locals, batch) => {
  const activityData = locals.change.after.data();
  activityData.timestamp = serverTimestamp;

  batch.set(rootCollections
    .offices
    .doc(locals.change.after.id),
    activityData, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};


const addCustomerToOffice = (locals, batch) => {
  const attachment = locals.change.after.get('attachment');
  const customerName = attachment.Name.value;
  const officeId = locals.change.after.get('officeId');

  batch.set(rootCollections
    .offices
    .doc(officeId), {
      customersMap: {
        [customerName]:
          getValuesFromAttachment(locals.change.after),
      },
    }, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};


module.exports = (change, context) => {
  /** Activity was deleted. For debugging only. */
  if (!change.after.data()) {
    console.log('Activity was deleted.', 'ID:', change.before.id);

    return Promise.resolve();
  }

  const activityId = context.params.activityId;
  const batch = db.batch();
  const locals = {
    change,
    assigneesMap: new Map(),
    assigneePhoneNumbersArray: [],
    addendumCreator: {},
    addendumCreatorInAssignees: false,
  };

  const promises = [rootCollections
    .activities
    .doc(activityId)
    .collection('Assignees')
    .get(),
  rootCollections
    .offices
    .doc(change.after.get('officeId'))
    .collection('Activities')
    .where('template', '==', 'admin')
    .get(),
  ];

  if (change.after.get('addendumDocRef')) {
    promises.push(db
      .doc(change.after.get('addendumDocRef').path)
      .get());
  }

  return Promise
    .all(promises)
    .then((result) => {
      const [
        assigneesSnapShot,
        adminsSnapShot,
        addendumDoc,
      ] = result;

      locals.adminsCanEdit = [];
      const allAdminPhoneNumbersSet
        = new Set(adminsSnapShot.docs.map((doc) => doc.get('attachment.Admin.value')));

      if (addendumDoc) {
        locals.addendumDoc = addendumDoc;
      }

      const authFetch = [];

      assigneesSnapShot.forEach((doc) => {
        authFetch
          .push(users.getUserByPhoneNumber(doc.id));

        locals.assigneesMap.set(doc.id, {
          canEdit: doc.get('canEdit'),
          addToInclude: doc.get('addToInclude'),
        });

        locals.assigneePhoneNumbersArray.push(doc.id);

        if (addendumDoc
          && doc.id === locals.addendumDoc.get('user')) {
          locals.addendumCreatorInAssignees = true;
        }

        if (allAdminPhoneNumbersSet.has(doc.id)) {
          locals.adminsCanEdit.push(doc.id);
        }
      });


      if (addendumDoc
        && !locals.addendumCreatorInAssignees) {
        authFetch.push(
          users.getUserByPhoneNumber(locals.addendumDoc.get('user'))
        );
      }

      return Promise.all(authFetch);
    })
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (!locals.addendumDoc
          && locals.addendumCreatorInAssignees
          && phoneNumber === locals.addendumDoc.get('user')) {
          locals.addendumCreator.displayName = record.displayName;

          /**
           * Since addendum creator was not in the assignees list,
           * returning from the iteration since we don't want to
           * add them to the activity unnecessarily.
           */
          return;
        }

        locals.assigneesMap.get(phoneNumber).displayName = record.displayName;
        locals.assigneesMap.get(phoneNumber).uid = record.uid;

        /** New user introduced to the system. Saving their phone number. */
        if (!record.uid) {
          batch.set(rootCollections
            .profiles
            .doc(phoneNumber), {
              uid: null,
            });
        }

        /** Document below the user profile. */
        const activityData = change.after.data();
        activityData.canEdit = locals.assigneesMap.get(phoneNumber).canEdit;
        activityData.assignees = locals.assigneePhoneNumbersArray;
        activityData.timestamp = serverTimestamp;

        batch.set(rootCollections
          .profiles
          .doc(phoneNumber)
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
       *
       * OR when the addendumDocRef field is set to `null`.
       */
      if (change.after.get('hidden') === 1) return batch;
      /**
       * When activity is not updated via an https function, we update the
       * set the `addendumDocRef` as `null`.
       */
      if (!locals.addendumDoc) return batch;

      /**
       * Checks if the action was a comment.
       * @param {string} action Can be one of the activity actions from HTTPS functions.
       * @returns {number} 0 || 1 depending on whether the action was a comment or anything else.
       */
      const isComment = (action) => {
        // Making this a closure since this function is not going to be used anywhere else.
        if (action === httpsActions.comment) return 1;

        return 0;
      };

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
              comment,
              activityId,
              isComment: isComment(locals.addendumDoc.get('action')),
              timestamp: serverTimestamp,
              userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
              location: locals.addendumDoc.get('location'),
              user: locals.addendumDoc.get('user'),
            });
        });

      return batch;
    })
    .then((batch) => {
      const template = change.after.get('template');

      console.log({
        activityId,
        template,
        locals,
        action: locals.addendumDoc ? locals.addendumDoc.get('action') : 'manual update',
      });

      const activityData = change.after.data();
      activityData.timestamp = serverTimestamp;
      activityData.adminsCanEdit = locals.adminsCanEdit;

      console.log('locals.adminsCanEdit', locals.adminsCanEdit);

      /** Document below the Offices/(OfficeId)/Activities/ collection. */
      batch.set(rootCollections
        .offices
        .doc(change.after.get('officeId'))
        .collection('Activities')
        .doc(activityId), activityData);

      if (template === 'office') {
        return addNewOffice(locals, batch);
      }

      if (template === 'subscription') {
        return addSubscriptionToUserProfile(locals, batch);
      }

      if (template === 'recipient') {
        return handleReport(locals, batch);
      }

      if (template === 'admin') {
        return setAdminCustomClaims(locals, batch);
      }

      if (template === 'employee') {
        return addOfficeToProfile(locals, batch);
      }

      if (template === 'customer') {
        return addCustomerToOffice(locals, batch);
      }

      if (template === 'supplier') {
        return addSupplierToOffice(locals, batch);
      }

      return batch.commit();
    })
    .catch(console.error);
};
