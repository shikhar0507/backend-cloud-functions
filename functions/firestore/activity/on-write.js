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


const toAttachmentValues = (activity) => {
  const object = {
    activityId: activity.id,
    createTime: activity.createTime,
  };

  const fields = Object.keys(activity.get('attachment'));

  fields.forEach((field) => object[field] = activity.get('attachment')[field].value);

  return object;
};


const setAdminCustomClaims = (locals, batch) => {
  const phoneNumber = locals.change.after.get('attachment.Admin.value');
  const status = locals.change.after.get('status');
  const office = locals.change.after.get('office');

  return auth
    .getUserByPhoneNumber(phoneNumber)
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

      return Promise
        .all([
          auth
            .setCustomUserClaims(
              userRecord.uid,
              userRecord.customClaims
            ),
          batch
            .commit(),
        ]);
    })
    .catch((error) => {
      /**
       * User who doesn't have auth will be granted admin claims
       * when they actually sign-up to the platform (handled in `AuthOnCreate`)
       * using the client app.
       */
      if (error.code === 'auth/user-not-found') {
        return batch.commit();
      }

      console.error(error);

      return Promise.resolve();
    });
};


const handleReport = (locals, batch) => {
  if (locals.addendumDoc
    && locals.addendumDoc.get('action') !== httpsActions.comment) {
    batch.set(rootCollections
      .recipients
      .doc(locals.change.after.id), {
        /** Required to use the `orderBy` clause */
        activityId: locals.change.after.id,
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


const handleSpecialTemplateCases = (locals) => {
  const templateName = locals.change.after.get('attachment.Template.value');
  const subscriberPhoneNumber = locals.change.after.get('attachment.Subscriber.value');

  const templatesAllowed =
    new Set()
      .add('dsr')
      .add('tour plan')
      .add('duty roster');

  if (!templatesAllowed.has(templateName)) return Promise.resolve();

  return Promise
    .all([
      rootCollections
        .activities
        .where('office', '==', locals.change.after.get('office'))
        .where('template', '==', 'customer')
        .get(),
      rootCollections
        .activities
        .where('office', '==', locals.change.after.get('office'))
        .where('template', '==', 'product')
        .get(),
    ])
    .then((result) => {
      const [
        customerActivitiesQuery,
        productActivitiesQuery,
      ] = result;

      const customerActivitiesBatch = db.batch();
      const productActivitiesBatch = db.batch();

      customerActivitiesQuery.forEach((doc) => {
        customerActivitiesBatch.set(doc.ref, {
          timestamp: serverTimestamp,
          addendumDocRef: null,
        }, {
            merge: true,
          });

        customerActivitiesBatch.set(doc
          .ref
          .collection('Assignees')
          .doc(subscriberPhoneNumber), {
            canEdit: false,
            addToInclude: true,
          });
      });

      /** Adding to product only for DSR */
      if (templateName === 'dsr') {
        productActivitiesQuery.forEach((doc) => {
          productActivitiesBatch.set(doc.ref, {
            timestamp: serverTimestamp,
            addendumDocRef: null,
          }, {
              merge: true,
            });

          productActivitiesBatch.set(doc
            .ref
            .collection('Assignees')
            .doc(subscriberPhoneNumber), {
              canEdit: false,
              addToInclude: true,
            });
        });
      }

      return Promise
        .all([
          customerActivitiesBatch
            .commit(),
          productActivitiesBatch
            .commit(),
        ]);
    })
    .catch(console.error);
};


const handleCanEditRule = (locals, templateDoc) => {
  if (templateDoc.get('canEditRule') !== 'ADMIN') {
    return Promise.resolve();
  }

  const officeId = locals.change.after.get('officeId');
  const subscriberPhoneNumber = locals.change.after.get('attachment.Subscriber.value');

  // TODO: No need to query admin activity. `locals.adminsCanEdit` array is enough for that
  return Promise
    .all([
      rootCollections
        .activities
        .where('template', '==', 'admin')
        .where('attachment.Admin.value', '==', subscriberPhoneNumber)
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', 'admin')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        adminActivitiesQuery,
        adminTemplateQuery,
      ] = result;

      /** User is already an `admin` */
      if (!adminActivitiesQuery.empty) {
        console.log('Already an admin =>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>');

        return Promise.resolve();
      }

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

      const creator = locals.change.after.get('creator');
      const activityName = `ADMIN: ${creator}`;

      const activityData = {
        autoCreated: true,
        addendumDocRef,
        attachment,
        activityName,
        officeId,
        timestamp: serverTimestamp,
        office: locals.change.after.get('office'),
        template: 'admin',
        venue: [],
        schedule: [],
        status: adminTemplateDoc.get('statusOnCreate'),
        canEditRule: adminTemplateDoc.get('canEditRule'),
        hidden: adminTemplateDoc.get('hidden'),
        creator: locals.change.after.get('creator'),
      };

      const subscriptionAddendumDoc = (() => {
        if (!locals.addendumDoc) {
          return {
            location: {
              _latitude: '',
              _longitude: '',
            },
            userDisplayName: null,
            userDeviceTimestamp: serverTimestamp,
          };
        }

        return {
          location: locals.addendumDoc.get('location'),
          userDisplayName: locals.addendumDoc.get('userDisplayName'),
          userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
        };
      })();

      const addendumData = {
        activityData,
        activityName,
        user: creator,
        location: subscriptionAddendumDoc.location,
        userDisplayName: subscriptionAddendumDoc.userDisplayName,
        share: [],
        action: httpsActions.create,
        template: 'admin',
        timestamp: serverTimestamp,
        userDeviceTimestamp: subscriptionAddendumDoc.userDeviceTimestamp,
        activityId: activityRef.id,
        isSupportRequest: false,
      };

      const isAdmin = (phoneNumber) =>
        /** canEditRule for subscription is `ADMIN` */
        locals.adminsCanEdit.includes(phoneNumber)
        || phoneNumber === subscriberPhoneNumber;

      locals.assigneePhoneNumbersArray.forEach((phoneNumber) => {
        const ref = activityRef.collection('Assignees').doc(phoneNumber);

        batch.set(ref, {
          canEdit: isAdmin(phoneNumber),
          addToInclude: true,
        });
      });

      batch.set(activityRef, activityData);
      batch.set(addendumDocRef, addendumData);

      return batch.commit();
    })
    .catch(console.error);
};


const reverseSubscribeToActivities = (locals) => {
  // template is subscription
  const phoneNumber = locals.change.after.get('attachment.Subscriber.value');
  const templateName = locals.change.after.get('attachment.Template.value');
  const office = locals.change.after.get('office');

  const queryTemplateName = (() => {
    if (templateName === 'expense-type') return 'expense claim';

    return `${templateName}-type`;
  })();

  return Promise
    .all([
      rootCollections
        .activities
        .where('template', '==', 'subscription')
        .where('attachment.Template.value', '==', queryTemplateName)
        .where('office', '==', office)
        .get(),
      rootCollections
        .activities
        .where('template', '==', queryTemplateName)
        .where('office', '==', office)
        .get(),
    ])
    .then((result) => {
      const [
        subscriptionActivitiesQuery,
        templateActivitiesQuery,
      ] = result;

      const subscriptionsBatch = db.batch();
      const isAdmin = locals.adminsCanEdit.includes(phoneNumber);

      subscriptionActivitiesQuery.forEach((doc) => {
        subscriptionsBatch.set(doc.ref, {
          timestamp: serverTimestamp,
          addendumDocRef: null,
        }, {
            merge: true,
          });

        const ref = doc.ref.collection('Assignees').doc(phoneNumber);

        subscriptionsBatch.set(ref, {
          addToInclude: true,
          canEdit: isAdmin,
        });
      });

      const templateActivitiesBatch = db.batch();

      templateActivitiesQuery.forEach((doc) => {
        templateActivitiesBatch.set(doc.ref, {
          timestamp: serverTimestamp,
          addendumDocRef: null,
        }, {
            merge: true,
          });

        const ref = doc.ref.collection('Assignees').doc(phoneNumber);

        templateActivitiesBatch.set(ref, {
          addToInclude: true,
          canEdit: isAdmin,
        });
      });

      return Promise
        .all([
          subscriptionsBatch
            .commit(),
          templateActivitiesBatch
            .commit(),
        ]);
    })
    .catch(console.error);
};


const addSubscriptionToUserProfile = (locals, batch) => {
  const templateName = locals.change.after.get('attachment.Template.value');
  const queryTemplateName = (() => {
    if (templateName === 'expense claim') return `expense-type`;

    return `${templateName}-type`;
  })();

  return Promise
    .all([
      /** Fetching template to check the `canEditRule` */
      rootCollections
        .activityTemplates
        .where('name', '==', templateName)
        .limit(1)
        .get(),
      rootCollections
        .offices
        .doc(locals.change.after.get('officeId'))
        .get(),
      rootCollections
        .activities
        .where('office', '==', locals.change.after.get('office'))
        .where('template', '==', queryTemplateName)
        .get(),
    ])
    .then((result) => {
      const [
        templateDocsQuery,
        officeDoc,
        queriedActivities,
      ] = result;

      const templateDoc = templateDocsQuery.docs[0];
      const subscriberPhoneNumber = locals.change.after.get('attachment.Subscriber.value');
      const employeesData = officeDoc.get('employeesData');

      /**
       * This if clause is required. Since the person getting the subscription
       * may or may not be an employee of the office
       */
      if (employeesData && employeesData[subscriberPhoneNumber]) {
        const employeeData = employeesData[subscriberPhoneNumber];
        const subscriptionsArray = employeeData.subscriptions || [];

        subscriptionsArray.push(templateName);

        employeeData.subscriptions = [...new Set(subscriptionsArray)];

        batch.set(officeDoc.ref, {
          employeesData: {
            [subscriberPhoneNumber]: employeeData,
          },
        }, {
            merge: true,
          });
      }

      const include = [];

      locals
        .assigneePhoneNumbersArray
        .forEach((phoneNumber) => {
          // const addToInclude = locals.assigneesMap.get(phoneNumber).addToInclude;

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

      queriedActivities
        .forEach((doc) => {
          const ref = doc.ref.collection('Assignees').doc(subscriberPhoneNumber);

          batch.set(ref, {
            canEdit: false,
            addToInclude: true,
          });

          batch.set(doc.ref, {
            timestamp: serverTimestamp,
            addendumDocRef: null,
          }, {
              merge: true,
            });
        });

      /* eslint-disable */
      return batch
        .commit()
        .then(() => templateDoc);
      /* eslint-enable */
    })
    .then((templateDoc) => handleCanEditRule(locals, templateDoc))
    .then(() => handleSpecialTemplateCases(locals))
    .then(() => reverseSubscribeToActivities(locals))
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

    /**
     * Values not equal to an empty string are `Date` objects.
     * Firestore stores the `Date` as a custom object with two properties
     * `seconds` and `nanoseconds`.
     * To get an actual `Date` object, we use the `toDate()` method
     * on Firestore custom object.
     */
    // if (newEndTime !== '') {
    //   newEndTime = new Date(newEndTime).getTime();
    // }

    // if (newStartTime !== '') {
    //   newStartTime = new Date(newStartTime).getTime();
    // }

    // if (oldEndTime !== '') {
    //   oldEndTime = oldEndTime.toDate().getTime();
    // }

    // if (oldStartTime !== '') {
    //   oldStartTime = oldStartTime.toDate().getTime();
    // }

    if (newEndTime === oldEndTime
      && newStartTime === oldStartTime) return;

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
    const before = locals.change.before;
    const after = locals.change.after;
    const options = { before, after };

    return `${pronoun} updated ${getUpdatedFieldNames(options)}`;
  }

  /** Action is `comment` */
  return locals.addendumDoc.get('comment');
};


const assignToActivities = (locals) => {
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
        .get(),
      rootCollections
        .activities
        .where('office', '==', office)
        .where('template', '==', 'branch')
        .where('attachment.Name.value', '==', branchName)
        .get(),
    ])
    .then((result) => {
      const [
        departmentActivitiesQuery,
        branchActivitiesQuery,
      ] = result;

      const isAdmin = locals.adminsCanEdit.includes(phoneNumber);
      const departmentBatch = db.batch();
      const branchBatch = db.batch();

      departmentActivitiesQuery.forEach((doc) => {
        departmentBatch.set(doc.ref, {
          timestamp: serverTimestamp,
          addendumDocRef: null,
        }, {
            merge: true,
          });

        const ref = doc.ref.collection('Assignees').doc(phoneNumber);

        departmentBatch.set(ref, {
          /** Branch has `canEditRule` `ADMIN` */
          canEdit: isAdmin,
          /** Field `addToInclude` is only false for subscriber */
          addToInclude: true,
        });
      });

      // TODO: Handle > 500 results. Batch will crash otherwise
      branchActivitiesQuery.forEach((doc) => {
        branchBatch.set(doc.ref, {
          timestamp: serverTimestamp,
          addendumDocRef: null,
        }, {
            merge: true,
          });

        const ref = doc.ref.collection('Assignees').doc(phoneNumber);

        branchBatch.set(ref, {
          /** Branch has `canEditRule` `ADMIN` */
          canEdit: isAdmin,
          /** Field `addToInclude` is only false for subscriber */
          addToInclude: true,
        });
      });

      return Promise
        .all([
          departmentBatch
            .commit(),
          branchBatch
            .commit(),
        ]);
    })
    .catch(console.error);
};


const removeFromOffice = (activityDoc) => {
  const {
    status,
    office,
  } = activityDoc.data();

  if (status !== 'CANCELLED') return Promise.resolve();

  const phoneNumber
    = activityDoc.get('attachment.Employee Contact.value');

  const runQuery = (query, resolve, reject) => {
    query
      .get()
      .then((activityDocs) => {
        if (activityDocs.empty) return 0;

        const batch = db.batch();

        activityDocs.forEach((doc) => {
          const template = doc.get('template');

          /**
           * The activity with the template employee is cancelled, and that
           * triggered this function. Not returning in the case of employee
           * will send this function into an infinite loop.
           */
          if (template === 'employee') return;

          if (new Set()
            .add('admin')
            .add('subscription')
            .has(template)) {
            batch.set(doc.ref, {
              timestamp: serverTimestamp,
              status: 'CANCELLED',
              /** Avoids duplicate addendum creation for the activity. */
              addendumDocRef: null,
            }, {
                merge: true,
              });

            return;
          }

          batch.delete(doc
            .ref
            .collection('Assignees')
            .doc(phoneNumber)
          );
        });

        /* eslint-disable */
        return batch
          .commit()
          .then((activityDocs.docs[activityDocs.size - 1]));
        /* eslint-enable */
      })
      .then((lastDoc) => {
        if (!lastDoc) return resolve();

        return process
          .nextTick(() => {
            const startAfter = lastDoc.get('timestamp');
            const newQuery = query.startAfter(startAfter);

            return runQuery(newQuery, resolve, reject);
          });
      })
      .catch(reject);
  };

  const query = rootCollections
    .profiles
    .doc(phoneNumber)
    .collection('Activities')
    .where('office', '==', office)
    .orderBy('timestamp')
    .limit(250);

  return new Promise((resolve, reject) => runQuery(query, resolve, reject))
    .catch(console.error);
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

  batch.set(rootCollections
    .offices
    .doc(officeId), {
      employeesData: {
        [employeeContact]:
          toAttachmentValues(locals.change.after),
      },
    }, {
      merge: true,
    });

  return batch
    .commit()
    .then(() => removeFromOffice(locals.change.after))
    .then(() => assignToActivities(locals))
    .catch(console.error);
};


const addSupplierToOffice = (locals, batch) => {
  const attachment = locals.change.after.get('attachment');
  const supplierName = attachment.Name.value;
  const officeId = locals.change.after.get('officeId');

  batch.set(rootCollections.offices.doc(officeId), {
    suppliersMap: {
      [supplierName]:
        toAttachmentValues(locals.change.after),
    },
  }, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};


const addCustomerToOffice = (locals, batch) => {
  const customerName = locals.change.after.get('attachment.Name.value');

  batch.set(rootCollections
    .offices
    .doc(locals.change.after.get('officeId')), {
      customersMap: {
        [customerName]:
          toAttachmentValues(locals.change.after),
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

  const toUpdateNameMap =
    change.after.get('attachment').hasOwnProperty('Name')
    && change.after.get('template') !== 'office';

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
              uid: null,
            }, {
              merge: true,
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
    .then(() => {
      if (!toUpdateNameMap) return Promise.resolve();

      return rootCollections
        .offices
        .doc(change.after.get('officeId'))
        .get();
    })
    .then((officeDoc) => {
      if (!officeDoc) return Promise.resolve();

      if (locals.change.after.get('template') === 'office') {
        return Promise.resolve();
      }

      batch.set(officeDoc.ref, {
        namesMap: {
          [`${change.after.get('template')}`]: {
            [`${change.after.get('attachment.Name.value')}`]: true,
          },
        },
      }, {
          merge: true,
        });

      return batch;
    })
    .then(() => {
      const template = change.after.get('template');

      console.log({
        activityId,
        template,
        // locals,
        action: locals.addendumDoc ? locals.addendumDoc.get('action') : 'manual update',
      });

      const activityData = change.after.data();
      activityData.timestamp = serverTimestamp;
      activityData.adminsCanEdit = locals.adminsCanEdit;

      const copyTo = (() => {
        const officeRef = rootCollections.offices.doc(change.after.get('officeId'));

        if (template === 'office') {
          /** Office doc doesn't need the `adminsCanEdit` field */
          delete activityData.adminsCanEdit;

          return officeRef;
        }

        return officeRef.collection('Activities').doc(change.after.id);
      })();

      batch.set(copyTo, activityData, { merge: true });

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
    .catch((error) => {
      console.error(error);

      return db
        .collection('CRASHED')
        .doc(change.after.id)
        .set({
          context: {
            before: change.before.data(),
            after: change.after.data(),
          },
        });
    });
};
