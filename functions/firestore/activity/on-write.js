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
  fieldPath,
  rootCollections,
} = require('../../admin/admin');
const {
  httpsActions,
  vowels,
  customMessages,
  reportNames,
} = require('../../admin/constants');

const moment = require('moment-timezone');


const toAttachmentValues = (activity) => {
  const object = {
    activityId: activity.id,
    createTime: activity.createTime.toDate().getTime(),
  };

  const fields = Object.keys(activity.get('attachment'));

  fields.forEach((field) => object[field] = activity.get('attachment')[field].value);

  return object;
};


const handleAdmin = (locals, batch) => {
  const phoneNumber = locals.change.after.get('attachment.Admin.value');
  const status = locals.change.after.get('status');
  const office = locals.change.after.get('office');

  return batch
    .commit()
    .then(() => auth.getUserByPhoneNumber(phoneNumber))
    .then((userRecord) => {
      if (userRecord.customClaims.hasOwnProperty('admin')
        && !userRecord.customClaims.admin.includes(office)) {
        userRecord.customClaims.admin.push(office);
      } else {
        userRecord.customClaims.admin = [
          office,
        ];
      }

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
        const index = userRecord.customClaims.admin.indexOf(office);

        /**
         * The user already is `admin` of another office.
         * Preserving their older permission for that case..
         * If this office is already present in the user's custom claims,
         * there's no need to add it again.
         * This fixes the case of duplication in the `offices` array in the
         * custom claims.
         */
        if (index > -1) {
          userRecord.customClaims.admin.splice(index, 1);
        }
      }

      return auth
        .setCustomUserClaims(
          userRecord.uid,
          userRecord.customClaims
        );
    })
    .catch((error) => {
      /**
       * User who doesn't have auth will be granted admin claims
       * when they actually sign-up to the platform (handled in `AuthOnCreate`)
       * using the client app.
       */
      if (error.code !== 'auth/user-not-found') {
        console.log({
          phoneNumber,
          office,
        });

        console.error(error);
      }

      return Promise.resolve();
    });
};


const handleRecipient = (locals, batch) => {
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



const handleAutoAssign = (locals) => {
  /**
   * X gets subsc of template A:
   *     Fetch all activities with template B
   *         Make X an assignee
   *     Fetch all activities with template == subscription 
   *         AND attachment.Template.value == B
   *             Make X an assignee (Add to include = true)
   * 
   *  Y gets subsc of template B:
   *      Fetch all activities with 
   *         template === subscription and attachment.Template.value == A
   *             Make Y an assignee (add to include = true)
   */

  console.log('IN Auto assign');

  if (locals.change.after.get('template') !== 'subscription'
    || locals.change.after.get('status') === 'CANCELLED') {
    console.log('returning early in auto assign');

    return Promise.resolve();
  }

  const subscriber = locals.change.after.get('attachment.Subscriber.value');
  const template = locals.change.after.get('attachment.Template.value');
  const office = locals.change.after.get('office');
  const officeId = locals.change.after.get('officeId');
  const isAdmin = locals.adminsCanEdit.includes(subscriber);

  const getCanEdit = (locals, phoneNumber, canEditRule) => {
    if (canEditRule === 'NONE') {
      return false;
    }

    if (canEditRule === 'EMPLOYEE') {
      return locals.isEmployee;
    }

    if (canEditRule === 'ADMIN') {
      return locals.adminsCanEdit.includes(phoneNumber);
    }

    if (canEditRule === 'CREATOR') {
      return locals.change.after.get('creator') === phoneNumber;
    }

    // for `ALL`
    return true;
  };

  const aRelationshipMap = new Map()
    .set('payment', ['bill'])
    .set('bill', ['supplier'])
    .set('leave', ['leave-type'])
    .set('invoice', ['customer'])
    .set('tour plan', ['customer'])
    .set('collection', ['invoice'])
    .set('duty roster', ['customer'])
    .set('customer', ['customer-type'])
    .set('supplier', ['supplier-type'])
    .set('dsr', ['customer', 'product'])
    .set('expense claim', ['expense-type'])
    .set('employee', ['branch', 'department'])
    .set('sales order', ['product', 'customer'])
    .set('purchase order', ['supplier', 'material']);
  const bActivitiesFetch = [];
  const bSubscriptionActivitiesFetch = [];

  // Not all templates use this logic
  if (!aRelationshipMap.get(template)) {
    return Promise.resolve();
  }

  aRelationshipMap
    .get(template)
    .forEach((childTemplate) => {
      console.log({ childTemplate });

      const promise = rootCollections
        .activities
        .where('office', '==', office)
        .where('template', '==', childTemplate)
        .limit(1)
        .get();

      bActivitiesFetch.push(promise);

      const promise2 = rootCollections
        .activities
        .where('office', '==', office)
        .where('template', '==', 'subscription')
        .where('attachment.Template.value', '==', childTemplate)
        .limit(1)
        .get();

      bSubscriptionActivitiesFetch.push(promise2);
    });

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Activities')
    .where('template', '==', 'employee')
    .where('attachment.Employee Contact.value', '==', subscriber)
    .limit(1)
    .get()
    .then((snapShot) => {
      locals.isEmployee = !snapShot.empty;

      console.log({
        subscriber,
        template,
        office,
        isAdmin,
        isEmployee: locals.isEmployee,
      });

      return Promise.all(bActivitiesFetch);
    })
    .then((snapShots) => {
      const activityBatch = db.batch();
      const assigneeBatch = db.batch();

      // Make an assignee of child template
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];

        console.log('activity:', doc.ref.path);

        activityBatch.set(doc.ref, {
          timestamp: Date.now(),
          addendumDocRef: null,
        }, {
            merge: true,
          });

        assigneeBatch.set(doc.ref.collection('Assignees').doc(subscriber), {
          canEdit: getCanEdit(locals, subscriber, doc.get('canEditRule')),
          addToInclude: true,
        }, {
            merge: true,
          });
      });

      return Promise
        .all([
          activityBatch
            .commit(),
          assigneeBatch
            .commit(),
        ]);
    })
    .then(() => Promise.all(bSubscriptionActivitiesFetch))
    .then((snapShots) => {
      const activityBatch = db.batch();
      const assigneeBatch = db.batch();

      snapShots.forEach((subscriptionActivity) => {
        if (subscriptionActivity.empty) return;

        const doc = subscriptionActivity.docs[0];

        activityBatch.set(doc.ref, {
          timestamp: Date.now(),
          addendumDocRef: null,
        }, {
            merge: true,
          });

        assigneeBatch.set(doc.ref.collection('Assignees').doc(subscriber), {
          canEdit: getCanEdit(locals, subscriber, doc.get('canEditRule')),
          addToInclude: true,
        });
      });

      /** 
       * Not using `Promise.all` to commit at the same time 
       * because we want the assigneeBatch to commit first.
       * `Activity` batch only triggers `activityOnWrite` and handles 
       * the include array for `subscription` activities.
       */

      /* eslint-disable */
      return assigneeBatch
        .commit()
        .then(() => activityBatch.commit());
      /* eslint-enable */
    })
    .catch(console.error);
};



const handleCanEditRule = (locals, templateDoc) => {
  if (templateDoc.get('canEditRule') !== 'ADMIN'
    || locals.change.after.get('status') === 'CANCELLED') {
    console.log('In canEditRule. Returning Early.');

    return Promise.resolve();
  }

  const officeId = locals.change.after.get('officeId');
  const subscriberPhoneNumber = locals.change.after.get('attachment.Subscriber.value');
  const isAlreadyAdmin = locals.adminsCanEdit.includes(subscriberPhoneNumber);

  if (isAlreadyAdmin) {
    console.log('subscription activity; already admin', subscriberPhoneNumber);

    return Promise.resolve();
  }

  return rootCollections
    .activityTemplates
    .where('name', '==', 'admin')
    .limit(1)
    .get()
    .then((adminTemplateQuery) => {
      const batch = db.batch();
      const adminTemplateDoc = adminTemplateQuery.docs[0];
      const activityRef = rootCollections.activities.doc();
      const addendumDocRef =
        rootCollections
          .offices
          .doc(officeId)
          .collection('Addendum')
          .doc();

      const attachment = (() => {
        const attachmentObject = adminTemplateDoc.get('attachment');
        attachmentObject.Admin.value = subscriberPhoneNumber;

        return attachmentObject;
      })();

      const now = new Date();

      const activityData = {
        officeId,
        attachment,
        addendumDocRef,
        venue: [],
        schedule: [],
        template: 'admin',
        timestamp: now.getTime(),
        hidden: adminTemplateDoc.get('hidden'),
        office: locals.change.after.get('office'),
        creator: locals.change.after.get('creator'),
        status: adminTemplateDoc.get('statusOnCreate'),
        canEditRule: adminTemplateDoc.get('canEditRule'),
        activityName: `ADMIN: ${subscriberPhoneNumber}`,
      };

      const addendumData = {
        activityData,
        template: 'admin',
        date: now.getDate(),
        month: now.getMonth(),
        isAutoGenerated: true,
        year: now.getFullYear(),
        activityId: activityRef.id,
        user: activityData.creator,
        action: httpsActions.create,
        timestamp: activityData.timestamp,
        share: locals.addendumDoc.get('share'),
        activityName: activityData.activityName,
        location: locals.addendumDoc.get('location'),
        userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
        userDisplayName: locals.addendumDoc.get('userDisplayName'),
        isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
        isAdminRequest: locals.addendumDoc.get('isAdminRequest') || null,
      };

      const isAdmin = (phoneNumber) => {
        /** canEditRule for subscription is `ADMIN` */
        return locals.adminsCanEdit.includes(phoneNumber)
          || phoneNumber === subscriberPhoneNumber;
      };

      locals
        .assigneePhoneNumbersArray
        .forEach((phoneNumber) => {
          const ref = activityRef.collection('Assignees').doc(phoneNumber);

          batch.set(ref, {
            /** The canEditRule for admin is `ADMIN` */
            canEdit: isAdmin(phoneNumber),
            addToInclude: phoneNumber !== subscriberPhoneNumber,
          });
        });

      batch.set(activityRef, activityData);
      batch.set(addendumDocRef, addendumData);

      return batch.commit();
    })
    .catch(console.error);
};


const handleSubscription = (locals, batch) => {
  const templateName = locals.change.after.get('attachment.Template.value');
  console.log({ templateName });

  return rootCollections
    .activityTemplates
    .where('name', '==', templateName)
    .limit(1)
    .get()
    .then((templateDocsQuery) => {
      const templateDoc = templateDocsQuery.docs[0];
      const subscriberPhoneNumber =
        locals
          .change
          .after.get('attachment.Subscriber.value');

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

      batch.set(rootCollections
        .profiles
        .doc(subscriberPhoneNumber)
        .collection('Subscriptions')
        .doc(locals.change.after.id), {
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

      /* eslint-disable */
      return batch
        .commit()
        .then(() => templateDoc);
      /* eslint-enable */
    })
    .then((templateDoc) => handleCanEditRule(locals, templateDoc))
    .then(() => handleAutoAssign(locals))
    .catch(console.error);
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


const assignToActivities = (locals) => {
  if (locals.change.after.get('status') === 'CANCELLED') {
    return Promise.resolve();
  }

  const departmentName = locals.change.after.get('attachment.Department.value');
  const branchName = locals.change.after.get('attachment.Base Location.value');
  const phoneNumber = locals.change.after.get('attachment.Employee Contact.value');
  const office = locals.change.after.get('office');

  return Promise
    .all([
      rootCollections
        .activities
        .where('office', '==', office)
        .where('template', '==', 'template')
        .where('attachment.Name.value', '==', departmentName)
        .limit(1)
        .get(),
      rootCollections
        .activities
        .where('office', '==', office)
        .where('template', '==', 'branch')
        .where('attachment.Name.value', '==', branchName)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        departmentActivitiesQuery,
        branchActivitiesQuery,
      ] = result;

      /**
       * This person is an assignee of the activity, and if they are
       * an admin, this array will include their phone number
       */
      const isAdmin = locals.adminsCanEdit.includes(phoneNumber);
      const departmentDoc = departmentActivitiesQuery.docs[0];
      const branchDoc = branchActivitiesQuery.docs[0];

      const batch = db.batch();
      /**
       * Using .exists check because attachment can have empty strings
       * as the values in the value field.
       */

      if (!departmentActivitiesQuery.empty) {
        batch.set(departmentDoc.ref, {
          timestamp: Date.now(),
          addendumDocRef: null,
        }, {
            merge: true,
          });

        batch.set(departmentDoc.ref.collection('Assignees').doc(phoneNumber), {
          canEdit: isAdmin,
          addToInclude: true,
        }, {
            merge: true,
          });
      }

      if (!branchActivitiesQuery.empty) {
        batch.set(branchDoc.ref, {
          timestamp: Date.now(),
          addendumDocRef: null,
        }, {
            merge: true,
          });

        batch.set(branchDoc.ref.collection('Assignees').doc(phoneNumber), {
          canEdit: isAdmin,
          addToInclude: true,
        }, {
            merge: true,
          });
      }

      return batch.commit();
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

  let oldStatus = null;

  if (locals.change.before) {
    oldStatus = locals.change.before.get('oldStatus');
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

        console.log('================================');

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

        console.log('================================');

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
              .where(fieldPath, '>', lastDoc.id);

            return runQuery(newQuery, resolve, reject);
          });
      })
      .catch(new Error(reject));

  const query = rootCollections
    .profiles
    .doc(phoneNumber)
    .collection('Activities')
    .where('office', '==', office)
    .orderBy(fieldPath)
    .limit(250);

  return new Promise((resolve, reject) => runQuery(query, resolve, reject))
    .catch(console.error);
};


const handleEmployee = (locals, batch) => {
  const activityDoc = locals.change.after.data();
  activityDoc.id = locals.change.after.id;
  const office = activityDoc.office;
  const officeId = activityDoc.officeId;
  const attachment = activityDoc.attachment;
  const employeeContact = attachment['Employee Contact'].value;
  const status = activityDoc.status;

  const employeeOf = {
    [office]: officeId,
  };

  if (status === 'CANCELLED') {
    employeeOf[office] = deleteField();
  }

  batch.set(rootCollections
    .profiles
    .doc(employeeContact), {
      employeeOf,
    }, {
      merge: true,
    });

  return batch
    .commit()
    .then(() => assignToActivities(locals))
    .then(() => removeFromOfficeActivities(locals))
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
        officeDoc,
      ] = result;

      const allAdminPhoneNumbersSet
        = new Set(adminsSnapShot.docs.map((doc) => doc.get('attachment.Admin.value')));

      if (addendumDoc) {
        locals.addendumDoc = addendumDoc;
      }

      if (officeDoc) {
        locals.officeDoc = officeDoc;
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

      return Promise
        .all(authFetch);
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

        /** New user introduced to the system. Saving their phone number. */
        if (!record.hasOwnProperty('uid')) {
          batch.set(rootCollections
            .profiles
            .doc(phoneNumber), {
              smsContext: {
                activityName: change.after.get('activityName'),
                creator: change.after.get('creator'),
                office: change.after.get('office'),
              },
            }, {
              merge: true,
            });
        }

        /** Document below the user profile. */
        const activityData = change.after.data();
        activityData.canEdit = locals.assigneesMap.get(phoneNumber).canEdit;
        activityData.assignees = locals.assigneePhoneNumbersArray;
        activityData.timestamp = Date.now();

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
            const status = change.after.get('status');
            const isCancelled = status === 'CANCELLED';
            const action = locals.addendumDoc.get('action');
            const templateName = change.after.get('template');
            const activityCreated = httpsActions.create === action;

            if (locals.addendumDoc && locals.addendumDoc.get('cancellationMessage')) {
              return locals.addendumDoc.get('cancellationMessage');
            }

            if (templateName === 'leave') {
              if (activityCreated && isCancelled) {
                return customMessages.LEAVE_CANCELLED;
              }
            }

            if (templateName === 'check-in') {
              if (activityCreated && isCancelled) {
                return customMessages.CHECK_IN_CANCELLED;
              }
            }

            if (templateName === 'tour plan') {
              if (activityCreated && isCancelled) {
                return customMessages.TOUR_PLAN_CANCELLED;
              }
            }

            return getCommentString(locals, phoneNumber);
          })();

          console.log({ phoneNumber, comment });

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
      const template = change.after.get('template');
      const status = change.after.get('status');

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
        const officeRef = rootCollections.offices.doc(change.after.get('officeId'));

        if (locals.addendumDoc
          && locals.addendumDoc.get('action') === httpsActions.create
          && template !== 'office') {
          const date = new Date();

          activityData.creationDate = date.getDate();
          activityData.creationMonth = date.getMonth();
          activityData.creationYear = date.getFullYear();
        }

        if (template === 'office') {
          /** Office doc doesn't need the `adminsCanEdit` field */
          delete activityData.adminsCanEdit;

          return officeRef;
        }

        return officeRef.collection('Activities').doc(change.after.id);
      })();

      /** Puting them here in order to be able to query based on year
       * on which the leave or tour plan has been created based
       * on schedule. Querying directly based on the startTime or endTime,
       * is not possible since they are inside an array.
       */
      if (template === 'leave' || template === 'tour plan') {
        const schedule = change.after.get('schedule')[0];

        activityData.startYear = moment(schedule.startTime).year();
        activityData.endYear = moment(schedule.endTime).year();
      }

      batch.set(copyTo, activityData, {
        merge: true,
      });

      if (template === 'subscription') {
        return handleSubscription(locals, batch);
      }

      if (template === 'recipient') {
        return handleRecipient(locals, batch);
      }

      if (template === 'admin') {
        return handleAdmin(locals, batch);
      }

      if (template === 'employee') {
        return handleEmployee(locals, batch);
      }

      return batch.commit();
    })
    .catch((error) => {
      console.error({
        error,
        context,
        activityId: change.after.id,
      });
    });
};
