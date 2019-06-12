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
} = require('../../admin/admin');
const {
  httpsActions,
  vowels,
  validTypes,
} = require('../../admin/constants');
const {
  sendSMS,
  addEmployeeToRealtimeDb,
} = require('../../admin/utils');
const env = require('../../admin/env');
const momentTz = require('moment-timezone');
const admin = require('firebase-admin');


const sendEmployeeCreationSms = (locals) => {
  const template = locals.change.after.get('template');

  if (template !== 'employee'
    || !locals.addendumDoc
    || locals.addendumDoc.get('action') !== httpsActions.create
    || !env.isProduction) {
    return Promise.resolve();
  }

  const phoneNumber = locals.change.after.get('attachment.Employee Contact.value');
  /** Only 20 chars are allowed by smsgupshup */
  const office = locals.change.after.get('office').substring(0, 20);

  const smsText = `${office} will use Growthfile for attendance and leave.`
    + ` Download now to CHECK-IN ${env.downloadUrl}`;

  return sendSMS(phoneNumber, smsText);
};

const getUpdatedScheduleNames = (newSchedule, oldSchedule) => {
  const updatedFields = [];

  oldSchedule.forEach((item, index) => {
    const name = item.name;
    /** Request body ===> Update API request body. */
    const newStartTime = newSchedule[index].startTime;
    const newEndTime = newSchedule[index].endTime;
    const oldStartTime = item.startTime;
    const oldEndTime = item.endTime;

    if (newEndTime === oldEndTime && newStartTime === oldStartTime) {
      return;
    }

    updatedFields.push(name);
  });

  return updatedFields;
};

const getUpdatedVenueDescriptors = (newVenue, oldVenue) => {
  const updatedFields = [];

  oldVenue.forEach((venue, index) => {
    const venueDescriptor = venue.venueDescriptor;
    const oldLocation = venue.location;
    const oldAddress = venue.address;
    const oldGeopoint = venue.geopoint;
    const oldLongitude = oldGeopoint._longitude;
    const oldLatitude = oldGeopoint._latitude;
    const newLocation = newVenue[index].location;
    const newAddress = newVenue[index].address;
    const newGeopoint = newVenue[index].geopoint;
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

const getUpdatedAttachmentFieldNames = (newAttachment, oldAttachment) => {
  const updatedFields = [];

  Object
    .keys(newAttachment)
    .forEach((field) => {
      /** Comparing the `base64` photo string is expensive. Not doing it. */
      if (newAttachment[field].type === 'photo') return;

      const oldFieldValue = oldAttachment[field].value;
      const newFieldValue = newAttachment[field].value;
      const isUpdated = oldFieldValue !== newFieldValue;

      if (!isUpdated) return;

      updatedFields.push(field);
    });

  return updatedFields;
};

const getUpdatedFieldNames = (options) => {
  const {
    before,
    after,
  } = options;
  const oldSchedule = before.get('schedule');
  const oldVenue = before.get('venue');
  const oldAttachment = before.get('attachment');
  const newSchedule = after.get('schedule');
  const newVenue = after.get('venue');
  const newAttachment = after.get('attachment');

  const allFields = [
    ...getUpdatedScheduleNames(newSchedule, oldSchedule),
    ...getUpdatedVenueDescriptors(newVenue, oldVenue),
    ...getUpdatedAttachmentFieldNames(newAttachment, oldAttachment),
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
  const creator = locals.addendumDoc.get('user');
  const activityName = locals.addendumDoc.get('activityName');
  const template = locals.addendumDoc.get('activityData.template');

  if (action === httpsActions.create) {
    if (locals.addendumDoc.get('activityData.template') === 'duty roster') {
      if (recipient === creator) {
        return getCreateActionComment(template, pronoun);
      }

      const creatorName = (() => {
        if (locals.assigneesMap.get('creator')
          && locals.assigneesMap.get('creator').displayName) {
          return locals.assigneesMap.get('creator').displayName;
        }

        return creator;
      })();

      return `${creatorName} assigned you a duty "${activityName}"`;
    }

    return getCreateActionComment(template, pronoun);
  }

  if (action === httpsActions.changeStatus) {
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
    const options = {
      before: locals.change.before,
      after: locals.change.after,
    };

    return `${pronoun} updated ${getUpdatedFieldNames(options)}`;
  }

  /** Action is `comment` */
  return locals.addendumDoc.get('comment');
};

const handleAdmin = (locals) => {
  const template = locals.change.after.get('template');

  if (template !== 'admin') {
    return Promise.resolve();
  }

  const phoneNumber = locals.change.after.get('attachment.Admin.value');
  const status = locals.change.after.get('status');
  const office = locals.change.after.get('office');
  let customClaims = {};

  return auth
    .getUserByPhoneNumber(phoneNumber)
    .then((userRecord) => {
      customClaims = userRecord.customClaims || {};

      /** Duplication is not ideal. */
      if (customClaims.admin && !customClaims.admin.includes(office)) {
        customClaims.admin.push(office);
      }

      if (!customClaims.admin) {
        customClaims = { admin: [office] };
      }

      if (status === 'CANCELLED' && customClaims.admin && customClaims.admin.includes(office)) {
        const index = customClaims.admin.includes(office);

        customClaims.admin.splice(index, 1);
      }

      return auth
        .setCustomUserClaims(userRecord.uid, customClaims);
    })
    .catch((error) => {
      if (error.code === 'auth/user-not-found') {
        return Promise.resolve();
      }

      console.error(error);
    });
};


const createAdmin = (locals, adminContact) => {
  if (!adminContact) {
    return Promise.resolve();
  }

  const batch = db.batch();
  const officeId = locals.change.after.id;
  const activityRef = rootCollections.activities.doc();
  const addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .doc();

  return Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', 'admin')
        .limit(1)
        .get(),
      rootCollections
        .activities
        .where('attachment.Admin.value', '==', adminContact)
        .where('office', '==', locals.change.after.get('officeId'))
        .where('status', '==', 'CONFIRMED')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [adminTemplateQuery, adminQuery] = result;

      /** Is already an admin */
      if (!adminQuery.empty) {
        return Promise.resolve();
      }

      const adminTemplateDoc = adminTemplateQuery.docs[0];
      const activityData = {
        office: locals.change.after.get('office'),
        timezone: locals.change.after.get('office'),
        officeId: locals.change.after.get('officeId'),
        timestamp: Date.now(),
        addendumDocRef,
        schedule: [],
        venue: [],
        attachment: {
          Admin: {
            value: adminContact,
            type: 'phoneNumber',
          },
        },
        canEditRule: adminTemplateDoc.get('canEditRule'),
        creator: locals.change.after.get('creator'),
        hidden: adminTemplateDoc.get('hidden'),
        status: adminTemplateDoc.get('statusOnCreate'),
        template: 'admin',
        activityName: `ADMIN: ${adminContact}`,
        createTimestamp: Date.now(),
        forSalesReport: false,
      };

      const addendumDocData = {
        timestamp: Date.now(),
        activityData,
        user: locals.change.after.get('creator').phoneNumber,
        userDisplayName: locals.change.after.get('creator').displayName,
        action: httpsActions.create,
        template: 'admin',
        location: locals.addendumDoc.get('location'),
        userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
        activityId: activityRef.id,
        activityName: `ADMIN: ${adminContact}`,
        isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
        isAdminRequest: locals.addendumDoc.get('isAdminRequest'),
        geopointAccuracy: null,
        provider: null,
        isAutoGenerated: true,
      };

      batch.set(activityRef, activityData);
      batch.set(addendumDocRef, addendumDocData);

      const getCanEditValueForAdminActivity = (phoneNumber, adminContact) => {
        if (phoneNumber === adminContact) return true;

        if (locals.change.after.get('template') === 'office') {
          const firstContact = locals.change.after.get('attachment.First Contact.value');
          const secondContact = locals.change.after.get('attachment.Second Contact.value');

          if (phoneNumber === firstContact) return true;
          if (phoneNumber === secondContact) return true;
        }

        return false;
      };

      locals
        .assigneePhoneNumbersArray
        .forEach((phoneNumber) => {
          batch.set(activityRef.collection('Assignees').doc(phoneNumber), {
            canEdit: getCanEditValueForAdminActivity(phoneNumber, adminContact),
            addToInclude: false,
          });
        });

      return batch.commit();
    });
};


const handleRecipient = (locals) => {
  const template = locals.change.after.get('template');

  if (template !== 'recipient') {
    return Promise.resolve();
  }

  const batch = db.batch();

  const recipientsDocRef =
    rootCollections
      .recipients
      .doc(locals.change.after.id);

  if (locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.comment) {
    return Promise.resolve();
  }

  batch
    .set(recipientsDocRef, {
      include: locals.assigneePhoneNumbersArray,
      cc: locals.change.after.get('attachment.cc.value'),
      office: locals.change.after.get('office'),
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

  if (locals.change.after.get('status') === 'CANCELLED') {
    batch.delete(recipientsDocRef);
  }

  return batch.commit();
};


const createAutoSubscription = (locals, templateName, subscriber) => {
  if (!subscriber) {
    return Promise.resolve();
  }

  const office = locals.change.after.get('office');
  const officeId = locals.change.after.get('officeId');
  const batch = db.batch();

  return Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', 'subscription')
        .limit(1)
        .get(),
      rootCollections
        .activities
        .where('attachment.Subscriber.value', '==', subscriber)
        .where('office', '==', office)
        .where('status', '==', 'CONFIRMED')
        .limit(1)
        .get()
    ])
    .then((result) => {
      const [subscriptionTemplateQuery, userSubscriptionQuery] = result;

      /** Already has the subscription to whatever template that was passed */
      if (!userSubscriptionQuery.empty) {
        return Promise.resolve();
      }

      const subscriptionTemplateDoc = subscriptionTemplateQuery.docs[0];
      const activityRef = rootCollections.activities.doc();
      const addendumDocRef = rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .doc();

      const attachment = subscriptionTemplateDoc.get('attachment');
      attachment.Subscriber.value = subscriber;
      attachment.Template.value = templateName;

      const activityData = {
        addendumDocRef,
        attachment,
        timezone: locals.change.after.get('timezone'),
        venue: subscriptionTemplateDoc.get('venue'),
        timestamp: Date.now(),
        office: locals.change.after.get('office'),
        template: 'subscription',
        schedule: subscriptionTemplateDoc.get('schedule'),
        status: subscriptionTemplateDoc.get('statusOnCreate'),
        canEditRule: subscriptionTemplateDoc.get('canEditRule'),
        activityName: `SUBSCRIPTION: ${subscriber}`,
        officeId: locals.change.after.get('officeId'),
        hidden: subscriptionTemplateDoc.get('hidden'),
        creator: locals.change.after.get('creator'),
        createTimestamp: Date.now(),
        forSalesReport: false,
      };
      const addendumDocData = {
        activityData,
        user: locals.change.after.get('creator').phoneNumber,
        userDisplayName: locals.change.after.get('creator').displayName,
        share: locals.assigneePhoneNumbersArray,
        action: httpsActions.create,
        template: 'subscription',
        location: locals.addendumDoc.get('location'),
        timestamp: Date.now(),
        userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
        activityId: activityRef.id,
        isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
        isAdminRequest: locals.addendumDoc.get('isAdminRequest') || false,
        isAutoGenerated: true,
        geopointAccuracy: null,
        provider: null,
      };

      batch.set(activityRef, activityData);
      batch.set(addendumDocRef, addendumDocData);

      locals
        .assigneePhoneNumbersArray
        .forEach((phoneNumber) => {
          batch.set(activityRef.collection('Assignees').doc(phoneNumber), {
            /** Subscription's canEditRule is ADMIN */
            canEdit: locals.adminsCanEdit.includes(phoneNumber),
            addToInclude: phoneNumber !== subscriber,
          });
        });

      return batch.commit();
    });
};


const handleAutoAssign = (locals) => {
  const template = locals.change.after.get('template');
  const status = locals.change.after.get('status');

  if (template !== 'subscription' || status === 'CANCELLED') {
    return Promise.resolve();
  }

  /**
   * Flow:
   * Iterate over attachment fields
   * Extract the type and value field combinations
   * Fetch activities with those and make the
   * subscriber as an assignee of those activities
   */
  const subscriptionTemplate = locals
    .change
    .after
    .get('attachment.Template.value');
  const phoneNumber = locals
    .change
    .after
    .get('attachment.Subscriber.value');
  /**
   * Two batches in order to update activities only after all assignees
   * have been created in the /Activities/{id}/Assignees collectino
   */
  const activityBatch = db.batch();
  const assigneeBatch = db.batch();
  let isAdmin = false;
  let isEmployee = false;
  const activityFetchPromises = [];

  return rootCollections
    .activityTemplates
    .where('name', '==', subscriptionTemplate)
    .limit(1)
    .get()
    .then((docs) => {
      const doc = docs.docs[0];
      const attachment = doc.get('attachment');
      const fields = Object.keys(attachment);

      fields.forEach((field) => {
        const { value, type } = attachment[field];

        console.log('templates', type, value, field);

        if (validTypes.has(type) || value === '') {
          return;
        }

        const promise = rootCollections
          .activities
          .where('template', '==', type)
          .where(`attachment.Name.value`, '==', value)
          .where('status', '==', 'CONFIRMED')
          .limit(1)
          .get();

        activityFetchPromises.push(promise);
      });

      return Promise
        .all([
          rootCollections
            .activities
            .where('attachment.Admin.value', '==', phoneNumber)
            .where('status', '==', 'CONFIRMED')
            .limit(1)
            .get(),
          rootCollections
            .activities
            .where('attachment.Employee Contact.value', '==', phoneNumber)
            .where('status', '==', 'CONFIRMED')
            .limit(1)
            .get(),
        ]);
    })
    .then((result) => {
      const [adminQuery, employeeQuery] = result;

      isAdmin = !adminQuery.empty;
      isEmployee = !employeeQuery.empty;

      return Promise.all(activityFetchPromises);
    })
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) {
          /** This case should never occurr */
          return;
        }

        const doc = snapShot.docs[0];
        const canEditRule = doc.get('canEditRule');
        const canEdit = (() => {
          if (canEditRule === 'ADMIN') return isAdmin;
          if (canEditRule === 'EMPLOYEE') return isEmployee;
          if (canEditRule === 'NONE') return false;
          if (canEditRule === 'ALL') return true;

          return false;
        })();

        activityBatch
          .set(doc.ref, {
            timestamp: Date.now(),
            addendumDocRef: null,
          }, {
              merge: true,
            });

        assigneeBatch
          .set(doc
            .ref
            .collection('Assignees')
            .doc(phoneNumber), {
              canEdit,
              addToInclude: false,
            }, {
              merge: true,
            });
      });

      return assigneeBatch.commit();
    })
    .then(() => activityBatch.commit())
    .catch(console.error);
};

const handleCanEditRule = (locals, templateDoc) => {
  if (templateDoc.get('canEditRule') !== 'ADMIN'
    || locals.change.after.get('status') === 'CANCELLED') {
    return Promise.resolve();
  }

  const subscriberPhoneNumber = locals.change.after.get('attachment.Subscriber.value');
  const isAlreadyAdmin = locals.adminsCanEdit.includes(subscriberPhoneNumber);

  if (isAlreadyAdmin) {
    console.log('subscription activity; already admin', subscriberPhoneNumber);

    return Promise.resolve();
  }

  return createAdmin(locals, subscriberPhoneNumber);
};

const handleSubscription = (locals) => {
  const template = locals.change.after.get('template');

  if (template !== 'subscription') {
    return Promise.resolve();
  }

  const batch = db.batch();
  const templateName = locals.change.after.get('attachment.Template.value');
  const subscriberPhoneNumber = locals.change.after.get('attachment.Subscriber.value');
  const subscriptionDocRef = rootCollections
    .profiles
    .doc(subscriberPhoneNumber)
    .collection('Subscriptions')
    .doc(locals.change.after.id);

  return rootCollections
    .activityTemplates
    .where('name', '==', templateName)
    .limit(1)
    .get()
    .then((templateDocsQuery) => {
      const templateDoc = templateDocsQuery.docs[0];

      const include = [];

      locals
        .assigneePhoneNumbersArray
        .forEach((phoneNumber) => {
          /**
           * The user's own phone number is redundant in the include array since they
           * will be the one creating an activity using the subscription to this activity.
           */
          if (subscriberPhoneNumber === phoneNumber) return;

          /**
           * For the subscription template, people from
           * the share array are not added to the include array.
           */
          if (!locals.assigneesMap.get(phoneNumber).addToInclude) return;

          include.push(phoneNumber);
        });

      batch.set(subscriptionDocRef, {
        include,
        schedule: templateDoc.get('schedule'),
        venue: templateDoc.get('venue'),
        template: templateDoc.get('name'),
        attachment: templateDoc.get('attachment'),
        timestamp: locals.change.after.get('timestamp'),
        office: locals.change.after.get('office'),
        status: locals.change.after.get('status'),
        canEditRule: templateDoc.get('canEditRule'),
        hidden: templateDoc.get('hidden'),
        statusOnCreate: templateDoc.get('statusOnCreate'),
      });

      if (locals.change.after.get('status') === 'CANCELLED') {
        batch.delete(subscriptionDocRef);
      }

      /**
       * Delete subscription doc from old profile
       * if the phone number has been changed in the
       * subscription activity.
       */
      const subscriberChanged = locals.change.before.data()
        && (locals.change.before.get('attachment.Subscriber.value')
          !== locals.change.after.get('attachment.Subscriber.value'));

      if (subscriberChanged) {
        const oldDocRef = rootCollections
          .profiles
          .doc(locals.change.before.get('attachment.Subscriber.value'))
          .collection('Subscriptions')
          .doc(locals.change.after.id);

        batch.delete(oldDocRef);
      }

      return Promise
        .all([
          Promise
            .resolve(templateDoc),
          batch
            .commit(),
        ]);
    })
    .then((result) => {
      const [
        templateDoc,
      ] = result;

      return Promise
        .all([
          handleAutoAssign(locals),
          handleCanEditRule(locals, templateDoc)
        ]);
    })
    .catch(console.error);
};

const removeFromOfficeActivities = (locals) => {
  const activityDoc = locals.change.after;
  const {
    status,
    office,
  } = activityDoc.data();

  /** Only remove when the status is `CANCELLED` */
  if (status !== 'CANCELLED') {
    return Promise.resolve();
  }

  let oldStatus;

  if (locals.change.before.data()) {
    oldStatus = locals.change.before.get('status');
  }

  if (oldStatus
    && oldStatus === 'CANCELLED'
    && status === 'CANCELLED') {
    return Promise.resolve();
  }

  const phoneNumber
    = activityDoc.get('attachment.Employee Contact.value');

  const runQuery = (query, resolve, reject) =>
    query
      .get()
      .then((docs) => {
        console.log('size ==>', docs.size);

        if (docs.empty) {
          return 0;
        }

        const batch = db.batch();

        docs.forEach((doc) => {
          const template = doc.get('template');
          const activityStatus = doc.get('status');

          /**
           * Not touching the same activity which causes this flow
           * to run. Allowing that will send the activityOnWrite
           * to an infinite spiral.
           */
          if (template === 'employee' && doc.id === activityDoc.id) {
            return;
          }

          // No point of recancelling the already cancelled activities.
          if (activityStatus === 'CANCELLED') {
            return;
          }

          console.log('id', doc.ref.path);

          const phoneNumberInAttachment
            = doc.get('attachment.Admin.value')
            || doc.get('attachment.Subscriber.value');

          console.log({ phoneNumberInAttachment });

          // Cancelling admin to remove their custom claims.
          // Cancelling subscription to stop them from
          // creating new activities with that subscription
          if (new Set()
            .add('admin')
            .add('subscription')
            .has(template)
            && phoneNumber === phoneNumberInAttachment) {
            batch.set(rootCollections.activities.doc(doc.id), {
              timestamp: Date.now(),
              status: 'CANCELLED',
              addendumDocRef: null,
            }, {
                merge: true,
              });

            return;
          }

          batch.set(rootCollections.activities.doc(doc.id), {
            addendumDocRef: null,
            timestamp: Date.now(),
          }, {
              merge: true,
            });

          batch.delete(rootCollections.activities.doc(doc.id)
            .collection('Assignees')
            .doc(phoneNumber));
        });

        /* eslint-disable */
        return batch
          .commit()
          .then(() => docs.docs[docs.size - 1]);
        /* eslint-enable */
      })
      .then((lastDoc) => {
        if (!lastDoc) return resolve();

        console.log({ lastDocId: lastDoc.id });

        return process
          .nextTick(() => {
            const newQuery = query
              // Using greater than sign because we need
              // to start after the last activity which was
              // processed by this code otherwise some activities
              // might be updated more than once.
              .where(admin.firestore.FieldPath.documentId(), '>', lastDoc.id);

            return runQuery(newQuery, resolve, reject);
          });
      })
      .catch(new Error(reject));

  const query = rootCollections
    .profiles
    .doc(phoneNumber)
    .collection('Activities')
    .where('office', '==', office)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(250);

  return new Promise((resolve, reject) => runQuery(query, resolve, reject))
    .catch(console.error);
};


const deleteMonthlyDocs = () => {
  // TODO: Implement this...
  return Promise.resolve();
};


const handleMonthlyDocs = (locals, hasBeenCancelled) => {
  const template = locals.change.after.get('template');
  const office = locals.change.after.get('office');
  const phoneNumber = locals.change.after.get('attachment.Employee Contact.value');

  if (template !== 'employee') {
    return Promise.resolve();
  }

  if (hasBeenCancelled) {
    return deleteMonthlyDocs(locals);
  }

  let timezone;
  let officeDoc;
  let momentToday;
  const batch = db.batch();

  // Create doc for the current month.
  return rootCollections
    .offices
    .where('office', '==', office)
    .limit(1)
    .get()
    .then((docs) => {
      officeDoc = docs.docs[0];
      timezone = officeDoc.get('attachment.Timezone.value');
      momentToday = momentTz().tz(timezone);

      return officeDoc
        .ref
        .collection('Monthly')
        .where('phoneNumber', '==', phoneNumber)
        .where('month', '==', momentToday.month())
        .where('year', '==', momentToday.year())
        .limit(1)
        .get();
    })
    .then((snapShot) => {
      /** Doc already exists. No need to do anything */
      if (!snapShot.empty) {
        return Promise.resolve();
      }

      batch.set(officeDoc
        .ref
        .collection('Monthly')
        .doc(), {
          phoneNumber,
          month: momentToday.month(),
          year: momentToday.year(),
          statusObject: {
            [momentToday.date()]: {
              firstAction: '',
              lastAction: '',
            },
          },
        });

      return batch.commit();
    })
    .catch(console.error);
};

const createDefaultSubscriptionsForEmployee = (locals, hasBeenCancelled) => {
  const hasBeenCreated = locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;

  if (hasBeenCancelled || !hasBeenCreated) {
    return Promise.resolve();
  }

  const phoneNumber = locals.change.after.get('attachment.Employee Contact.value');

  return Promise
    .all([
      createAutoSubscription(locals, 'check-in', phoneNumber),
      createAutoSubscription(locals, 'leave', phoneNumber)
    ]);
};


const handleEmployee = (locals) => {
  const template = locals.change.after.get('template');

  if (template !== 'employee') {
    return Promise.resolve();
  }

  const activityDoc = locals.change.after.data();
  activityDoc.id = locals.change.after.id;
  const office = activityDoc.office;
  const officeId = activityDoc.officeId;
  const phoneNumber = locals.change.after.get('attachment.Employee Contact.value');
  const oldStatus = (() => {
    if (locals.change.before.data()) {
      return locals.change.before.get('status');
    }

    return null;
  })();
  const newStatus = locals.change.after.get('status');
  const hasBeenCancelled = oldStatus
    && oldStatus !== 'CANCELLED'
    && newStatus === 'CANCELLED';

  const employeeOf = {
    [office]: officeId,
  };

  const batch = db.batch();

  // Change of status from `CONFIRMED` to `CANCELLED`
  if (hasBeenCancelled) {
    employeeOf[office] = deleteField();

    // Remove from employeesData map.
    batch
      .set(rootCollections
        .offices
        .doc(officeId), {
          employeesData: {
            [phoneNumber]: deleteField(),
          },
        }, {
          merge: true,
        });
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
    .then(() => addEmployeeToRealtimeDb(locals.change.after))
    .then(() => users.getUserByPhoneNumber(phoneNumber))
    .then((userRecords) => userRecords[phoneNumber])
    .then((userRecord) => {
      if (!userRecord.uid || !hasBeenCancelled) {
        return Promise.resolve();
      }

      return removeFromOfficeActivities(locals);
    })
    .then(() => sendEmployeeCreationSms(locals))
    .then(() => handleMonthlyDocs(locals, hasBeenCancelled))
    .then(() => createDefaultSubscriptionsForEmployee(locals, hasBeenCancelled))
    .catch(console.error);
};

const createFootprintsRecipient = (locals) => {
  const activityRef = rootCollections.activities.doc();
  const addendumDocRef = locals.change.after.ref.collection('Addendum').doc();
  const batch = db.batch();

  return rootCollections
    .activityTemplates
    .where('name', '==', 'recipient')
    .get()
    .then((recipientQuery) => {
      const attachment = recipientQuery.docs[0].get('attachment');
      attachment.Name.value = 'footprints';

      const activityData = {
        addendumDocRef,
        attachment,
        timezone: locals.change.after.get('attachment.Timezone.value'),
        venue: [],
        schedule: [],
        timestamp: Date.now(),
        status: recipientQuery.docs[0].get('statusOnCreate'),
        office: locals.change.after.get('office'),
        activityName: 'RECIPIENT: FOOTPRINTS REPORT',
        canEditRule: recipientQuery.docs[0].get('canEditRule'),
        template: 'recipient',
        officeId: locals.change.after.id,
        creator: locals.change.after.get('creator'),
        createTimestamp: Date.now(),
        forSalesReport: false,
      };
      const addendumDocData = {
        activityData,
        user: locals.change.after.get('creator').phoneNumber,
        userDisplayName: locals.change.after.get('creator').displayName,
        action: httpsActions.create,
        template: 'recipient',
        isAutoGenerated: true,
        timestamp: Date.now(),
        userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
        activityId: activityRef.id,
        location: locals.addendumDoc.get('location'),
        isSupportRequest: locals.addendumDoc.get('isSupportRequest') || false,
        isAdminRequest: locals.addendumDoc.get('isAdminRequest') || false,
        geopointAccuracy: null,
        provider: null,
      };

      const firstContact = locals.change.after.get('attachment.First Contact.value');
      const secondContact = locals.change.after.get('attachment.Second Contact.value');

      locals
        .assigneePhoneNumbersArray
        .forEach((phoneNumber) => {
          batch.set(activityRef.collection('Assignees').doc(phoneNumber), {
            /** canEditRule is admin */
            canEdit: phoneNumber === firstContact || phoneNumber === secondContact,
            addToInclude: false,
          });
        });

      batch.set(activityRef, activityData);
      batch.set(addendumDocRef, addendumDocData);

      return batch.commit();
    });
};


const handleOffice = (locals) => {
  const template = locals.change.after.get('template');
  const hasBeenCreated = locals.addendumDoc && locals.addendumDoc.get('action') === httpsActions.create;

  if (template !== 'office' || !hasBeenCreated) {
    return Promise.resolve();
  }

  const firstContact = locals.change.after.get('attachment.First Contact.value');
  const secondContact = locals.change.after.get('attachment.Second Contact.value');

  return createFootprintsRecipient(locals)
    .then(() => createAutoSubscription(locals, 'subscription', firstContact))
    .then(() => createAutoSubscription(locals, 'subscription', secondContact))
    .then(() => createAdmin(locals, firstContact))
    .then(() => createAdmin(locals, secondContact));
};


module.exports = (change, context) => {
  /** Activity was deleted. For debugging only. */
  if (!change.after.data()) {
    console.log('Activity was deleted.', 'ID:', change.before.id);

    return Promise.resolve();
  }

  const activityId = context.params.activityId;
  const batch = db.batch();
  const template = change.after.get('template');
  const status = change.after.get('status');
  const locals = {
    change,
    assigneesMap: new Map(),
    assigneePhoneNumbersArray: [],
    addendumCreator: {},
    addendumCreatorInAssignees: false,
    adminsCanEdit: [],
  };

  const promises = [
    rootCollections
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

  /** Could be `null` when we update the activity without user intervention */
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

      const allAdminPhoneNumbersSet = new Set(
        adminsSnapShot
          .docs
          .map((doc) => doc.get('attachment.Admin.value'))
      );

      if (addendumDoc) {
        locals.addendumDoc = addendumDoc;
      }

      const authFetch = [];

      assigneesSnapShot.forEach((doc) => {
        if (addendumDoc
          && doc.id === addendumDoc.get('user')) {
          locals.addendumCreatorInAssignees = true;
        }

        if (allAdminPhoneNumbersSet.has(doc.id)) {
          locals.adminsCanEdit.push(doc.id);
        }

        authFetch
          .push(users.getUserByPhoneNumber(doc.id));

        locals
          .assigneesMap
          .set(doc.id, {
            canEdit: doc.get('canEdit'),
            addToInclude: doc.get('addToInclude'),
          });

        locals
          .assigneePhoneNumbersArray
          .push(doc.id);
      });

      if (addendumDoc
        && !locals.addendumCreatorInAssignees) {
        authFetch
          .push(
            users.getUserByPhoneNumber(addendumDoc.get('user'))
          );
      }

      return Promise.all(authFetch);
    })
    .then((userRecords) => {
      userRecords.forEach((userRecord) => {
        const phoneNumber = Object.keys(userRecord)[0];
        const record = userRecord[`${phoneNumber}`];

        if (locals.addendumDoc
          && !locals.addendumCreatorInAssignees
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
        locals.assigneesMap.get(phoneNumber).photoURL = record.photoURL;
        locals.assigneesMap.get(phoneNumber).customClaims = record.customClaims;

        /** New user introduced to the system. Saving their phone number. */
        if (!record.hasOwnProperty('uid')) {
          const creator = (() => {
            if (typeof change.after.get('creator') === 'string') {
              return change.after.get('creator');
            }

            return change.after.get('creator').phoneNumber;
          })();

          batch.set(rootCollections
            .profiles
            .doc(phoneNumber), {
              smsContext: {
                activityName: change.after.get('activityName'),
                creator,
                office: change.after.get('office'),
              },
            }, {
              merge: true,
            });
        }

        /** Document below the user profile. */
        const activityData = change.after.data();
        activityData.canEdit = locals.assigneesMap.get(phoneNumber).canEdit;
        activityData.timestamp = Date.now();

        activityData.assignees = (() => {
          const result = [];

          locals
            .assigneePhoneNumbersArray.forEach((phoneNumber) => {
              let displayName = '';
              let photoURL = '';

              if (locals.assigneesMap.has(phoneNumber)) {
                // Both of these values, unless set clould be `undefined`
                displayName = locals.assigneesMap.get(phoneNumber).displayName || '';
                photoURL = locals.assigneesMap.get(phoneNumber).photoURL || '';
              }

              const object = { phoneNumber, displayName, photoURL };

              result.push(object);
            });

          return result;
        })();

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
          /**
           * If the person has used up all their leaves, for the `create`/`update`
           * flow, the comment created for them  will be from this function
           */
          const comment = (() => {
            if (locals.addendumDoc && locals.addendumDoc.get('cancellationMessage')) {
              return locals.addendumDoc.get('cancellationMessage');
            }

            return getCommentString(locals, phoneNumber);
          })();

          batch.set(rootCollections
            .updates
            .doc(locals.assigneesMap.get(phoneNumber).uid)
            .collection('Addendum')
            /**
             * Handless duplicate addendum creation. Occasionally, the `activityOnWrite`
             * function triggers twice/multiple times for a single write resulting in
             * multiple addendum being created with the same text.
             */
            .doc(locals.addendumDoc.id), {
              comment,
              activityId,
              timestamp: Date.now(),
              isComment: isComment(locals.addendumDoc.get('action')),
              userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
              location: locals.addendumDoc.get('location'),
              user: locals.addendumDoc.get('user'),
            });
        });

      return batch;
    })
    .then(() => {
      console.log({
        activityId,
        template,
        action: locals.addendumDoc ? locals.addendumDoc.get('action') : 'manual update',
      });

      const activityData = change.after.data();
      activityData.timestamp = Date.now();
      activityData.adminsCanEdit = locals.adminsCanEdit;
      activityData.isCancelled = status === 'CANCELLED';
      delete activityData.addendumDocRef;

      const copyTo = (() => {
        const officeId = change.after.get('officeId');
        const officeRef = rootCollections.offices.doc(officeId);

        if (locals.addendumDoc
          && locals.addendumDoc.get('action') === httpsActions.create
          && template !== 'office') {
          const date = new Date();

          activityData.creationDate = date.getDate();
          activityData.creationMonth = date.getMonth();
          activityData.creationYear = date.getFullYear();

          activityData
            .creationTimestamp = locals
              .change
              .after
              .createTime
              .toDate()
              .getTime();
        }

        if (template === 'office') {
          /** Office doc doesn't need the `adminsCanEdit` field */
          delete activityData.adminsCanEdit;

          return officeRef;
        }

        return officeRef.collection('Activities').doc(change.after.id);
      })();

      batch.set(copyTo, activityData, { merge: true });

      return batch.commit();
    })
    .then(() => handleSubscription(locals))
    .then(() => handleRecipient(locals))
    .then(() => handleAdmin(locals))
    .then(() => handleEmployee(locals))
    .then(() => handleOffice(locals))
    .catch((error) => {
      console.error({
        error,
        context,
        activityId: change.after.id,
      });
    });
};
