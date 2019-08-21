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
  rootCollections,
} = require('../../admin/admin');
const {
  httpsActions,
  dateFormats,
  vowels,
  reportNames,
} = require('../../admin/constants');
const {
  slugify,
  getBranchName,
  adjustedGeopoint,
  getUsersWithCheckIn,
  millitaryToHourMinutes,
  addEmployeeToRealtimeDb,
  getEmployeesMapFromRealtimeDb,
} = require('../../admin/utils');
const {
  toMapsUrl,
} = require('../recipients/report-utils');
const {
  activityName,
  forSalesReport,
  haversineDistance,
} = require('../activity/helper');
const env = require('../../admin/env');
const admin = require('firebase-admin');
const crypto = require('crypto');
const momentTz = require('moment-timezone');
const {
  google
} = require('googleapis');
const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: env.mapsApiKey,
      Promise: Promise,
    });


const getAuth = phoneNumber =>
  auth
    .getUserByPhoneNumber(phoneNumber)
    .catch(() => ({
      phoneNumber,
      uid: null,
      email: '',
      emailVerified: false,
      displayName: '',
    }));


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


const handleAdmin = async locals => {
  const phoneNumber = locals
    .change
    .after
    .get('attachment.Admin.value');
  const status = locals
    .change
    .after
    .get('status');
  const office = locals
    .change
    .after
    .get('office');

  const userRecord = await getAuth(phoneNumber);

  if (!userRecord.uid) {
    return;
  }

  const customClaims = userRecord.customClaims || {};

  customClaims
    .admin = customClaims.admin || [];
  customClaims
    .admin.push(office);
  customClaims
    .admin = Array.from(new Set(customClaims.admin));

  if (status === 'CANCELLED') {
    const index = customClaims.admin.indexOf(office);

    customClaims
      .admin = customClaims.admin.splice(index, 1);
  }

  return auth
    .setCustomUserClaims(userRecord.uid, customClaims);
};


const createAdmin = (locals, adminContact) => {
  if (!adminContact) {
    return Promise.resolve();
  }

  const batch = db.batch();
  const officeId = locals
    .change
    .after
    .get('officeId');
  const activityRef = rootCollections
    .activities
    .doc();
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
    .then(result => {
      const [adminTemplateQuery, adminQuery] = result;

      /** Is already an admin */
      if (!adminQuery.empty) {
        return Promise.resolve();
      }

      const adminTemplateDoc = adminTemplateQuery.docs[0];
      const activityData = {
        office: locals.change.after.get('office'),
        timezone: locals.change.after.get('timezone'),
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
        .forEach(phoneNumber => {
          batch.set(activityRef.collection('Assignees').doc(phoneNumber), {
            canEdit: getCanEditValueForAdminActivity(phoneNumber, adminContact),
            addToInclude: false,
          });
        });

      return batch.commit();
    });
};


const createAutoSubscription = async (locals, templateName, subscriber) => {
  if (!subscriber) {
    return Promise.resolve();
  }

  const office = locals
    .change
    .after
    .get('office');
  const officeId = locals
    .change
    .after
    .get('officeId');
  const batch = db.batch();
  const isArSubscription = templateName === 'attendance regularization';

  const promises = [
    rootCollections
      .activityTemplates
      .where('name', '==', 'subscription')
      .limit(1)
      .get(),
    rootCollections
      .activities
      .where('attachment.Subscriber.value', '==', subscriber)
      .where('attachment.Template.value', '==', templateName)
      .where('office', '==', office)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get()
  ];

  if (isArSubscription) {
    promises.push(rootCollections
      .activities
      .where('office', '==', office)
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', 'recipient')
      .where('attachment.Name.value', '==', 'payroll')
      .limit(1)
      .get());
  }

  try {
    const [
      subscriptionTemplateQuery,
      userSubscriptionQuery,
      payrollRecipientQuery,
    ] = await Promise.all(promises);

    /** Already has the subscription to whatever template that was passed */
    if (!userSubscriptionQuery.empty) {
      return;
    }

    /**
     * AR subscription is automatically given to the employees with office which
     *  has the recipient of payroll
     */
    if (isArSubscription
      && payrollRecipientQuery.empty) {
      return;
    }

    const subscriptionTemplateDoc = subscriptionTemplateQuery
      .docs[0];
    const activityRef = rootCollections
      .activities
      .doc();
    const addendumDocRef = rootCollections
      .offices
      .doc(officeId)
      .collection('Addendum')
      .doc();

    const attachment = subscriptionTemplateDoc
      .get('attachment');
    attachment
      .Subscriber.value = subscriber;
    attachment
      .Template
      .value = templateName;

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
      userDisplayName: locals.change.after.get('creator.displayName'),
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

    batch
      .set(activityRef, activityData);
    batch
      .set(addendumDocRef, addendumDocData);

    locals
      .assigneePhoneNumbersArray
      .forEach(phoneNumber => {
        batch.set(activityRef.collection('Assignees').doc(phoneNumber), {
          /** Subscription's canEditRule is ADMIN */
          canEdit: locals.adminsCanEdit.includes(phoneNumber),
          addToInclude: phoneNumber !== subscriber,
        });
      });

    return batch.commit();
  } catch (error) {
    console.error(error);
  }
};


const handleXTypeActivities = async locals => {
  const typeActivityTemplates = new Set(['customer', 'leave', 'expense claim']);
  const template = locals
    .change
    .after
    .get('template');

  if (template !== 'subscription'
    || !typeActivityTemplates.has(template)) {
    return;
  }

  const officeId = locals
    .change
    .after
    .get('officeId');
  const templateName = (() => {
    const template = locals
      .change
      .after
      .get('attachment.Template.value');

    if (template === 'expense claim') return 'expense-type';

    return `${template}-type`;
  })();

  try {
    const typeActivities = await rootCollections
      .activities
      .where('officeId', '==', officeId)
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', templateName)
      .get();

    const subscriber = locals
      .change
      .after
      .get('attachment.Subscriber.value');

    // if subscription is created/updated
    // fetch all x-type activities from
    // Offices/(officeId)/Activities
    // Put those activities in the subscriber path
    // Profiles/(subscriber)/Activities/{x-type activityId}/
    const batch = db.batch();

    typeActivities.forEach(activity => {
      const activityData = activity.data();

      delete activityData.addendumDocRef;

      /** List of assignee doesn't matter */
      activityData.assignees = activityData.assignees || [];

      const ref = rootCollections
        .profiles
        .doc(subscriber)
        .collection('Activities')
        .doc(activity.id);

      batch.set(ref, activityData, { merge: true });
    });

    return batch.commit();
  } catch (error) {
    console.error(error);
  }
};


const handleCanEditRule = async (locals, templateDoc) => {
  if (templateDoc.get('canEditRule') !== 'ADMIN') {
    return;
  }

  const office = locals
    .change
    .after
    .get('office');
  const status = locals
    .change
    .after
    .get('status');
  const subscriberPhoneNumber = locals.change.after.get('attachment.Subscriber.value');

  try {
    if (status === 'CANCELLED') {
      const userSubscriptions = await rootCollections
        .profiles
        .doc(subscriberPhoneNumber)
        .collection('Subscriptions')
        .where('canEditRule', '==', 'ADMIN')
        .where('status', '==', 'CONFIRMED')
        .where('office', '==', office)
        .get();

      if (!userSubscriptions.empty) return;

      // cancel admin activity for this user
      const adminActivityQueryResult = await rootCollections
        .activities
        .where('status', '==', 'CONFIRMED')
        .where('template', '==', 'admin')
        .where('attachment.Admin.value', '==', subscriberPhoneNumber)
        .where('office', '==', office)
        .limit(1)
        .get();

      if (adminActivityQueryResult.empty) return;

      return adminActivityQueryResult
        .docs[0]
        .ref
        .set({
          status: 'CANCELLED',
          addendumDocRef: null,
        }, {
          merge: true,
        });
    }

    const isAlreadyAdmin = locals
      .adminsCanEdit
      .includes(subscriberPhoneNumber);

    if (isAlreadyAdmin) {
      return;
    }

    return createAdmin(locals, subscriberPhoneNumber);
  } catch (error) {
    console.error(error);
  }
};


const handleCheckInSubscription = async locals => {
  // if check-in subscription has been created
  // Employee should receive locations map
  const template = locals
    .change
    .after
    .get('template');

  if (template !== 'subscription') {
    return;
  }

  const subscribedTemplate = locals
    .change
    .after
    .get('attachment.Template.value');

  if (subscribedTemplate !== 'check-in') {
    return;
  }

  const officeId = locals
    .change
    .after
    .get('officeId');
  const oldSubscriber = locals
    .change
    .before
    .get('attachment.Subscriber.value');
  const newSubscriber = locals
    .change
    .after
    .get('attachment.Subscriber.value');
  const status = locals
    .change
    .after
    .get('status');

  try {
    if (status === 'CANCELLED') {
      return admin
        .database()
        .ref(`${officeId}/check-in/${newSubscriber}`)
        .remove();
    }

    // Subscriber changed, removing
    if (oldSubscriber
      && (oldSubscriber !== newSubscriber)) {
      await admin
        .database()
        .ref(`${officeId}/check-in/${oldSubscriber}`)
        .remove();
    }

    const oldObjectResult = await admin
      .database()
      .ref(`${officeId}/${subscribedTemplate}`)
      .once('value');

    const oldObject = oldObjectResult.val() || {};
    oldObject[newSubscriber] = true;

    return admin
      .database()
      .ref(`${officeId}/check-in`)
      .set(oldObject);
  } catch (error) {
    console.error(error);
  }
};


const handleSubscription = locals => {
  const batch = db.batch();
  const templateName = locals
    .change
    .after
    .get('attachment.Template.value');
  const newSubscriber = locals
    .change
    .after
    .get('attachment.Subscriber.value');
  const oldSubscriber = locals
    .change
    .before
    .get('attachment.Subscriber.value');
  const subscriptionDocRef = rootCollections
    .profiles
    .doc(newSubscriber)
    .collection('Subscriptions')
    .doc(locals.change.after.id);

  return rootCollections
    .activityTemplates
    .where('name', '==', templateName)
    .limit(1)
    .get()
    .then(templateDocsQuery => {
      const templateDoc = templateDocsQuery.docs[0];
      const include = [];
      locals
        .assigneePhoneNumbersArray
        .forEach(phoneNumber => {
          /**
           * The user's own phone number is redundant in the include array since they
           * will be the one creating an activity using the subscription to this activity.
           */
          if (newSubscriber === phoneNumber) return;

          /**
           * For the subscription template, people from
           * the share array are not added to the include array.
           */
          if (!locals.assigneesMap.get(phoneNumber).addToInclude) return;

          include
            .push(phoneNumber);
        });

      batch
        .set(subscriptionDocRef, {
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
          report: templateDoc.get('report') || null,
        });

      /**
       * Delete subscription doc from old profile
       * if the phone number has been changed in the
       * subscription activity.
       */
      const subscriberChanged = locals
        .change
        .before
        .data()
        && oldSubscriber !== newSubscriber;

      if (subscriberChanged) {
        batch
          .delete(rootCollections
            .profiles
            .doc(oldSubscriber)
            .collection('Subscriptions')
            .doc(locals.change.after.id)
          );
      }

      return Promise
        .all([
          batch.commit(),
          handleCheckInSubscription(locals),
          handleCanEditRule(locals, templateDoc),
          handleXTypeActivities(locals)
        ]);
    })
    .catch(console.error);
};


const removeFromOfficeActivities = async locals => {
  const activityDoc = locals.change.after;
  const {
    status,
    office,
  } = activityDoc.data();

  /** Only remove when the status is `CANCELLED` */
  if (status !== 'CANCELLED') {
    return;
  }

  let oldStatus;

  if (locals.change.before.data()) {
    oldStatus = locals
      .change
      .before
      .get('status');
  }

  if (oldStatus
    && oldStatus === 'CANCELLED'
    && status === 'CANCELLED') {
    return;
  }

  const phoneNumber = activityDoc
    .get('attachment.Employee Contact.value');

  const runQuery = (query, resolve, reject) =>
    query
      .get()
      .then(docs => {
        if (docs.empty) {
          return 0;
        }

        const batch = db.batch();

        docs
          .forEach(doc => {
            const template = doc.get('template');
            const activityStatus = doc.get('status');

            /**
             * Not touching the same activity which causes this flow
             * to run. Allowing that will send the activityOnWrite
             * to an infinite spiral.
             */
            if (template === 'employee'
              && doc.id === activityDoc.id) {
              return;
            }

            // No point of recancelling the already cancelled activities.
            if (activityStatus === 'CANCELLED') {
              return;
            }

            const phoneNumberInAttachment = doc
              .get('attachment.Admin.value')
              || doc
                .get('attachment.Subscriber.value');

            // Cancelling admin to remove their custom claims.
            // Cancelling subscription to stop them from
            // creating new activities with that subscription
            if (new Set()
              .add('admin')
              .add('subscription')
              .has(template)
              && phoneNumber === phoneNumberInAttachment) {
              batch
                .set(rootCollections.activities.doc(doc.id), {
                  status: 'CANCELLED',
                  addendumDocRef: null,
                }, {
                  merge: true,
                });

              return;
            }

            batch
              .set(rootCollections
                .activities
                .doc(doc.id), {
                addendumDocRef: null,
                timestamp: Date.now(),
              }, {
                merge: true,
              });

            batch
              .delete(rootCollections
                .activities
                .doc(doc.id)
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

  return new Promise((resolve, reject) => {
    return runQuery(query, resolve, reject);
  })
    .catch(console.error);
};


const handleEmployeeSupervisors = locals => {
  const status = locals.change.after.get('status');

  if (status === 'CANCELLED') {
    return Promise.resolve();
  }

  const employeeContact = locals
    .change
    .after
    .get('attachment.Employee Contact.value');
  const firstSupervisorOld = locals
    .change
    .before
    .get('attachment.First Supervisor.value');
  const secondSupervisorOld = locals
    .change
    .before
    .get('attachment.Second Supervisor.value');
  const thirdSupervisorOld = locals
    .change
    .before
    .get('attachment.Third Supervisor.value');
  const firstSupervisorNew = locals
    .change
    .after
    .get('attachment.First Supervisor.value');
  const secondSupervisorNew = locals
    .change
    .after
    .get('attachment.Second Supervisor.value');
  const thirdSupervisorNew = locals
    .change
    .after
    .get('attachment.Third Supervisor.value');

  if (firstSupervisorOld === firstSupervisorNew
    && secondSupervisorOld === secondSupervisorNew
    && thirdSupervisorOld === thirdSupervisorNew) {
    return Promise.resolve();
  }

  const batch = db.batch();

  return rootCollections
    .activities
    .where('template', '==', 'subscription')
    .where('attachment.Subscriber.value', '==', employeeContact)
    .where('office', '==', locals.change.after.get('office'))
    .get()
    .then(docs => {
      docs.forEach(doc => {
        batch.set(doc.ref, {
          addendumDocRef: null,
        }, {
          merge: true,
        });

        const firstSupervisorChanged = firstSupervisorOld
          && firstSupervisorOld !== firstSupervisorNew;
        const secondSupervisorChanged = secondSupervisorOld
          && secondSupervisorOld !== secondSupervisorNew;
        const thirdSupervisorChanged = thirdSupervisorOld
          && thirdSupervisorOld !== thirdSupervisorNew;

        if (firstSupervisorChanged) {
          batch
            .delete(doc.ref.collection('Assignees').doc(firstSupervisorOld));
        }

        if (secondSupervisorChanged) {
          batch
            .delete(doc.ref.collection('Assignees').doc(secondSupervisorOld));
        }

        if (thirdSupervisorChanged) {
          batch
            .delete(doc.ref.collection('Assignees').doc(thirdSupervisorOld));
        }

        [
          firstSupervisorNew,
          secondSupervisorNew,
          thirdSupervisorNew
        ].filter(Boolean) // Any or all of these values could be empty strings...
          .forEach(phoneNumber => {
            batch.set(doc.ref.collection('Assignees').doc(phoneNumber), {
              canEdit: locals.adminsCanEdit.includes(phoneNumber),
              addToInclude: true,
            });
          });
      });

      return batch.commit();
    })
    .catch(console.error);
};


const createDefaultSubscriptionsForEmployee = locals => {
  const hasBeenCreated = locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;

  if (!hasBeenCreated) return;

  const phoneNumber = locals
    .change
    .after
    .get('attachment.Employee Contact.value');

  return Promise
    .all([
      createAutoSubscription(locals, 'check-in', phoneNumber),
      createAutoSubscription(locals, 'leave', phoneNumber),
      createAutoSubscription(locals, 'attendance regularization', phoneNumber),
    ]);
};


const handleStatusDocs = async locals => {
  const template = locals.change.after.get('template');
  const timezone = locals.change.after.get('timezone');
  const officeId = locals.change.after.get('officeId');
  const employeeContact = locals.change.after.get('attachment.Employee Contact.value');

  const hasBeenCreated = !locals.change.before.data()
    && locals.change.after.data();

  if (template !== 'employee'
    || !hasBeenCreated) return;

  const monthYearString = momentTz()
    .tz(timezone)
    .format(dateFormats.MONTH_YEAR);

  try {
    const statusDoc = await rootCollections
      .offices
      .doc(officeId)
      .collection('Statuses')
      .doc(monthYearString)
      .collection('Employees')
      .doc(employeeContact)
      .get();

    /** Status doc already exists */
    if (statusDoc.exists) return;

    return statusDoc
      .ref
      .set({
        statusObject: {},
      }, {
        merge: true,
      });
  } catch (error) {
    console.error(error);
  }
};


const updatePhoneNumberFields = (doc, oldPhoneNumber, newPhoneNumber, newPhoneNumberAuth) => {
  const result = doc.data();
  const attachment = doc.get('attachment');
  const creator = doc.get('creator');
  result.timestamp = Date.now();
  result.addendumDocRef = null;
  delete result.assignees;

  if (creator === oldPhoneNumber
    || creator.phoneNumber === oldPhoneNumber) {
    result.creator = {
      phoneNumber: newPhoneNumber,
      photoURL: newPhoneNumberAuth.photoURL || '',
      displayName: newPhoneNumberAuth.displayName || '',
    };
  }

  Object
    .keys(attachment)
    .forEach(field => {
      const item = attachment[field];

      if (item.value === oldPhoneNumber) {
        result
          .attachment[field]
          .value = newPhoneNumber;
      }
    });

  return result;
};


const replaceNumberInActivities = async locals => {
  const oldPhoneNumber = locals
    .change
    .before
    .get('attachment.Employee Contact.value');
  const newPhoneNumber = locals
    .change
    .after
    .get('attachment.Employee Contact.value');
  const activityDoc = locals.change.after.id;

  const runQuery = async (query, newPhoneNumberAuth, resolve, reject) => {
    return query
      .get()
      .then(docs => {
        if (docs.empty) {
          return [0];
        }

        const batch = db.batch();

        docs.forEach(doc => {
          const template = doc.get('template');

          /**
           * Not touching the same activity which causes this flow
           * to run. Allowing that will send the activityOnWrite
           * to an infinite spiral.
           */
          if (template === 'employee'
            && doc.id === activityDoc.id) {
            return;
          }

          const activityRef = rootCollections.activities.doc(doc.id);

          batch
            .set(activityRef
              .collection('Assignees')
              .doc(newPhoneNumber), {
              canEdit: doc.get('canEdit'),
              addToInclude: template !== 'subscription',
            }, {
              merge: true,
            });

          // Remove old assignee
          batch
            .delete(activityRef
              .collection('Assignees')
              .doc(oldPhoneNumber)
            );

          const activityData = updatePhoneNumberFields(
            doc,
            oldPhoneNumber,
            newPhoneNumber,
            newPhoneNumberAuth
          );

          // Update the main activity in root `Activities` collection
          batch
            .set(activityRef, activityData, {
              merge: true,
            });
        });

        return Promise
          .all([
            docs.docs[docs.size - 1],
            batch
              .commit()
          ]);
      })
      .then(result => {
        const [lastDoc] = result;

        if (!lastDoc) return resolve();

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
  };

  try {
    const newPhoneNumberAuth = await getAuth(newPhoneNumber);

    const query = rootCollections
      .profiles
      .doc(oldPhoneNumber)
      .collection('Activities')
      .where('office', '==', locals.change.after.get('office'))
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(100);

    return new Promise((resolve, reject) => {
      return runQuery(query, newPhoneNumberAuth, resolve, reject);
    });
  } catch (error) {
    console.error('Auth:', error);
  }
};


const handleEmployee = async locals => {
  const activityDoc = locals.change.after.data();
  activityDoc.id = locals.change.after.id;

  const office = activityDoc.office;
  const officeId = activityDoc.officeId;
  const oldEmployeeContact = locals.change.before.get('attachment.Employee Contact.value');
  const newEmployeeContact = locals.change.after.get('attachment.Employee Contact.value');

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

  const hasBeenCreated = locals
    .addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;
  const batch = db.batch();

  // Change of status from `CONFIRMED` to `CANCELLED`
  if (hasBeenCancelled) {
    employeeOf[office] = admin.firestore.FieldValue.delete();
  }

  let profileData = {};

  if (hasBeenCreated) {
    profileData
      .lastLocationMapUpdateTimestamp = Date.now();
    profileData
      .employeeOf = employeeOf;
  }

  try {
    batch
      .set(rootCollections
        .profiles
        .doc(newEmployeeContact), profileData, {
        merge: true,
      });

    // Phone number changed
    if (oldEmployeeContact
      && oldEmployeeContact !== newEmployeeContact) {
      batch.set(rootCollections.profiles.doc(oldEmployeeContact), {
        employeeOf: {
          [office]: admin.firestore.FieldValue.delete(),
        },
      }, {
        merge: true,
      });

      const path = `${officeId}/employee/${oldEmployeeContact}`;
      const ref = admin
        .database()
        .ref(path);

      await ref.remove();

      const profileDoc = await rootCollections
        .profiles
        .doc(oldEmployeeContact)
        .get();
      const data = profileDoc.data();

      profileData = Object.assign(profileData, data);

      const updatesQueryResult = await rootCollections
        .updates
        .where('phoneNumber', '==', oldEmployeeContact)
        .limit(1)
        .get();

      if (!updatesQueryResult.empty) {
        const updatesDoc = updatesQueryResult.docs[0];
        const removeFromOffice = updatesDoc.get('removeFromOffice') || [];

        removeFromOffice
          .push(office);

        batch
          .set(updatesDoc.ref, {
            removeFromOffice,
          }, {
            merge: true,
          });
      }

      await replaceNumberInActivities(locals);
    }

    await batch.commit();
    await addEmployeeToRealtimeDb(locals.change.after);

    if (hasBeenCancelled) {
      await removeFromOfficeActivities(locals);
    }

    await createDefaultSubscriptionsForEmployee(locals, hasBeenCancelled);
    await handleEmployeeSupervisors(locals);

    return handleStatusDocs(locals);
  } catch (error) {
    console.error(error);
  }
};


const createFootprintsRecipient = async locals => {
  const template = locals
    .change
    .after
    .get('template');

  if (template !== 'office') {
    return;
  }

  const activityRef = rootCollections.activities.doc();
  const officeId = locals.change.after.id;
  const addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .doc();
  const batch = db.batch();

  try {
    const recipientTemplateQueryResult = await rootCollections
      .activityTemplates
      .where('name', '==', 'recipient')
      .get();
    const recipientActivityQueryResult = await rootCollections
      .activities
      .where('template', '==', 'recipient')
      .where('attachment.Name.value', '==', 'footprints')
      .limit(1)
      .get();

    if (!recipientActivityQueryResult.empty) return;

    const attachment = recipientTemplateQueryResult.docs[0].get('attachment');
    attachment.Name.value = 'footprints';

    const activityData = {
      addendumDocRef,
      attachment,
      timezone: locals.change.after.get('attachment.Timezone.value'),
      venue: [],
      schedule: [],
      timestamp: Date.now(),
      status: recipientTemplateQueryResult.docs[0].get('statusOnCreate'),
      office: locals.change.after.get('office'),
      activityName: 'RECIPIENT: FOOTPRINTS REPORT',
      canEditRule: recipientTemplateQueryResult.docs[0].get('canEditRule'),
      template: 'recipient',
      officeId: locals.change.after.id,
      creator: locals.change.after.get('creator'),
      createTimestamp: Date.now(),
      forSalesReport: false,
    };

    const addendumDocData = {
      activityData,
      user: locals
        .change
        .after
        .get('creator')
        .phoneNumber,
      userDisplayName: locals
        .change
        .after
        .get('creator')
        .displayName,
      action: httpsActions.create,
      template: 'recipient',
      isAutoGenerated: true,
      timestamp: Date.now(),
      userDeviceTimestamp: locals
        .addendumDoc
        .get('userDeviceTimestamp'),
      activityId: activityRef.id,
      location: locals
        .addendumDoc
        .get('location'),
      isSupportRequest: locals
        .addendumDoc
        .get('isSupportRequest') || false,
      isAdminRequest: locals
        .addendumDoc
        .get('isAdminRequest') || false,
      geopointAccuracy: null,
      provider: null,
    };

    const firstContact = locals
      .change
      .after
      .get('attachment.First Contact.value');
    const secondContact = locals
      .change
      .after
      .get('attachment.Second Contact.value');

    locals
      .assigneePhoneNumbersArray
      .forEach(phoneNumber => {
        batch.set(activityRef.collection('Assignees').doc(phoneNumber), {
          /** canEditRule is admin */
          canEdit: phoneNumber === firstContact
            || phoneNumber === secondContact,
          addToInclude: false,
        });
      });

    batch
      .set(activityRef, activityData);
    batch
      .set(addendumDocRef, addendumDocData);

    return batch
      .commit();
  } catch (error) {
    console.error(error);
  }
};


const replaceInvalidCharsInOfficeName = office => {
  let result = office
    .toLowerCase();
  const mostCommonTlds = new Set([
    'com',
    'in',
    'co.in',
    'net',
    'org',
    'gov',
    'uk',
  ]);

  mostCommonTlds.forEach(tld => {
    if (!result.endsWith(`.${tld}`)) {
      return;
    }

    result = result
      .replace(`.${tld}`, '');
  });

  return result
    .replace('.', '')
    .replace(',', '')
    .replace('(', '')
    .replace(')', '')
    .replace('ltd', '')
    .replace('limited', '')
    .replace('pvt', '')
    .replace('private', '')
    .trim();
};


/** Uses autocomplete api for predictions */
const getPlaceIds = office => {
  return googleMapsClient
    .placesAutoComplete({
      input: office,
      sessiontoken: crypto.randomBytes(64).toString('hex'),
      components: { country: 'in' },
    })
    .asPromise()
    .then(result => {
      const Ids = [];

      result.json.predictions.forEach(prediction => {
        const { place_id: placeid } = prediction;

        Ids.push(placeid);
      });

      return Ids;
    })
    .catch(console.error);
};


const getPlaceName = placeid => {
  return googleMapsClient
    .place({
      placeid,
      fields: [
        "address_component",
        "adr_address",
        "formatted_address",
        "geometry",
        "name",
        "permanently_closed",
        "place_id",
        "type",
        "vicinity",
        "international_phone_number",
        "opening_hours",
        "website"
      ]
    })
    .asPromise()
    .then(result => {
      const {
        address_components: addressComponents
      } = result.json.result;

      const branchName = getBranchName(addressComponents);
      const branchOffice = {
        placeId: result.json.result['place_id'],
        venueDescriptor: 'Branch Office',
        address: result.json.result['formatted_address'],
        location: branchName,
        geopoint: new admin.firestore.GeoPoint(
          result.json.result.geometry.location.lat,
          result.json.result.geometry.location.lng
        ),
      };

      const weekdayStartTime = (() => {
        const openingHours = result
          .json
          .result['opening_hours'];

        if (!openingHours) {
          return '';
        }

        const periods = openingHours.periods;

        const relevantObject = periods.filter(item => {
          return item.close && item.close.day === 1;
        });

        if (!relevantObject[0]) {
          return '';
        }

        return relevantObject[0].open.time;
      })();

      const weekdayEndTime = (() => {
        const openingHours = result
          .json
          .result['opening_hours'];

        if (!openingHours) {
          return '';
        }

        const periods = openingHours.periods;

        const relevantObject = periods.filter(item => {
          return item.close
            && item.close.day === 1;
        });

        if (!relevantObject[0]) {
          return '';
        }

        return relevantObject[0].close.time;
      })();

      const saturdayStartTime = (() => {
        const openingHours = result
          .json
          .result['opening_hours'];

        if (!openingHours) return '';

        const periods = openingHours.periods;

        const relevantObject = periods.filter(item => {
          return item.open
            && item.open.day === 6;
        });

        if (!relevantObject[0]) {
          return '';
        }

        return relevantObject[0].open.time;
      })();

      const saturdayEndTime = (() => {
        const openingHours = result
          .json
          .result['opening_hours'];

        if (!openingHours) return '';

        const periods = openingHours.periods;

        const relevantObject = periods.filter(item => {
          return item.open
            && item.open.day === 6;
        });

        if (!relevantObject[0]) {
          return '';
        }

        return relevantObject[0].close.time;
      })();

      const weeklyOff = (() => {
        const openingHours = result
          .json
          .result['opening_hours'];

        if (!openingHours) {
          return '';
        }

        const weekdayText = openingHours['weekday_text'];

        if (!weekdayText) {
          return '';
        }

        const closedWeekday = weekdayText
          // ['Sunday: Closed']
          .filter(str => str.includes('Closed'))[0];

        if (!closedWeekday) {
          return '';
        }

        const parts = closedWeekday.split(':');

        if (!parts[0]) {
          return '';
        }

        // ['Sunday' 'Closed']
        return parts[0].toLowerCase();
      })();

      const schedulesArray = Array.from(Array(15)).map((_, index) => {
        return {
          name: `Holiday ${index + 1}`,
          startTime: '',
          endTime: '',
        };
      });

      const activityObject = {
        // All assignees from office creation instance
        venue: [branchOffice],
        schedule: schedulesArray,
        attachment: {
          'Name': {
            value: branchName,
            type: 'string',
          },
          'First Contact': {
            value: '',
            type: 'phoneNumber',
          },
          'Second Contact': {
            value: '',
            type: 'phoneNumber',
          },
          'Branch Code': {
            value: '',
            type: 'string',
          },
          'Weekday Start Time': {
            value: millitaryToHourMinutes(weekdayStartTime),
            type: 'HH:MM',
          },
          'Weekday End Time': {
            value: millitaryToHourMinutes(weekdayEndTime),
            type: 'HH:MM',
          },
          'Saturday Start Time': {
            value: millitaryToHourMinutes(saturdayStartTime),
            type: 'HH:MM',
          },
          'Saturday End Time': {
            value: millitaryToHourMinutes(saturdayEndTime),
            type: 'HH:MM',
          },
          'Weekly Off': {
            value: weeklyOff,
            type: 'weekday',
          },
        },
      };

      return activityObject;
    })
    .catch(console.error);
};


const createAutoBranch = (branchData, locals, branchTemplateDoc) => {
  const batch = db.batch();
  const activityRef = rootCollections
    .activities
    .doc();
  const officeId = locals
    .change
    .after
    .get('officeId');
  const addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .doc();

  const gp = adjustedGeopoint(branchData.venue[0].geopoint);

  const activityData = {
    officeId,
    addendumDocRef,
    template: 'branch',
    status: branchTemplateDoc.get('statusOnCreate'),
    hidden: branchTemplateDoc.get('hidden'),
    createTimestamp: Date.now(),
    forSalesReport: forSalesReport('branch'),
    schedule: branchData.schedule,
    venue: branchData.venue,
    attachment: branchData.attachment,
    canEditRule: branchTemplateDoc.get('canEditRule'),
    timezone: locals.change.after.get('timezone'),
    timestamp: Date.now(),
    office: locals.change.after.get('office'),
    activityName: activityName({
      attachmentObject: branchData.attachment,
      templateName: 'branch',
      requester: locals.change.after.get('creator'),
    }),
    adjustedGeopoints: `${gp.latitude},${gp.longitude}`,
    creator: locals.change.after.get('creator'),
  };

  const addendumDocData = {
    activityData,
    timezone: locals.change.after.get('timezone'),
    user: locals.change.after.get('creator.phoneNumber'),
    userDisplayName: locals.change.after.get('creator.displayName'),
    action: httpsActions.create,
    template: activityData.template,
    userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
    activityId: activityRef.id,
    activityName: activityData.activityName,
    isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
    geopointAccuracy: locals.addendumDoc.get('geopointAccuracy'),
    provider: locals.addendumDoc.get('provider'),
    location: locals.addendumDoc.get('location'),
  };

  locals
    .assigneePhoneNumbersArray.forEach(phoneNumber => {
      batch
        .set(activityRef
          .collection('Assignees')
          .doc(phoneNumber), {
          canEdit: true,
          addToInclude: false,
        });
    });

  batch
    .set(activityRef, activityData);
  batch
    .set(addendumDocRef, addendumDocData);

  return batch
    .commit();
};


const createBranches = async locals => {
  const template = locals.change.after.get('template');
  const hasBeenCreated = locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;

  if (template !== 'office'
    || !hasBeenCreated) {
    return;
  }

  let failureCount = 0;

  const getBranchBodies = async office => {
    return getPlaceIds(office)
      .then(ids => {
        const promises = [];

        if (ids.length === 0) {
          failureCount++;

          if (failureCount > 1) {
            // Has failed once with the actual office name
            // and 2nd time even by replacing invalid chars
            // Give up.

            return Promise
              .all(promises);
          }

          const filteredOfficeName = replaceInvalidCharsInOfficeName(office);

          return getBranchBodies(filteredOfficeName);
        }

        ids
          .forEach(id => {
            promises
              .push(getPlaceName(id));
          });

        return Promise
          .all(promises);
      })
      .catch(console.error);
  };

  const office = locals
    .change
    .after
    .get('office');

  return Promise
    .all([
      getBranchBodies(office),
      rootCollections
        .activityTemplates
        .where('name', '==', 'branch')
        .limit(1)
        .get()
    ])
    .then(result => {
      const [
        branches,
        templateQuery
      ] = result;
      const templateDoc = templateQuery.docs[0];
      const promises = [];

      branches
        .forEach(branch => {
          promises
            .push(
              createAutoBranch(branch, locals, templateDoc)
            );
        });

      return Promise.all(promises);
    })
    .catch(console.error);
};


const mangeYouTubeDataApi = async locals => {
  const template = locals.change.after.get('template');

  if (template !== 'office'
    || !env.isProduction) {
    return;
  }

  try {
    const youtube = google.youtube('v3');
    const auth = await google.auth.getClient({
      credentials: require('../../admin/cert.json'),
      scopes: [
        'https://www.googleapis.com/auth/youtube.force-ssl',
        'https://www.googleapis.com/auth/youtube'
      ],
    });

    const youtubeVideoId = locals
      .change
      .after
      .get('attachment.Youtube ID.value');

    if (!youtubeVideoId) {
      return;
    }

    const oldTitle = locals
      .change
      .before
      .get('office');
    const newTitle = locals
      .change
      .after
      .get('office');
    const oldDescription = locals
      .change
      .before
      .get('attachment.Description.value');
    const newDescription = locals
      .change
      .after
      .get('attachment.Description.value');

    if (oldTitle === newTitle
      && oldDescription === newDescription) {
      return;
    }

    const opt = {
      auth,
      part: 'snippet',
      requestBody: {
        id: youtubeVideoId,
        snippet: {
          categoryId: 22, // People & Blogs
          title: newTitle,
          description: newDescription,
        },
      },
    };

    return youtube.videos.update(opt);
  } catch (error) {
    console.error(error);
  }
};


const handleSitemap = async locals => {
  try {
    const path = 'sitemap';
    const sitemapObject = await admin
      .database()
      .ref(path)
      .once('value');
    const sitemap = sitemapObject
      .val() || {};
    const office = locals
      .change
      .after
      .get('office');

    sitemap[
      slugify(office)
    ] = {
        office: locals.change.after.get('office'),
        lastMod: locals.change.after.updateTime.toDate().toJSON(),
        createTime: locals.change.after.createTime.toDate().toJSON(),
      };

    return admin
      .database()
      .ref(path)
      .set(sitemap);
  } catch (error) {
    console.error(error);
  }
};


const handleOffice = async locals => {
  const template = locals
    .change
    .after
    .get('template');
  const hasBeenCreated = locals
    .addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;

  if (template !== 'office'
    || !hasBeenCreated) {
    return;
  }

  const firstContact = locals
    .change
    .after
    .get('attachment.First Contact.value');
  const secondContact = locals
    .change
    .after
    .get('attachment.Second Contact.value');

  await createFootprintsRecipient(locals);
  await createAutoSubscription(locals, 'subscription', firstContact);
  await createAutoSubscription(locals, 'subscription', secondContact);
  await createBranches(locals);
  await handleSitemap(locals);

  return mangeYouTubeDataApi(locals);
};


const setLocationsReadEvent = async locals => {
  const officeId = locals
    .change
    .after
    .get('officeId');
  const timestamp = Date
    .now();

  if (locals.change.after.get('status') === 'CANCELLED') {
    return;
  }

  try {
    let docsCounter = 0;
    let batchIndex = 0;

    const phoneNumbersArray = await getUsersWithCheckIn(officeId);
    let numberOfDocs = phoneNumbersArray.length;
    const numberOfBatches = Math.round(Math.ceil(numberOfDocs / 500));
    const batchArray = Array.from(Array(numberOfBatches)).map(() => db.batch());

    phoneNumbersArray
      .forEach(phoneNumber => {
        docsCounter++;

        if (docsCounter > 499) {
          docsCounter = 0;
          batchIndex++;
        }

        batchArray[
          batchIndex
        ].set(rootCollections
          .profiles
          .doc(phoneNumber), {
          lastLocationMapUpdateTimestamp: timestamp,
        }, {
          merge: true,
        });
      });

    const commitBatch = async batch => {
      return process
        .nextTick(() => batch.commit());
    };

    return batchArray
      .reduce(async (accumulatorPromise, currentBatch) => {
        await accumulatorPromise;

        return commitBatch(currentBatch);
      }, Promise.resolve());
  } catch (error) {
    console.error(error);
  }
};


const handleLocations = locals => {
  const rtdb = admin
    .database();
  const officeId = locals
    .change
    .after
    .get('officeId');
  const path = `${officeId}/locations/${locals.change.after.id}`;

  if (locals.change.after.get('status') === 'CANCELLED') {
    return Promise
      .all([
        rtdb
          .ref(path)
          .remove(),
        setLocationsReadEvent(locals),
      ]);
  }

  const venue = locals
    .change
    .after
    .get('venue');

  if (!venue
    || !venue[0]
    || !venue[0].location) {
    return;
  }

  const oldVenue = locals
    .change
    .before
    .get('venue');
  const newVenue = locals
    .change
    .after
    .get('venue');

  if (oldVenue && newVenue) {
    const updatesArray = getUpdatedVenueDescriptors(newVenue, oldVenue);

    if (!updatesArray.length) {
      return;
    }
  }

  const data = {
    officeId,
    activityId: locals.change.after.id,
    timestamp: Date.now(),
    office: locals.change.after.get('office'),
    latitude: venue[0].geopoint.latitude,
    longitude: venue[0].geopoint.longitude,
    venueDescriptor: venue[0].venueDescriptor,
    location: venue[0].location,
    address: venue[0].address,
    template: locals.change.after.get('template'),
    status: locals.change.after.get('status'),
  };

  return Promise
    .all([
      rtdb
        .ref(path)
        .set(data),
      setLocationsReadEvent(locals)
    ]);
};


const handleBranch = async locals => {
  const office = locals
    .change
    .after
    .get('office');
  const branchName = locals.change.after.get('attachment.Name.value');

  try {
    const employees = await rootCollections
      .activities
      .where('template', '==', 'employee')
      .where('status', '==', 'CONFIRMED')
      .where('office', '==', office)
      .where('attachment.Branch.value', '==', branchName)
      .get();

    const promises = [];

    employees
      .forEach(employee => {
        promises
          .push(
            addEmployeeToRealtimeDb(employee)
          );
      });

    return Promise
      .all(promises);
  } catch (error) {
    console.error(error);
  }
};


const handleRecipient = async locals => {
  const batch = db.batch();
  const recipientsDocRef = rootCollections
    .recipients
    .doc(locals.change.after.id);

  if (locals.addendumDoc
    && locals.addendumDoc.get('action')
    === httpsActions.comment) {
    return;
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
    batch
      .delete(recipientsDocRef);
  }

  try {
    await batch.commit();

    /**
     * If a recipient activity is created with
     * attachment.Name.value === 'payroll',
     * all employees of the office should get
     * the subscription of attendance regularization
     */
    const officeId = locals
      .change
      .after
      .get('officeId');

    if (locals.change.after.get('attachment.Name.value') === 'payroll') {
      const employees = await getEmployeesMapFromRealtimeDb(officeId);
      const promises = [];
      const phoneNumbers = Object.keys(employees);

      phoneNumbers
        .forEach(phoneNumber => {
          const promise = createAutoSubscription(
            locals,
            'attendance regularization',
            phoneNumber
          );

          promises
            .push(promise);
        });

      return Promise
        .all(promises);
    }

  } catch (error) {
    console.error(error);
  }
};


const createNewProfiles = async newProfilesMap => {
  const profileBatch = db.batch();
  const profilePromises = [];

  newProfilesMap
    .forEach((_, phoneNumber) => {
      const promise = rootCollections
        .profiles
        .doc(phoneNumber)
        .get();

      profilePromises.push(promise);
    });

  const snap = await Promise.all(profilePromises);

  snap.forEach(doc => {
    /** Profile already exists */
    if (doc.exists) return;

    const phoneNumber = doc.id;

    profileBatch.set(doc.ref, {
      smsContext: newProfilesMap.get(phoneNumber),
    }, {
      merge: true,
    });
  });

  return profileBatch.commit();
};


const getCopyPath = (template, officeId, activityId) => {
  if (template === 'office') {
    return rootCollections
      .offices
      .doc(activityId);
  }

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Activities')
    .doc(activityId);
};


/**
* Checks if the action was a comment.
* @param {string} action Can be one of the activity actions from HTTPS functions.
* @returns {number} 0 || 1 depending on whether the action was a comment or anything else.
*/
const isComment = action => {
  // Making this a closure since this function is not going to be used anywhere else.
  if (action === httpsActions.comment) {
    return 1;
  }

  return 0;
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
    before: activityOld,
    after: activityNew,
  } = options;
  const oldSchedule = activityOld.schedule;
  const oldVenue = activityOld.venue;
  const oldAttachment = activityOld.attachment;
  const newSchedule = activityNew.get('schedule');
  const newVenue = activityNew.get('venue');
  const newAttachment = activityNew.get('attachment');

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

  if (addendumCreator === recipient) {
    return 'You';
  }

  if (assigneesMap.get(addendumCreator)
    && assigneesMap.get(addendumCreator).displayName) {
    return assigneesMap.get(addendumCreator).displayName;
  }

  if (!assigneesMap.get(addendumCreator)
    && !locals.addendumCreatorInAssignees) {
    return locals.addendumCreator.displayName;
  }

  /**
   * People are denoted with their phone numbers unless
   * the person creating the addendum is the same as the one
   * receiving it.
   */
  return addendumCreator;
};


const getCreateActionComment = (template, pronoun, locationFromVenue) => {
  const templateNameFirstCharacter = template[0];
  const article = vowels.has(templateNameFirstCharacter) ? 'an' : 'a';

  if (template === 'check-in'
    && locationFromVenue) {
    return `${pronoun} checked in from ${locationFromVenue}`;
  }

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
  const template = locals.addendumDoc.get('activityData.template');

  if (locals.addendumDoc.get('cancellationMessage')) {
    return locals.addendumDoc.get('cancellationMessage');
  }

  if (action === httpsActions.create) {
    const locationFromVenue = (() => {
      if (template !== 'check-in') return null;

      if (locals.addendumDocData.activityData
        && locals.addendumDocData.activityData.venue
        && locals.addendumDocData.activityData.venue[0]
        && locals.addendumDocData.activityData.venue[0].location) {
        return locals.addendumDocData.activityData.venue[0].location;
      }

      if (locals.addendumDocData.venueQuery) {
        return locals.addendumDocData.venueQuery.location;
      }

      return locals.addendumDocData.identifier;
    })();

    return getCreateActionComment(template, pronoun, locationFromVenue);
  }

  if (action === httpsActions.changeStatus) {
    return getChangeStatusComment(
      locals.addendumDoc.get('status'),
      locals.addendumDoc.get('activityData.activityName'),
      pronoun
    );
  }

  if (action === httpsActions.share) {
    const share = locals.addendumDoc.get('share');
    let str = `${pronoun} added`;

    if (share.length === 1) {
      let name = locals.assigneesMap.get(share[0]).displayName || share[0];

      if (share[0] === recipient) name = 'you';

      return str += ` ${name}`;
    }

    /** The `share` array will never have the `user` themselves */
    share
      .forEach((phoneNumber, index) => {
        let name = locals
          .assigneesMap.get(phoneNumber).displayName || phoneNumber;

        if (phoneNumber === recipient) {
          name = 'you';
        }

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
      before: locals.addendumDoc.get('activityOld'),
      after: locals.activityNew,
    };

    return `${pronoun} updated ${getUpdatedFieldNames(options)}`;
  }

  if (action === httpsActions.updatePhoneNumber) {
    return `Phone number`
      + ` '${locals.addendumDoc.get('oldPhoneNumber')} was`
      + ` changed to ${locals.addendumDoc.get('newPhoneNumber')}`;
  }

  /** Action is `comment` */
  return locals.addendumDoc.get('comment');
};


const handleComments = async (addendumDoc, locals) => {
  const batch = db.batch();

  if (!addendumDoc) return;

  locals
    .assigneePhoneNumbersArray
    .forEach(phoneNumber => {
      const userRecord = locals.assigneesMap.get(phoneNumber);

      if (!userRecord.uid) return;

      const comment = getCommentString(locals, phoneNumber);

      console.log(phoneNumber, comment);

      batch.set(rootCollections
        .updates
        .doc(userRecord.uid)
        .collection('Addendum')
        .doc(addendumDoc.id), {
        comment,
        activityId: locals.change.after.id,
        isComment: isComment(addendumDoc.get('action')),
        timestamp: addendumDoc.get('userDeviceTimestamp'),
        location: addendumDoc.get('location'),
        user: addendumDoc.get('user'),
      });
    });

  return batch.commit();
};


const handleDailyStatusReport = async addendumDoc => {
  if (!env.isProduction) return;

  const batch = db.batch();

  const getValue = (snap, field) => {
    if (snap.empty) {
      return 0;
    }

    return snap.docs[0].get(field) || 0;
  };

  const office = addendumDoc.get('activityData.office');
  const action = addendumDoc.get('action');
  const isSupportRequest = addendumDoc.get('isSupportRequest');
  const isAdminRequest = addendumDoc.get('isAdminRequest');
  const isAutoGenerated = addendumDoc.get('isAutoGenerated');
  const template = addendumDoc.get('activityData.template');
  const momentToday = momentTz().toObject();

  const [
    todayInitQuery,
    counterDocsQuery,
  ] = await Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', momentToday.date)
        .where('month', '==', momentToday.months)
        .where('year', '==', momentToday.years)
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('report', '==', reportNames.COUNTER)
        .limit(1)
        .get(),
    ]);

  const initDocRef = (snapShot) => {
    if (snapShot.empty) {
      return rootCollections.inits.doc();
    }

    return snapShot.docs[0].ref;
  };

  const initDoc = initDocRef(todayInitQuery);
  let totalActivities = counterDocsQuery.docs[0].get('totalActivities');
  let totalCreatedWithAdminApi = counterDocsQuery.docs[0].get('totalCreatedWithAdminApi');
  let totalCreatedWithClientApi = counterDocsQuery.docs[0].get('totalCreatedWithClientApi');
  let totalCreatedWithSupport = counterDocsQuery.docs[0].get('totalCreatedWithSupport');
  const supportMap = counterDocsQuery.docs[0].get('supportMap');
  const autoGeneratedMap = counterDocsQuery.docs[0].get('autoGeneratedMap');
  const totalByTemplateMap = counterDocsQuery.docs[0].get('totalByTemplateMap');
  const adminApiMap = counterDocsQuery.docs[0].get('adminApiMap');

  let activitiesAddedToday = getValue(todayInitQuery, 'activitiesAddedToday');
  let withAdminApi = getValue(todayInitQuery, 'withAdminApi');
  let autoGenerated = getValue(todayInitQuery, 'autoGenerated');
  let withSupport = getValue(todayInitQuery, 'withSupport');
  let createApi = getValue(todayInitQuery, 'createApi');
  let updateApi = getValue(todayInitQuery, 'updateApi');
  let changeStatusApi = getValue(todayInitQuery, 'changeStatusApi');
  let shareApi = getValue(todayInitQuery, 'shareApi');
  let commentApi = getValue(todayInitQuery, 'commentApi');

  const createCountByOffice = (() => {
    if (todayInitQuery.empty) {
      return {};
    }

    return todayInitQuery.docs[0].get('createCountByOffice') || {};
  })();

  if (action === httpsActions.create) {
    totalActivities++;
    activitiesAddedToday++;
    createApi++;

    if (!isSupportRequest && !isAdminRequest) {
      totalCreatedWithClientApi++;
    }

    if (totalByTemplateMap[template]) {
      totalByTemplateMap[template]++;
    } else {
      totalByTemplateMap[template] = 1;
    }

    if (createCountByOffice[office]) {
      createCountByOffice[office]++;
    } else {
      createCountByOffice[office] = 1;
    }
  }

  if (action === httpsActions.update) {
    updateApi++;
  }

  if (action === httpsActions.changeStatus) {
    changeStatusApi++;
  }

  if (action === httpsActions.share) {
    shareApi++;
  }

  if (action === httpsActions.comment) {
    commentApi++;
  }

  if (isSupportRequest) {
    withSupport++;
    totalCreatedWithSupport++;

    if (supportMap[template]) {
      supportMap[template]++;
    } else {
      supportMap[template] = 1;
    }
  }

  if (isAutoGenerated) {
    autoGenerated++;

    if (autoGeneratedMap[template]) {
      autoGeneratedMap[template]++;
    } else {
      autoGeneratedMap[template] = 1;
    }
  }

  if (isAdminRequest && !isSupportRequest) {
    // Support requests on admin resource does not count
    // towards this count.
    withAdminApi++;
    totalCreatedWithAdminApi++;

    if (adminApiMap[template]) {
      adminApiMap[template]++;
    } else {
      adminApiMap[template] = 1;
    }
  }

  const dataObject = (() => {
    if (todayInitQuery.empty) return {};

    return todayInitQuery.docs[0].data() || {};
  })();

  dataObject.totalActivities = totalActivities;
  dataObject.activitiesAddedToday = activitiesAddedToday;
  dataObject.withAdminApi = withAdminApi;
  dataObject.autoGenerated = autoGenerated;
  dataObject.withSupport = withSupport;
  dataObject.createApi = createApi;
  dataObject.updateApi = updateApi;
  dataObject.changeStatusApi = changeStatusApi;
  dataObject.shareApi = shareApi;
  dataObject.commentApi = commentApi;
  dataObject.report = reportNames.DAILY_STATUS_REPORT;
  dataObject.date = new Date().getDate();
  dataObject.month = new Date().getMonth();
  dataObject.year = new Date().getFullYear();
  dataObject.createCountByOffice = createCountByOffice;

  if (!dataObject.templateUsageObject) {
    dataObject.templateUsageObject = {};
  }

  if (!dataObject.templateUsageObject[template]) {
    dataObject.templateUsageObject[template] = {};
  }

  if (!dataObject.templateUsageObject[template][action]) {
    dataObject.templateUsageObject[template][action] = 0;
  }

  dataObject.templateUsageObject[template][action] =
    dataObject.templateUsageObject[template][action] + 1;

  batch.set(initDoc, dataObject, { merge: true });

  // Counter always exists because it has been created manually
  // for storing counts of stuff...
  batch.set(counterDocsQuery.docs[0].ref, {
    totalActivities,
    adminApiMap,
    autoGeneratedMap,
    supportMap,
    totalByTemplateMap,
    totalCreatedWithAdminApi,
    totalCreatedWithClientApi,
    totalCreatedWithSupport,
  }, {
    merge: true,
  });

  return batch.commit();
};


const getAccuracyTolerance = accuracy => {
  if (accuracy && accuracy < 350) {
    return 500;
  }

  return 1000;
};


const checkDistanceAccurate = (addendumDoc, activityDoc) => {
  /** User's current location */
  const geopointOne = {
    _latitude: addendumDoc.get('location')._latitude,
    _longitude: addendumDoc.get('location')._longitude,
    accuracy: addendumDoc.get('geopointAccuracy'),
  };
  const venue = addendumDoc.get('activityData.venue')[0];
  const distanceTolerance = getAccuracyTolerance(geopointOne.accuracy);

  if (venue && venue.location) {
    /** Location that the user selected */
    const geopointTwo = {
      _latitude: venue.geopoint._latitude,
      _longitude: venue.geopoint._longitude,
    };

    const distanceBetween = haversineDistance(geopointOne, geopointTwo);

    return distanceBetween < distanceTolerance;
  }

  // Activity created from an unknown location
  if (!activityDoc) {
    return false;
  }

  const venueFromActivity = activityDoc.get('venue')[0];
  const geopointTwo = {
    _latitude: venueFromActivity.geopoint._latitude,
    _longitude: venueFromActivity.geopoint._longitude,
  };

  const distanceBetween = haversineDistance(geopointOne, geopointTwo);

  return distanceBetween < distanceTolerance;
};


const getLocationUrl = plusCode =>
  `https://plus.codes/${plusCode}`;


const getPlaceInformation = (mapsApiResult, geopoint) => {
  const value = toMapsUrl(geopoint);

  if (!mapsApiResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const firstResult = mapsApiResult.json.results[0];

  if (!firstResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const plusCode = mapsApiResult.json['plus_code']['global_code'];

  return {
    identifier: firstResult['formatted_address'],
    url: getLocationUrl(plusCode),
  };
};


const getLatLngString = location =>
  `${location._latitude},${location._longitude}`;


const getLocalityCityState = components => {
  let locality = '';
  let city = '';
  let state = '';

  components.forEach(component => {
    if (component.types.includes('locality')) {
      locality = component.long_name;
    }

    if (component.types.includes('administrative_area_level_2')) {
      city = component.long_name;
    }

    if (component.types.includes('administrative_area_level_1')) {
      state = component.long_name;
    }
  });

  return { locality, city, state };
};

const handleAddendum = async locals => {
  const addendumDoc = locals.addendumDoc;

  if (!addendumDoc) return;

  const action = addendumDoc.get('action');
  const phoneNumber = addendumDoc.get('user');
  const momentWithOffset = momentTz()
    .tz(addendumDoc.get('activityData.timezone') || 'Asia/Kolkata');

  let previousGeopoint;

  const isSkippableEvent = action === httpsActions.install
    || action === httpsActions.signup
    || action === httpsActions.branchView
    || action === httpsActions.productView
    || action === httpsActions.videoPlay
    || action === httpsActions.updatePhoneNumber;

  if (isSkippableEvent) {
    return addendumDoc
      .ref
      .set({
        date: momentWithOffset.date(),
        month: momentWithOffset.month(),
        year: momentWithOffset.year(),
      }, {
        merge: true,
      });
  }

  const geopoint = addendumDoc
    .get('location');
  const gp = adjustedGeopoint(geopoint);
  const batch = db
    .batch();

  const [
    addendumQuery,
    adjustedGeopointQueryResult
  ] = await Promise
    .all([
      rootCollections
        .offices
        .doc(addendumDoc.get('activityData.officeId'))
        .collection('Addendum')
        .where('user', '==', phoneNumber)
        .orderBy('timestamp', 'desc')
        .limit(2)
        .get(),
      rootCollections
        .activities
        // Branch, and customer
        .where('office', '==', addendumDoc.get('activityData.office'))
        .where('status', '==', 'CONFIRMED')
        .where('adjustedGeopoints', '==', `${gp.latitude},${gp.longitude}`)
        .limit(1)
        .get()
    ]);

  const activityDoc = adjustedGeopointQueryResult
    .docs[0];

  let previousAddendumDoc = (() => {
    if (addendumQuery.docs[0]
      && addendumQuery.docs[0].id !== addendumDoc.id) {
      return addendumQuery.docs[0];
    }

    return addendumQuery.docs[1];
  })();

  const currentGeopoint = addendumDoc
    .get('location');

  const promises = [
    googleMapsClient
      .reverseGeocode({
        latlng: getLatLngString(currentGeopoint),
      })
      .asPromise(),
  ];

  if (previousAddendumDoc) {
    /** Could be undefined for install or signup events in the previous addendum */
    previousGeopoint = previousAddendumDoc
      .get('location')
      || currentGeopoint;

    promises
      .push(googleMapsClient
        .distanceMatrix({
          /**
           * Ordering is important here. The `legal` distance
           * between A to B might not be the same as the legal
           * distance between B to A. So, do not mix the ordering.
           */
          origins: getLatLngString(previousGeopoint),
          destinations: getLatLngString(currentGeopoint),
          units: 'metric',
        })
        .asPromise());
  }

  const [
    mapsApiResult,
    distanceMatrixApiResult,
  ] = await Promise
    .all(promises);

  const placeInformation = getPlaceInformation(
    mapsApiResult,
    currentGeopoint
  );

  if (mapsApiResult.json.results.length > 0) {
    const components = mapsApiResult.json.results[0].address_components;
    const {
      city,
      state,
      locality,
    } = getLocalityCityState(components);

    locals
      .city = city;
    locals
      .state = state;
    locals
      .locality = locality;
  }

  const distanceData = (() => {
    if (!locals.previousAddendumDoc) {
      return {
        accumulatedDistance: 0,
        distanceTravelled: 0,
      };
    }

    const value = (() => {
      const distanceData = distanceMatrixApiResult
        .json
        .rows[0]
        .elements[0]
        .distance;

      // maps api result in meters
      if (distanceData) {
        return distanceData.value / 1000;
      }

      const result = haversineDistance(previousGeopoint, currentGeopoint);

      // in KM
      return result;
    })();

    const accumulatedDistance = Number(
      locals.previousAddendumDoc.get('accumulatedDistance') || 0
    )
      // value is in meters
      + value;

    return {
      accumulatedDistance: accumulatedDistance.toFixed(2),
      distanceTravelled: value,
    };
  })();

  const updateObject = {
    city: locals.city,
    state: locals.state,
    locality: locals.locality,
    url: placeInformation.url,
    identifier: placeInformation.identifier,
    distanceTravelled: distanceData.distanceTravelled,
    date: momentWithOffset.date(),
    month: momentWithOffset.month(),
    year: momentWithOffset.year(),
    adjustedGeopoint: adjustedGeopoint(addendumDoc.get('location')),
    distanceAccurate: checkDistanceAccurate(
      addendumDoc,
      activityDoc
    ),
  };

  if (activityDoc
    && activityDoc.get('venue')[0]
    && activityDoc.get('venue')[0].location) {
    updateObject
      .venueQuery = activityDoc.get('venue')[0];
  }

  if (addendumDoc.get('activityData.venue')
    && addendumDoc.get('activityData.venue')[0]
    && addendumDoc.get('activityData.venue')[0].location === '') {
    batch
      .set(rootCollections
        .profiles
        .doc(phoneNumber), {
        lastLocationMapUpdateTimestamp: Date.now(),
      }, {
        merge: true,
      });
  }

  // Required for comment creation since the addendumDoc.data() won't contain
  // the updates made during this function instance
  locals
    .addendumDocData = Object.assign(
      {},
      addendumDoc.data(),
      updateObject
    );

  console.log(JSON.stringify({
    phoneNumber,
    updateObject,
    currPath: addendumDoc
      .ref
      .path,
    prevPath: locals
      .previousAddendumDoc ? locals
        .previousAddendumDoc
        .ref
        .path : null,
  }, ' ', 2));

  /**
   * Seperating this part out because handling even a single crash
   * with `addendumOnCreate` cloud function messes up whole data for the user
   * after the time of the crash.
   */
  batch.set(addendumDoc.ref, updateObject, {
    merge: true,
  });

  await batch.commit();
  // locals.activityNew = '';
  await handleComments(addendumDoc, locals);

  return handleDailyStatusReport(addendumDoc);
};


module.exports = async (change, context) => {
  /** Activity was deleted. For debugging only. */
  if (!change.after.data()) {
    return;
  }

  // employee
  // status change
  // created
  // updated -> sv change, branch change, phone number change
  // office
  // cancelled, create, update, first contact, second contact
  // handle recipient
  // handle subscription
  // old and new subscriber
  // branch and customer in rtdb
  // admin -> custom claim
  // profile and activities
  // const activityId = context.params.activityId;
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

  const newProfilesMap = new Map();
  const promises = [
    rootCollections
      .activities
      .doc(context.params.activityId)
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

  try {
    const [
      assigneesSnapShot,
      adminsSnapShot,
      addendumDoc,
    ] = await Promise
      .all(promises);

    const allAdminPhoneNumbersSet = new Set(
      adminsSnapShot
        .docs
        .map(doc => doc.get('attachment.Admin.value'))
    );

    if (addendumDoc) {
      locals
        .addendumDoc = addendumDoc;
    }

    const authFetch = [];

    assigneesSnapShot.forEach(doc => {
      if (addendumDoc
        && doc.id === addendumDoc.get('user')) {
        locals
          .addendumCreatorInAssignees = true;
      }

      if (allAdminPhoneNumbersSet.has(doc.id)) {
        locals
          .adminsCanEdit
          .push(doc.id);
      }

      authFetch
        .push(getAuth(doc.id));

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
          getAuth(addendumDoc.get('user'))
        );
    }

    const userRecords = await Promise
      .all(authFetch);

    userRecords.forEach(userRecord => {
      const { phoneNumber } = userRecord;

      if (addendumDoc
        && !locals.addendumCreatorInAssignees
        && phoneNumber === addendumDoc.get('user')) {
        locals
          .addendumCreator
          .displayName = userRecord.displayName;

        /**
         * Since addendum creator was not in the assignees list,
         * returning from the iteration since we don't want to
         * add them to the activity unnecessarily.
         */
        return;
      }

      locals
        .assigneesMap
        .get(phoneNumber)
        .displayName = userRecord.displayName;
      locals
        .assigneesMap
        .get(phoneNumber)
        .uid = userRecord.uid;
      locals
        .assigneesMap
        .get(phoneNumber)
        .photoURL = userRecord.photoURL;
      locals
        .assigneesMap
        .get(phoneNumber)
        .customClaims = userRecord.customClaims;

      /** New user introduced to the system. Saving their phone number. */
      if (!userRecord.uid) {
        const creator = change
          .after
          .get('creator.phoneNumber')
          || change
            .after
            .get('creator');

        newProfilesMap
          .set(phoneNumber, {
            creator,
            activityName: change.after.get('activityName'),
            office: change.after.get('office'),
          });
      }

      /** Document below the user profile. */
      const profileActivityObject = Object
        .assign({}, change.after.data(), {
          canEdit: locals.assigneesMap.get(phoneNumber).canEdit,
          timestamp: Date.now(),
        });

      profileActivityObject
        .assignees = (() => {
          const result = [];

          locals
            .assigneePhoneNumbersArray
            .forEach(phoneNumber => {
              let displayName = '';
              let photoURL = '';

              if (locals.assigneesMap.has(phoneNumber)) {
                displayName = locals
                  .assigneesMap
                  .get(phoneNumber)
                  .displayName || '';
                photoURL = locals
                  .assigneesMap
                  .get(phoneNumber)
                  .photoURL || '';
              }

              result
                .push({
                  phoneNumber,
                  displayName,
                  photoURL,
                });
            });

          return result;
        })();

      /**
       * Check-ins clutter the Activities collection and
       * make the /read resource slow.
       */
      if (template === 'check-in'
        && (!locals.assigneesMap.has(phoneNumber)
          || !locals.assigneesMap.get(phoneNumber).uid)) {
        return;
      }

      const ref = rootCollections
        .profiles
        .doc(phoneNumber)
        .collection('Activities')
        .doc(context.params.activityId);

      console.log('ProfileActivity', ref.path);

      batch.set(ref, profileActivityObject, {
        merge: true
      });
    });

    console.log({
      template,
      activityId: context.params.activityId,
      action: locals.addendumDoc ? locals.addendumDoc.get('action') : 'manual update',
    });

    const activityData = Object.assign({}, change.after.data(), {
      timestamp: Date.now(),
      adminsCanEdit: locals.adminsCanEdit,
      isCancelled: status === 'CANCELLED',
      addendumDocRef: null,
      creationTimestamp: change.after.createTime.toDate().getTime(),
    });

    if (addendumDoc
      && addendumDoc.get('action') === httpsActions.create) {
      const date = new Date();

      activityData
        .creationDate = date.getDate();
      activityData
        .creationMonth = date.getMonth();
      activityData
        .creationYear = date.getFullYear();
    }

    if (template === 'office') {
      activityData.slug = slugify(activityData.attachment.Name.value);
      delete activityData.adminsCanEdit;
    }

    const copyToRef = getCopyPath(
      template,
      locals.change.after.get('officeId'),
      locals.change.after.id,
    );

    batch
      .set(copyToRef, activityData, {
        merge: true,
      });

    await batch.commit();
    await handleAddendum(locals);
    await createNewProfiles(newProfilesMap);

    if (template === 'employee') {
      await handleEmployee(locals);
    }

    if (template === 'office') {
      await handleOffice(locals);
    }

    if (template === 'recipient') {
      await handleRecipient(locals);
    }

    if (template === 'subscription') {
      await handleSubscription(locals);
    }

    if (template === 'branch') {
      await handleBranch(locals);
    }

    if (template === 'branch'
      || template === 'customer') {
      await handleLocations(locals);
    }

    if (template === 'admin') {
      await handleAdmin(locals);
    }

    return;
  } catch (error) {
    console.error({
      error,
      context,
      activityId: change.after.id,
    });
  }
};
