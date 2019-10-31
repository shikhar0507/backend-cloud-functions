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
  vowels,
  httpsActions,
  dateFormats,
  reportNames,
  addendumTypes,
  subcollectionNames,
} = require('../../admin/constants');
const {
  slugify,
  getAuth,
  getNumbersbetween,
  getRelevantTime,
  adjustedGeopoint,
  isNonEmptyString,
  getUsersWithCheckIn,
  getEmployeeReportData,
  addEmployeeToRealtimeDb,
  getDefaultAttendanceObject,
  getEmployeesMapFromRealtimeDb,
} = require('../../admin/utils');
const {
  toMapsUrl,
  getStatusForDay,
} = require('../recipients/report-utils');
const {
  haversineDistance,
  createAutoSubscription,
} = require('../activity/helper');
const env = require('../../admin/env');
const admin = require('firebase-admin');
const momentTz = require('moment-timezone');
const dinero = require('dinero.js');
const googleMapsClient = require('@google/maps')
  .createClient({
    key: env.mapsApiKey,
    Promise: Promise,
  });


const getAttendanceValueForDay = async (officeId, phoneNumber, momentInstance) => {
  const [
    addendumDocs,
    employeeQueryResult,
  ] = await Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ADDENDUM)
        .where('user', '==', phoneNumber)
        .where('date', '==', momentInstance.date())
        .where('month', '==', momentInstance.month())
        .where('year', '==', momentInstance.year())
        .where('activityData.template', '==', 'check-in')
        .get(),
      rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ACTIVITIES)
        .where('status', '==', 'CONFIRMED')
        .where('attachment.Employee Contact.value', '==', phoneNumber)
        .where('template', '==', 'employee')
        .limit(1)
        .get(),
    ]);

  const employeeDoc = employeeQueryResult.docs[0];

  if (!employeeDoc
    || addendumDocs.empty) {
    return 0;
  }

  const firstCheckInTimestamp = addendumDocs.docs[0].timestamp;
  const lastCheckInTimestamp = addendumDocs.docs[addendumDocs.size - 1].timestamp;
  const hoursWorked = momentTz(lastCheckInTimestamp)
    .diff(
      momentTz(firstCheckInTimestamp),
      'hours',
      true
    );

  return getStatusForDay({
    // difference between first and last action in hours
    hoursWorked,
    // number of actions done in the day by the user
    numberOfCheckIns: addendumDocs.size,
    minimumDailyActivityCount: employeeDoc.get('attachment.Minimum Daily Activity Count.value'),
    minimumWorkingHours: employeeDoc.get('attachment.Minimum Working Hours.value'),
  });
};

const getLatLngString = location =>
  `${location._latitude},${location._longitude}`;


const getDistanceFromDistanceMatrix = async (origin, destination) => {
  const result = await googleMapsClient
    .distanceMatrix({
      /**
       * Ordering is important here. The `legal` distance
       * between A to B might not be the same as the legal
       * distance between B to A. So, do not mix the ordering.
       */
      origins: getLatLngString(origin),
      destinations: getLatLngString(destination),
      units: 'metric',
    })
    .asPromise();

  const distanceData = result
    .json
    .rows[0]
    .elements[0]
    .distance;

  if (distanceData) {
    return distanceData
      .value / 1000;
  }

  /**
   * Fallback for the case when Google's Distance Matrix API
   * doesn't return a valid path between the `origin`
   * and `destination`.
   */
  return haversineDistance(
    origin,
    destination
  );
};


const getValueFromActivity = (change, field, fromOldState = false) => {
  if (typeof fromOldState === 'boolean'
    && fromOldState) {
    return change.before.get(field);
  }

  return change.after.get(field);
};


const getUpdatedVenueDescriptors = (newVenue, oldVenue) => {
  const updatedFields = [];

  oldVenue
    .forEach((venue, index) => {
      const {
        venueDescriptor,
        location: oldLocation,
        address: oldAddress,
        geopoint: oldGeopoint,
      } = venue;

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
        && oldLongitude === newLongitude) {
        return;
      }

      updatedFields
        .push(venueDescriptor);
    });

  return updatedFields;
};

const getCustomerObject = async (name, officeId, template) => {
  const customerActivityResult = await rootCollections
    .activities
    .where('template', '==', template)
    .where('attachment.Name.value', '==', name)
    .where('officeId', '==', officeId)
    .where('status', '==', 'CONFIRMED')
    .get();

  const [customerDoc] = customerActivityResult.docs;
  const { attachment } = customerDoc.data();
  const [venue] = customerDoc.get('venue');
  const { location, address, geopoint } = venue;

  const object = Object.assign({}, {
    address,
    location,
    latitude: geopoint.latitude || geopoint._latitude,
    longitude: geopoint.longitude || geopoint._longitude,
  });

  Object
    .keys(attachment)
    .forEach(field => {
      object[field] = attachment[field].value;
    });

  return object;
};


const createAdmin = async (locals, adminContact) => {
  if (!adminContact
    || !locals.addendumDoc) {
    return;
  }

  const {
    officeId,
  } = locals.change.after.data();

  const batch = db.batch();
  const activityRef = rootCollections
    .activities
    .doc();
  const addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  const [
    adminTemplateQuery,
    adminQuery,
  ] = await Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', 'admin')
        .limit(1)
        .get(),
      rootCollections
        .activities
        .where('attachment.Admin.value', '==', adminContact)
        .where('office', '==', officeId)
        .where('status', '==', 'CONFIRMED')
        .limit(1)
        .get(),
    ]);

  /** Is already an admin */
  if (!adminQuery.empty) {
    return;
  }

  const adminTemplateDoc = adminTemplateQuery.docs[0];
  const activityData = {
    officeId,
    addendumDocRef,
    office: locals.change.after.get('office'),
    timezone: locals.change.after.get('timezone'),
    timestamp: locals.addendumDocData.timestamp,
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

  batch
    .set(activityRef, activityData);
  batch
    .set(addendumDocRef, addendumDocData);

  locals
    .assigneePhoneNumbersArray
    .forEach(phoneNumber => {
      const ref = activityRef
        .collection(subcollectionNames.ASSIGNEES)
        .doc(phoneNumber);

      batch
        .set(ref, { addToInclude: false });
    });

  return batch
    .commit();
};


const handleXTypeActivities = async locals => {
  const typeActivityTemplates = new Set([
    'customer',
    'leave',
    'claim',
    'duty',
  ]);
  const template = locals
    .change
    .after
    .get('attachment.Template.value');

  if (!typeActivityTemplates.has(template)) {
    return;
  }

  const {
    officeId,
  } = locals.change.after.data();
  const typeActivities = await rootCollections
    .activities
    .where('officeId', '==', officeId)
    .where('status', '==', 'CONFIRMED')
    .where('template', '==', `${template}-type`)
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

  typeActivities
    .forEach(activity => {
      const activityData = activity
        .data();

      delete activityData
        .addendumDocRef;

      const ref = rootCollections
        .profiles
        .doc(subscriber)
        .collection(subcollectionNames.ACTIVITIES)
        .doc(activity.id);

      batch
        .set(ref,
          activityData, {
          merge: true,
        });
    });

  return batch
    .commit();
};


const handleCanEditRule = async (locals, templateDoc) => {
  if (templateDoc.get('canEditRule') !== 'ADMIN') {
    return;
  }

  const {
    office,
    officeId,
    status,
    attachment,
  } = locals.change.after.data();
  const {
    value: subscriberPhoneNumber
  } = attachment.Subscriber;

  if (status === 'CANCELLED') {
    const userSubscriptions = await rootCollections
      .profiles
      .doc(subscriberPhoneNumber)
      .collection(subcollectionNames.SUBSCRIPTIONS)
      .where('canEditRule', '==', 'ADMIN')
      .where('status', '==', 'CONFIRMED')
      .where('office', '==', office)
      .get();

    if (!userSubscriptions.empty) {
      return;
    }

    // cancel admin activity for this user
    const adminActivityQueryResult = await rootCollections
      .activities
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', 'admin')
      .where('attachment.Admin.value', '==', subscriberPhoneNumber)
      .where('officeId', '==', officeId)
      .limit(1)
      .get();

    if (adminActivityQueryResult.empty) {
      return;
    }

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

  return createAdmin(locals, subscriberPhoneNumber);
};


const handleAttendances = async locals => {
  // If subscription has been created, create doc for the employee
  const isCreated = !locals.change.before.data()
    && locals.change.after.data();

  if (!isCreated) {
    return;
  }

  const phoneNumber = locals
    .change
    .after
    .get('attachment.Subscriber.value');
  const officeId = locals
    .change
    .after
    .get('officeId');
  const momentToday = momentTz();
  const baseQuery = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc(momentToday.format(dateFormats.MONTH_YEAR))
    .collection(phoneNumber);

  const [
    attendanceDoc,
    summaryDoc,
  ] = await Promise
    .all([
      baseQuery
        .doc(`${momentToday.date()}`)
        .get(),
      baseQuery
        .doc('summary')
        .get(),
    ]);

  const batch = db.batch();

  if (!attendanceDoc.exists) {
    batch
      .set(attendanceDoc.ref, {
        phoneNumber,
        month: momentToday.month(),
        year: momentToday.year(),
      }, {
        merge: true,
      });
  }

  if (!summaryDoc.exists) {
    batch
      .set(summaryDoc.ref, {
        phoneNumber,
        month: momentToday.month(),
        year: momentToday.year(),
      });
  }

  return batch
    .commit();
};


const handleSubscription = async locals => {
  const batch = db.batch();
  const { id: activityId } = locals.change.after;
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
    .collection(subcollectionNames.SUBSCRIPTIONS)
    .doc(locals.change.after.id);

  const [
    templateDocsQueryResult,
    profileSubscriptionDoc,
  ] = await Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', templateName)
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .doc(newSubscriber)
        .collection(subcollectionNames.SUBSCRIPTIONS)
        .doc(activityId)
        .get()
    ]);

  const [templateDoc] = templateDocsQueryResult.docs;
  const include = (() => {
    if (!profileSubscriptionDoc.exists) {
      return [];
    }

    return profileSubscriptionDoc
      .get('include') || [];
  })();

  locals
    .assigneePhoneNumbersArray
    .forEach(phoneNumber => {
      /**
       * The user's own phone number is redundant in the include array since they
       * will be the one creating an activity using the subscription to this activity.
       */
      if (newSubscriber === phoneNumber) {
        return;
      }

      /**
       * For the subscription template, people from
       * the share array are not added to the include array.
       */
      if (!locals.assigneesMap.get(phoneNumber).addToInclude) {
        return;
      }

      include
        .push(phoneNumber);
    });

  const subscriptionDocData = {
    include: Array.from(new Set(include)),
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
  };

  batch
    .set(subscriptionDocRef, subscriptionDocData);

  const newSubscriberAuth = await getAuth(newSubscriber);


  if (newSubscriberAuth.uid) {
    batch
      .set(rootCollections
        .updates
        .doc(newSubscriberAuth.uid)
        .collection(subcollectionNames.ADDENDUM)
        .doc(), Object.assign({}, subscriptionDocData, {
          _type: subcollectionNames.SUBSCRIPTIONS,
          activityId: locals.change.after.id,
        }), {
        merge: true,
      });
  }

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

  /** Subscriber changed, so, deleting old doc in old `Updates` */
  if (newSubscriberAuth.uid
    && subscriberChanged) {
    batch
      .delete(
        rootCollections
          .updates
          .doc(newSubscriberAuth.uid)
          .collection(subcollectionNames.ADDENDUM)
          .doc(locals.change.after.id)
      );
  }

  if (subscriberChanged) {
    batch
      .delete(rootCollections
        .profiles
        .doc(oldSubscriber)
        .collection(subcollectionNames.SUBSCRIPTIONS)
        .doc(locals.change.after.id)
      );
  }

  await Promise
    .all([
      batch
        .commit(),
      handleCanEditRule(
        locals,
        templateDoc
      ),
      handleAttendances(
        locals
      ),
    ]);

  return handleXTypeActivities(locals);
};


const removeFromOfficeActivities = async locals => {
  // const activityDoc = locals.change.after;
  const {
    status,
    office,
  } = locals.change.after.data();

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

  const phoneNumber = locals.change.after.get('attachment.Employee Contact.value');

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
              && doc.id === locals.change.after.id) {
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
                .collection(subcollectionNames.ASSIGNEES)
                .doc(phoneNumber));
          });

        /* eslint-disable */
        return batch
          .commit()
          .then(() => docs.docs[docs.size - 1]);
        /* eslint-enable */
      })
      .then(lastDoc => {
        if (!lastDoc) {
          return resolve();
        }

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
    .collection(subcollectionNames.ACTIVITIES)
    .where('office', '==', office)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(250);

  return new Promise((resolve, reject) => {
    return runQuery(query, resolve, reject);
  })
    .catch(console.error);
};


const handleEmployeeSupervisors = async locals => {
  const { status } = locals.change.after.data();

  if (status === 'CANCELLED') {
    return;
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
    return;
  }

  const batch = db.batch();
  const subscriptions = await rootCollections
    .activities
    .where('template', '==', 'subscription')
    .where('attachment.Subscriber.value', '==', employeeContact)
    .where('office', '==', locals.change.after.get('office'))
    .get();

  const firstSupervisorChanged = firstSupervisorOld
    && firstSupervisorOld !== firstSupervisorNew;
  const secondSupervisorChanged = secondSupervisorOld
    && secondSupervisorOld !== secondSupervisorNew;
  const thirdSupervisorChanged = thirdSupervisorOld
    && thirdSupervisorOld !== thirdSupervisorNew;

  subscriptions
    .forEach(doc => {
      batch
        .set(doc.ref, {
          addendumDocRef: null,
          timestamp: Date.now(),
        }, {
          merge: true,
        });

      if (firstSupervisorChanged) {
        batch
          .delete(
            doc
              .ref
              .collection(subcollectionNames.ASSIGNEES)
              .doc(firstSupervisorOld)
          );
      }

      if (secondSupervisorChanged) {
        batch
          .delete(
            doc
              .ref
              .collection(subcollectionNames.ASSIGNEES)
              .doc(secondSupervisorOld)
          );
      }

      if (thirdSupervisorChanged) {
        batch
          .delete(
            doc
              .ref
              .collection(subcollectionNames.ASSIGNEES)
              .doc(thirdSupervisorOld)
          );
      }

      const employeeSupervisorsList = [
        firstSupervisorNew,
        secondSupervisorNew,
        thirdSupervisorNew
      ];

      employeeSupervisorsList
        .filter(Boolean) // Any or all of these values could be empty strings...
        .forEach(phoneNumber => {
          const ref = doc
            .ref
            .collection(subcollectionNames.ASSIGNEES)
            .doc(phoneNumber);

          batch
            .set(ref, {
              addToInclude: true,
            });
        });
    });

  return batch
    .commit();
};


const createDefaultSubscriptionsForEmployee = locals => {
  const hasBeenCreated = locals
    .addendumDoc
    && locals
      .addendumDoc
      .get('action') === httpsActions.create;

  if (!hasBeenCreated) {
    return;
  }

  const {
    value: employeeContact
  } = locals.change.after.get('attachment.Employee Contact');

  return Promise
    .all([
      createAutoSubscription(locals, 'check-in', employeeContact),
      createAutoSubscription(locals, 'leave', employeeContact),
      createAutoSubscription(locals, 'attendance regularization', employeeContact),
    ]);
};


const updatePhoneNumberFields = (doc, oldPhoneNumber, newPhoneNumber, newPhoneNumberAuth) => {
  const result = Object.assign({}, doc.data(), {
    timestamp: Date.now(),
    addendumDocRef: null,
  });
  const { attachment, creator } = doc.data();

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
      if (attachment[field].value === oldPhoneNumber) {
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
  const activityDoc = locals.change.after;

  const runQuery = async (query, newPhoneNumberAuth, resolve, reject) => {
    return query
      .get()
      .then(docs => {
        if (docs.empty) {
          return [0];
        }

        const batch = db.batch();

        docs
          .forEach(doc => {
            const { template } = doc.data();

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
                .collection(subcollectionNames.ASSIGNEES)
                .doc(newPhoneNumber), {
                addToInclude: template !== 'subscription',
              }, {
                merge: true,
              });

            // Remove old assignee
            batch
              .delete(activityRef
                .collection(subcollectionNames.ASSIGNEES)
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

        if (!lastDoc) {
          return resolve();
        }

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

  const newPhoneNumberAuth = await getAuth(newPhoneNumber);

  const query = rootCollections
    .profiles
    .doc(oldPhoneNumber)
    .collection(subcollectionNames.ACTIVITIES)
    .where('office', '==', locals.change.after.get('office'))
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(100);

  return new Promise((resolve, reject) => {
    return runQuery(query, newPhoneNumberAuth, resolve, reject);
  });
};

const handleAttendanceDocsForPayroll = async locals => {
  const {
    officeId,
  } = locals.change.after.data();

  const batch = db.batch();
  const { after: employeeDoc } = locals.change;
  const phoneNumber = employeeDoc.get('attachment.Employee Contact.value');
  const momentNow = momentTz();
  const month = momentNow.month();
  const year = momentNow.year();

  const attendanceDoc = (await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('phoneNumber', '==', phoneNumber)
    .limit(1)
    .get())
    .docs[0];
  const ref = attendanceDoc ? attendanceDoc.ref : rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc();
  const attendanceUpdate = attendanceDoc ? attendanceDoc.data() : {};

  attendanceUpdate
    .attendance = attendanceUpdate.attendance || {};

  batch
    .set(ref, Object.assign({}, attendanceUpdate, {
      month,
      year,
      phoneNumber,
      employeeName: employeeDoc.get('attachment.Name.value'),
      employeeCode: employeeDoc.get('attachment.Employee Code.value'),
      baseLocation: employeeDoc.get('attachment.Base Location.value'),
      region: employeeDoc.get('attachment.Region.value'),
      department: employeeDoc.get('attachment.Department.value'),
    }), {
      merge: true,
    });

  return batch
    .commit();
};


const handleEmployee = async locals => {
  const { office, officeId } = locals.change.after.data();
  const {
    value: oldEmployeeContact,
  } = locals.change.before.get('attachment.Employee Contact') || {};
  const {
    value: newEmployeeContact,
  } = locals.change.after.get('attachment.Employee Contact');
  const hasBeenCancelled = locals
    .change
    .before.data()
    && locals
      .change
      .before
      .get('status') !== 'CANCELLED'
    && locals
      .change
      .after
      .get('status') === 'CANCELLED';

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

  // Phone number changed
  if (oldEmployeeContact
    && oldEmployeeContact !== newEmployeeContact) {
    batch
      .set(rootCollections
        .profiles
        .doc(oldEmployeeContact), {
        employeeOf: {
          [office]: admin.firestore.FieldValue.delete(),
        },
      }, {
        merge: true,
      });

    await admin
      .database()
      .ref(`${officeId}/employee/${oldEmployeeContact}`)
      .remove();

    const profileDoc = await rootCollections
      .profiles
      .doc(oldEmployeeContact)
      .get();

    profileData = Object
      .assign(profileDoc.data(), profileData);

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

    // Old Employee Contact
    const userRecord = await getAuth(oldEmployeeContact);

    if (userRecord.uid) {
      await auth
        .updateUser(userRecord.uid, {
          phoneNumber: newEmployeeContact,
        });

      await rootCollections
        .updates
        .doc(userRecord.uid)
        .set({
          phoneNumber: newEmployeeContact,
        }, {
          merge: true,
        });
    }

    await replaceNumberInActivities(locals);
  }

  batch
    .set(rootCollections
      .profiles
      .doc(newEmployeeContact), profileData, {
      merge: true,
    });

  await batch
    .commit();

  await addEmployeeToRealtimeDb(locals.change.after);

  if (hasBeenCancelled) {
    await removeFromOfficeActivities(locals);
  }

  await createDefaultSubscriptionsForEmployee(
    locals,
    hasBeenCancelled
  );

  await handleAttendanceDocsForPayroll(locals);

  return handleEmployeeSupervisors(locals);
};


const setLocationsReadEvent = async locals => {
  const officeId = locals
    .change
    .after
    .get('officeId');

  let docsCounter = 0;
  let batchIndex = 0;

  const phoneNumbersArray = await getUsersWithCheckIn(officeId);
  const numberOfBatches = Math.round(Math.ceil(phoneNumbersArray.length / 500));
  const batchArray = Array.from(Array(numberOfBatches)).map(() => db.batch());
  const updatesPromises = [];

  phoneNumbersArray
    .forEach(phoneNumber => {
      updatesPromises
        .push(rootCollections
          .updates
          .where('phoneNumber', '==', phoneNumber)
          .limit(1)
          .get()
        );
    });

  const updateDocs = await Promise
    .all(updatesPromises);

  updateDocs.forEach(doc => {
    if (!doc.exists) {
      return;
    }

    docsCounter++;

    if (docsCounter > 499) {
      docsCounter = 0;
      batchIndex++;
    }

    batchArray[
      batchIndex
    ].set(rootCollections
      .updates
      .doc(doc.id), {
      lastLocationMapUpdateTimestamp: Date.now(),
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
};

// const handleBranchScheduleUpdate = async locals => {
//   const schedulesNew = locals.change.after.get('schedule');
//   const schedulesOld = locals.change.before.get('schedule') || [];

//   schedulesNew.forEach((schedule, index) => {
//     const {
//       startTime: startTimeNew,
//       endTime: endTimeNew,
//     } = schedule;

//     const {
//       startTime: startTimeOld,
//       endTime: endTimeOld,
//     } = schedulesOld[index] || {};
//   });
// };

const handleBranchWeeklyOffUpdate = async locals => {
  const {
    officeId,
    attachment: {
      Name: {
        value: branchName,
      },
      'Weekly Off': {
        value: weeklyOffNew,
      },
    },
  } = locals.change.after.get('attachment');

  const {
    attachment: {
      'Weekly Off': {
        value: weeklyOffOld,
      },
    },
  } = locals.change.before.get('attachment');

  // Nothing changed
  if (weeklyOffOld && (weeklyOffOld === weeklyOffNew)) {
    return;
  }

  const [
    employeesWithThisBranch,
    officeDoc,
  ] = await Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ACTIVITIES)
        .where('template', '==', 'employee')
        .where('attachment.Base Location.value', '==', branchName)
        .where('status', '==', 'CONFIRMED')
        .get(),
      rootCollections
        .offices
        .doc(officeId)
        .get(),
    ]);

  const firstDayOfMonthlyCycle = officeDoc
    .get('attachment.First Day Of Monthly Cycle.value') || 1;

  const momentToday = momentTz().month();
  const prevMonth = (() => {
    if (firstDayOfMonthlyCycle > momentToday.date()) {
      return null;
    }

    return momentTz().clone().subtract(1, 'month').month();
  })();

  const attendanceQueries = [];

  employeesWithThisBranch
    .forEach(doc => {
      const employeeContact = doc.get('attachment.Employee Contact.value');
      const base = rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ATTENDANCES)
        .where('phoneNumber', '==', employeeContact);

      attendanceQueries
        .push(base
          .where('month', '==', momentToday.month())
          .where('year', '==', momentToday.year())
          .limit(1)
          .get());

      if (prevMonth) {
        attendanceQueries
          .push(base
            .where('month', '==', prevMonth.month())
            .where('year', '==', prevMonth.year())
            .limit(1)
            .get());
      }
    });

  const attendanceSnaps = await Promise.all(attendanceQueries);
  const batch = db.batch();

  attendanceSnaps.forEach(snap => {
    const doc = snap.docs[0];
    const month = doc.get('month');
    const year = doc.get('year');
    const momentThisMonth = momentTz().month(month).year(year);
    const daysInMonth = momentThisMonth.daysInMonth();
    const dataUpdate = doc.data() || {};

    dataUpdate.attendance = dataUpdate.attendance || {};

    const dates = getNumbersbetween(1, daysInMonth + 1);

    dates.forEach(date => {
      const weekdayOnDate = momentTz().date(date).month(month).year(year).format('dddd').toLowerCase();

      if (weeklyOffOld !== weekdayOnDate) {
        return;
      }

      dataUpdate
        .attendance[date] = dataUpdate.attendance[date] || getDefaultAttendanceObject();
      dataUpdate
        .attendance[date].weeklyOff = true;
      dataUpdate
        .attendance[date].attendance = 1;
    });

    batch
      .set(doc.ref, dataUpdate, { merge: true });
  });

  return batch
    .commit();
};


const handleBranch = async locals => {
  const {
    office,
    attachment: {
      Name: {
        value: baseLocation,
      },
    },
  } = locals.change.after.data();

  // await handleBranchScheduleUpdate(locals);
  await handleBranchWeeklyOffUpdate(locals);

  const employees = await rootCollections
    .activities
    .where('template', '==', 'employee')
    .where('status', '==', 'CONFIRMED')
    .where('office', '==', office)
    .where('attachment.Base Location.value', '==', baseLocation)
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

  await batch
    .commit();

  if (!locals.addendumDoc
    || locals.change.after.get('attachment.Name.value') !== 'payroll') {
    return;
  }

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

      profilePromises
        .push(promise);
    });

  const snap = await Promise
    .all(profilePromises);

  snap
    .forEach(doc => {
      /** Profile already exists */
      if (doc.exists) {
        return;
      }

      profileBatch
        .set(doc.ref, {
          // doc.id => phoneNumber
          smsContext: newProfilesMap.get(doc.id),
        }, {
          merge: true,
        });
    });

  return profileBatch
    .commit();
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

    if (newEndTime === oldEndTime
      && newStartTime === oldStartTime) {
      return;
    }

    updatedFields
      .push(name);
  });

  return updatedFields;
};


const getUpdatedAttachmentFieldNames = (newAttachment, oldAttachment) => {
  const updatedFields = [];

  Object
    .keys(newAttachment)
    .forEach(field => {
      /** Comparing the `base64` photo string is expensive. Not doing it. */
      if (newAttachment[field].type === 'photo') {
        return;
      }

      const oldFieldValue = oldAttachment[field].value;
      const newFieldValue = newAttachment[field].value;
      const isUpdated = oldFieldValue !== newFieldValue;

      if (!isUpdated) {
        return;
      }

      updatedFields
        .push(field);
    });

  return updatedFields;
};


const getUpdatedFieldNames = options => {
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

  if (allFields.length === 1) {
    return commentString += `${allFields[0]}`;
  }

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

  return `${pronoun}`
    + ` ${status.toLowerCase()} ${activityName}`;
};


const getCommentString = (locals, recipient) => {
  const action = locals.addendumDoc.get('action');
  const pronoun = getPronoun(locals, recipient);
  const template = locals.addendumDoc.get('activityData.template');

  if (locals.addendumDoc.get('cancellationMessage')) {
    return locals
      .addendumDoc
      .get('cancellationMessage');
  }

  if (action === httpsActions.create) {
    const locationFromVenue = (() => {
      if (template !== 'check-in') {
        return null;
      }

      if (locals.addendumDocData.activityData
        && locals.addendumDocData.activityData.venue
        && locals.addendumDocData.activityData.venue[0]
        && locals.addendumDocData.activityData.venue[0].location) {
        return locals
          .addendumDocData
          .activityData
          .venue[0]
          .location;
      }

      if (locals.addendumDocData.venueQuery) {
        return locals
          .addendumDocData
          .venueQuery
          .location;
      }

      return locals
        .addendumDocData
        .identifier;
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

  locals
    .activityNew = locals.change.after;

  locals
    .assigneePhoneNumbersArray
    .forEach(phoneNumber => {
      const userRecord = locals.assigneesMap.get(phoneNumber);

      if (!userRecord.uid) {
        return;
      }

      batch
        .set(rootCollections
          .updates
          .doc(userRecord.uid)
          // Addendum
          .collection(subcollectionNames.ADDENDUM)
          .doc(addendumDoc.id), {
          comment: getCommentString(locals, phoneNumber),
          type: addendumTypes.COMMENT,
          activityId: locals.change.after.id,
          isComment: isComment(addendumDoc.get('action')),
          timestamp: addendumDoc.get('userDeviceTimestamp'),
          location: addendumDoc.get('location'),
          user: addendumDoc.get('user'),
        });
    });

  return batch
    .commit();
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
  /**
   * Client sends geopointAccuracy in meteres.
   */
  if (accuracy
    && accuracy < 350) {
    return 0.5;
  }

  return 1;
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


const handleCheckInActionForDailyAllowance = async locals => {
  const phoneNumber = locals
    .change
    .after
    .get('creator.phoneNumber')
    || locals
      .change
      .after
      .get('phoneNumber');
  const officeId = locals.change.after.get('officeId');
  const timezone = locals.change.after.get('timezone');
  const docs = await rootCollections
    .offices
    .doc(officeId)
    .collection('Activities')
    .where('template', '==', 'daily allowance')
    .where('isCancelled', '==', false)
    .get();

  const batch = db.batch();
  const momentNow = momentTz()
    .tz(timezone);
  let count = 0;
  const monthYearString = momentNow
    .format(dateFormats.MONTH_YEAR);
  const reimbursementsDoc = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .doc(monthYearString)
    .collection(phoneNumber)
    .doc(`${momentNow.date()}`)
    .get();

  const reimbursementsDocData = (() => {
    if (reimbursementsDoc.exists) {
      return reimbursementsDoc.data();
    }

    return {
      phoneNumber,
      date: momentNow.date(),
      month: momentNow.month(),
      year: momentNow.year(),
    };
  })();

  reimbursementsDocData
    .reimbursements = reimbursementsDocData.reimbursements || [];

  docs
    .forEach(doc => {
      const start = doc.get('attachment.Start Time.value');
      const end = doc.get('attachment.End Time.value');

      if (!start || !end) {
        return;
      }

      const [
        startHours,
        startMinutes,
      ] = start
        .split(':');
      const [
        endHours,
        endMinutes,
      ] = end
        .split(':');

      const momentStart = momentNow
        .clone()
        .hour(startHours)
        .minute(startMinutes);
      const momentEnd = momentNow
        .clone()
        .hour(endHours)
        .minute(endMinutes);

      if (momentNow.isBefore(momentStart)
        || momentNow.isAfter(momentEnd)) {
        return;
      }

      count++;

      const newObject = {
        template: doc.get('template'),
        name: doc.get('attachment.Name.value'),
        amount: doc.get('attachment.Amount.value'),
        timestamp: doc.createTime.toDate().getTime(),
        status: doc.get('status'),
        activityId: locals.change.after.id,
      };

      // One type of claim can only be claimed once during the
      // time range (startTime to endTime)
      const index = reimbursementsDocData
        .reimbursements
        .indexOf(el => {
          return el.name === doc.get('attachment.Name.value');
        });

      if (index === -1) {
        reimbursementsDocData
          .reimbursements
          .push(newObject);
      } else {
        reimbursementsDocData
          .reimbursements[
          index
        ] = newObject;
      }
    });

  if (count === 0) {
    return;
  }

  const addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  batch
    .set(addendumDocRef, {
      date: momentNow.date(),
      month: momentNow.month(),
      year: momentNow.year(),
      user: phoneNumber,
      action: httpsActions.checkIn,
      location: locals.addendumDoc.get('location'),
      timestamp: Date.now(),
      userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
      isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
      geopointAccuracy: locals.addendumDoc.get('geopointAccuracy'),
      provider: locals.addendumDoc.get('provider'),
      userDisplayName: locals.change.after.get('creator.displayName'),
      isAutoGenerated: true,
      comment: ``,
      activityData: locals.change.after.data(),
      activityId: locals.change.after.id,
    });

  batch
    .set(reimbursementsDoc.ref, reimbursementsDocData, {
      merge: true,
    });

  return batch
    .commit();
};


const addCheckInTimestamps = async locals => {
  if (locals.addendumDocData
    && (locals.addendumDocData.action !== httpsActions.create)) {
    return;
  }

  const timezone = locals
    .change
    .after
    .get('timezone');
  const createTime = locals
    .change
    .after
    .createTime
    .toDate()
    .getTime();
  const momentNow = momentTz(createTime)
    .tz(timezone);
  const date = momentNow.date();
  const monthYearString = momentNow
    .format(dateFormats.MONTH_YEAR);
  const officeId = locals
    .change
    .after
    .get('officeId');
  const phoneNumber = locals
    .change
    .after
    .get('creator.phoneNumber');

  const [
    attendanceDoc,
    employeeDocQueryResult,
  ] = await Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection('Attendances')
        .doc(monthYearString)
        .collection(phoneNumber)
        /** Path values are strings */
        .doc(`${date}`)
        .get(),
      rootCollections
        .activities
        .where('officeId', '==', officeId)
        .where('status', '==', 'CONFIRMED')
        .where('template', '==', 'employee')
        .where('attachment.Employee Contact.value', '==', phoneNumber)
        .limit(1)
        .get(),
    ]);

  const employeeDoc = employeeDocQueryResult.docs[0];

  /**
   * If person creating a check-in is an employee,
   * and the `Location Validation Check` is `true`
   * and the distanceAccurate is not true, the count
   * of check-in will not be counted.
   */
  if (employeeDoc
    /**
     * `Location Validation Check` could be an empty string,
     * or something else but we need an explicit check for
     * `distanceAccurate`.
     */
    && employeeDoc.get('attachment.Location Validation Check.value') === true
    && locals.addendumDocData.distanceAccurate === false) {
    return;
  }

  let attendanceDocData = attendanceDoc.data() || {};

  if (!attendanceDocData.firstCheckInTimestamp) {
    attendanceDocData = Object
      .assign({}, attendanceDocData, {
        date,
        phoneNumber,
        firstCheckInTimestamp: locals.addendumDocData.timestamp,
        firstCheckIn: momentTz(locals.addendumDocData.timestamp)
          .tz(timezone)
          .format(dateFormats.TIME),
        month: momentNow.month(),
        year: momentNow.year(),
      });

    // if (employeeDoc) {
    //   const startTime = employeeDoc.get('attachment.Daily Start Time.value');

    //   if (startTime) {
    //     const [
    //       startHours,
    //       startMinutes,
    //     ] = startTime
    //       .split(':');

    //     attendanceDocData
    //       .isLate = momentNow
    //         .clone()
    //         .hours(startHours)
    //         .minutes(startMinutes)
    //         .diff(momentNow, 'minutes') > 15;
    //   }
    // }
  }

  attendanceDocData
    .lastCheckInTimestamp = locals.addendumDocData.timestamp;
  attendanceDocData
    .lastCheckIn = momentTz(locals.addendumDocData.timestamp)
      .tz(timezone)
      .format(dateFormats.TIME);
  attendanceDocData
    .numberOfCheckIns = attendanceDocData.numberOfCheckIns || 0;

  // Activity has actually been created.
  if (!locals.change.before.data()
    && locals.change.after.data()) {
    attendanceDocData
      .numberOfCheckIns++;
  }

  const batch = db.batch();
  const uid = locals.assigneesMap.get(phoneNumber).uid;


  if (uid) {
    batch
      .set(rootCollections
        .updates
        .doc(uid), {
        lastStatusDocUpdateTimestamp: Date.now(),
      }, {
        merge: true,
      });
  }

  batch
    .set(
      attendanceDoc.ref,
      attendanceDocData, {
      merge: true,
    });

  return batch
    .commit();
};


const handleAddendum = async locals => {
  const addendumDoc = locals.addendumDoc;

  if (!addendumDoc) {
    return;
  }

  const action = addendumDoc.get('action');
  const phoneNumber = addendumDoc.get('user');
  const momentWithOffset = momentTz(addendumDoc.get('timestamp'))
    .tz(addendumDoc.get('activityData.timezone'));

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
        .where('timestamp', '<', addendumDoc.get('timestamp'))
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

  const previousAddendumDoc = (() => {
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

    // eslint-disable-next-line require-atomic-updates
    locals
      .city = city;
    // eslint-disable-next-line require-atomic-updates
    locals
      .state = state;
    // eslint-disable-next-line require-atomic-updates
    locals
      .locality = locality;
  }

  const distanceData = (() => {
    if (!previousAddendumDoc) {
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
      previousAddendumDoc.get('accumulatedDistance') || 0
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

  // Required for comment creation since the addendumDoc.data() won't contain
  // the updates made during this function instance
  // eslint-disable-next-line require-atomic-updates
  locals
    .addendumDocData = Object.assign(
      {},
      addendumDoc.data(),
      updateObject
    );

  // eslint-disable-next-line require-atomic-updates
  locals
    .previousAddendumDoc = previousAddendumDoc;

  /**
   * Seperating this part out because handling even a single crash
   * with `addendumOnCreate` cloud function messes up whole data for the user
   * after the time of the crash.
   */
  batch
    .set(addendumDoc.ref, updateObject, {
      merge: true,
    });

  await batch
    .commit();

  await handleComments(addendumDoc, locals);

  if (addendumDoc.get('activityData.template') === 'check-in') {
    await addCheckInTimestamps(locals);
  }

  return handleDailyStatusReport(addendumDoc);
};

const handleActivityUpdates = async locals => {
  /**
   * If name is updated
   * get all the activities with this name
   * and update the activities
   * If this instance has run because of activity being cancelled
   * during status-change, set all the activities using this value
   * in their type as '' (empty string).
   */
  const oldStatus = locals.change.before.get('status');
  const newName = locals.change.after.get('attachment.Name.value');
  const oldName = locals.change.before.get('attachment.Name.value');
  const newStatus = locals.change.after.get('status');
  const officeId = locals.change.after.get('officeId');
  const hasBeenCancelled = oldStatus !== 'CANCELLED'
    && newStatus === 'CANCELLED';

  if (oldName
    && (oldName === newName)
    && !hasBeenCancelled) {

    return;
  }

  const template = locals
    .change
    .after
    .get('template');

  const baseQuery = rootCollections
    .activities
    .where('officeId', '==', officeId)
    .where('template', '==', 'employee');

  const query = (() => {
    if (template === 'branch') {
      return baseQuery
        .where('attachment.Base Location.value', '==', newName);
    }

    if (template === 'region') {
      return baseQuery
        .where('attachment.Region.value', '==', newName);
    }

    if (template === 'department') {
      return baseQuery
        .where('attachment.Department.value', '==', newName);
    }

    return null;
  })();

  // Only proceed for branch, region and department
  if (!query) {
    return;
  }

  const docs = await query.get();

  const value = (() => {
    if (newStatus === 'CANCELLED') {
      return '';
    }

    return newName;
  })();

  const field = (() => {
    if (template === 'branch') return 'Base Location';
    if (template === 'region') return 'Region';
    if (template === 'department') return 'Department';
  })();

  const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
  const numberOfBatches = Math
    .round(
      Math
        .ceil(docs.size / MAX_DOCS_ALLOWED_IN_A_BATCH)
    );
  const batchArray = Array
    .from(Array(numberOfBatches)).map(() => db.batch());
  let batchIndex = 0;
  let docsCounter = 0;

  docs.forEach(doc => {
    if (docsCounter > 499) {
      docsCounter = 0;
      batchIndex++;
    }

    docsCounter++;

    batchArray[
      batchIndex
    ].set(doc.ref, {
      addendumDocRef: null,
      attachment: {
        [field]: {
          value,
        },
      },
    }, {
      merge: true,
    });
  });

  return Promise
    .all(batchArray.map(batch => batch.commit()));
};

const handleLeaveUpdates = async locals => {
  /**
   * If leave is updated, fetch duties which have conflict with this duty
   * if the conflict in time range still exists, return.
   * if schedule is not updated, return;
   * if schedule has been updated such that the conflict doesn't exist now
   * create a comment in the leave and conflicting activities.
   */
  const newStatus = locals.change.after.get('status');
  const oldStatus = locals.change.before.get('status');
  const displayName = locals.change.after.get('creator.displayName');
  const phoneNumber = locals.change.after.get('creator.phoneNumber');
  const newSchedule = locals.change.after.get('schedule')[0];
  const oldSchedule = locals.change.before.get('schedule')[0];
  const oldConflictingDuties = locals.change.before.get('conflictingDuties') || [];
  const newConflictingDuties = locals.change.after.get('conflictingDuties') || [];
  const hasBeenCancelled = oldStatus !== 'CANCELLED'
    && newStatus === 'CANCELLED';

  // If duty conflict was removed during a previous instance for this leave
  // activity. The activity on write will trigger again.
  // In order to avoid the infinite loop, we check if `conflictingDuties`
  // array was modified. If it was, then we can assume that one or more conflicts
  // were resolved, and thus that caused the 2nd activityOnWrite instance to trigger.
  if (oldConflictingDuties.length
    !== newConflictingDuties.length) {
    return;
  }

  // No conflicts, no need to proceed
  if (newConflictingDuties.length === 0) {
    return;
  }

  // Schedule not updated, no need to do anything since
  // even if there was a conflict, nothing significant has changed.
  if (oldSchedule.startTime === newSchedule.startTime
    && oldSchedule.endTime === newSchedule.endTime
    && oldStatus === newStatus) {
    return;
  }

  const leaveStartMoment = momentTz(newSchedule.startTime);
  const leaveEndMoment = momentTz(newSchedule.endTime);
  const leaveEndTs = (() => {
    // same day
    if (leaveStartMoment.format(dateFormats.DATE)
      === leaveEndMoment.format(dateFormats.DATE)) {
      return leaveStartMoment
        .clone()
        .endOf('day')
        .valueOf();
    }

    return newSchedule
      .endTime;
  })();

  const conflictingDutyActivityPromises = [];
  const resolvedConflictDocs = [];

  newConflictingDuties
    .forEach(activityId => {
      const promise = rootCollections
        .profiles
        .doc(phoneNumber)
        .collection('Activities')
        .doc(activityId)
        .get();

      conflictingDutyActivityPromises
        .push(promise);
    });

  const docs = await Promise
    .all(conflictingDutyActivityPromises);

  docs
    .forEach(doc => {
      const relevantTime = doc.get('relevantTime');

      if (!relevantTime) {
        return;
      }

      if (relevantTime >= newSchedule.startTime
        && relevantTime <= leaveEndTs
        && !hasBeenCancelled) {
        // Leave updated, but still has conflict.
        return;
      }

      resolvedConflictDocs
        .push(doc);
    });

  // No conflicts were resolved during this update instance.
  if (resolvedConflictDocs.length === 0) {
    return;
  }

  const officeId = locals.change.after.get('officeId');
  const batch = db.batch();
  const dateObject = new Date();
  const automaticComment = `${displayName || phoneNumber} has`
    + ` removed leave conflict with duty`;

  const leaveAddendumRef = rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .doc();

  batch
    .set(locals.change.after.ref, {
      addendumDocRef: leaveAddendumRef,
      timestamp: Date.now(),
      resolvedConflictIds: admin
        .firestore
        .FieldValue
        .arrayRemove(...resolvedConflictDocs.map(doc => doc.id)),
    }, {
      merge: true,
    });

  batch
    .set(leaveAddendumRef, {
      date: dateObject.getDate(),
      month: dateObject.getMonth(),
      year: dateObject.getFullYear(),
      user: phoneNumber,
      action: httpsActions.comment,
      location: locals.addendumDoc.get('location'),
      timestamp: Date.now(),
      userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
      isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
      geopointAccuracy: locals.addendumDoc.get('geopointAccuracy'),
      provider: locals.addendumDoc.get('provider'),
      userDisplayName: displayName,
      isAutoGenerated: true,
      comment: automaticComment,
      activityData: locals.change.after.data(),
      activityId: locals.change.after.ref.id,
    });

  resolvedConflictDocs
    .forEach(doc => {
      const addendumDocRef = rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .doc();

      batch
        .set(doc.ref, {
          timestamp: Date.now(),
          addendumDocRef: addendumDocRef,
        }, {
          merge: true,
        });

      batch
        .set(addendumDocRef, {
          date: dateObject.getDate(),
          month: dateObject.getMonth(),
          year: dateObject.getFullYear(),
          user: phoneNumber,
          action: httpsActions.comment,
          location: locals.addendumDoc.get('location'),
          timestamp: Date.now(),
          userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
          isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
          geopointAccuracy: locals.addendumDoc.get('geopointAccuracy'),
          provider: locals.addendumDoc.get('provider'),
          userDisplayName: displayName,
          isAutoGenerated: true,
          comment: automaticComment,
          activityData: doc.data(),
          activityId: doc.ref.id,
        });
    });

  return batch
    .commit();
};


const handleLeaveAndDutyConflict = async locals => {
  const officeId = locals.change.after.get('officeId');
  const phoneNumber = locals.change.after.get('creator.phoneNumber');

  if (locals.addendumDoc
    && (locals.addendumDoc.get('action') === httpsActions.create
      || locals.addendumDoc.get('action') === httpsActions.update
      || locals.addendumDoc.get('action') === httpsActions.changeStatus)) {

    const docs = await rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', 'employee')
      .where('attachment.Employee Contact.value', '==', phoneNumber)
      .limit(1)
      .get();

    const doc = docs.docs[0];

    if (doc) {
      await addEmployeeToRealtimeDb(doc);
    }
  }

  if (locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.comment) {
    return;
  }

  const hasBeenCreated = locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;
  const newStatus = locals.change.after.get('status');
  const displayName = locals.change.after.get('creator.displayName');
  const conflictingDuties = locals.change.after.get('conflictingDuties') || [];

  // Leave was created with cancelled status
  // possibly because of AR/Leave conflicts
  if (hasBeenCreated
    && newStatus === 'CANCELLED') {
    return;
  }

  const leaveSchedule = locals
    .change
    .after
    .get('schedule')[0];
  const leaveStart = leaveSchedule.startTime;
  const leaveEnd = leaveSchedule.endTime;

  // Schedule is empty
  if (!leaveStart
    || !leaveEnd) {
    return;
  }

  // Leave was updated
  if (!hasBeenCreated) {
    return handleLeaveUpdates(locals);
  }

  const leaveStartMoment = momentTz(leaveStart);
  const leaveEndMoment = momentTz(leaveEnd);
  const leaveEndTs = (() => {
    // same day
    if (leaveStartMoment.format(dateFormats.DATE)
      === leaveEndMoment.format(dateFormats.DATE)) {
      return leaveStartMoment
        .clone()
        .endOf('day')
        .valueOf();
    }

    return leaveEnd;
  })();

  const duties = await rootCollections
    .profiles
    .doc(phoneNumber)
    .collection('Activities')
    .where('relevantTime', '>=', leaveStart)
    .where('relevantTime', '<=', leaveEndTs)
    .get();

  const conflictingDutyActivities = [];
  const conflictingActivityIds = [];

  duties
    .forEach(doc => {
      // activity should be for the same office
      if (doc.get('officeId')
        !== officeId) {
        return;
      }

      if (doc.get('template')
        !== 'duty') {
        return;
      }

      // This leave has already been updated with the comment
      // about the conflict. Removing this check will cause infinite
      // loop in activityOnWrite.
      if (conflictingDuties.includes(doc.id)) {
        return;
      }

      const supervisor = doc.get('attachment.Supervisor.value');
      const include = doc.get('attachment.Include.value');
      const allPhoneNumbersInActivity = [supervisor].concat(include);

      if (!allPhoneNumbersInActivity.includes(phoneNumber)) {
        return;
      }

      conflictingDutyActivities
        .push(doc);

      conflictingActivityIds
        .push(doc.id);
    });

  const batch = db.batch();
  const dateObject = new Date();
  const automaticComment = `${displayName || phoneNumber} has`
    + ` a leave conflict with duty`;

  conflictingDutyActivities
    .forEach(doc => {
      const addendumDocRef = rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .doc();

      batch
        .set(doc.ref, {
          addendumDocRef,
          timestamp: Date.now(),
        }, {
          merge: true,
        });

      batch
        .set(addendumDocRef, {
          date: dateObject.getDate(),
          month: dateObject.getMonth(),
          year: dateObject.getFullYear(),
          user: phoneNumber,
          action: httpsActions.comment,
          location: locals.addendumDoc.get('location'),
          timestamp: Date.now(),
          userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
          isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
          geopointAccuracy: locals.addendumDoc.get('geopointAccuracy'),
          provider: locals.addendumDoc.get('provider'),
          userDisplayName: displayName,
          isAutoGenerated: true,
          comment: automaticComment,
          activityData: doc.data(),
          activityId: doc.ref.id,
        });
    });

  if (conflictingDutyActivities.length > 0) {
    const addendumDocRef = rootCollections
      .offices
      .doc(officeId)
      .collection('Addendum')
      .doc();

    batch
      .set(locals.change.after.ref, {
        addendumDocRef,
        timestamp: Date.now(),
        conflictingDuties: Array.from(new Set(conflictingActivityIds)),
      }, {
        merge: true,
      });

    batch
      .set(addendumDocRef, {
        date: dateObject.getDate(),
        month: dateObject.getMonth(),
        year: dateObject.getFullYear(),
        user: phoneNumber,
        action: httpsActions.comment,
        location: locals.addendumDoc.get('location'),
        timestamp: Date.now(),
        userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
        isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
        geopointAccuracy: locals.addendumDoc.get('geopointAccuracy'),
        provider: locals.addendumDoc.get('provider'),
        userDisplayName: displayName,
        isAutoGenerated: true,
        comment: automaticComment,
        activityData: locals.change.after.data(),
        activityId: locals.change.after.ref.id,
      });
  }

  return batch
    .commit();
};


const handleRelevantTimeActivities = async locals => {
  if (!locals.addendumDocData) {
    return;
  }

  // Only allowed for create
  if (locals.addendumDocData.action
    !== httpsActions.create) {
    return;
  }

  const officeId = locals
    .change
    .after
    .get('officeId');
  const timezone = locals
    .change
    .after
    .get('timezone');
  const momentNow = momentTz()
    .tz(timezone);
  const phoneNumber = locals
    .change
    .after
    .get('creator.phoneNumber');
  const displayName = locals
    .change
    .after
    .get('creator.displayName');
  const nowMinus24Hours = momentNow
    .clone()
    .subtract(48, 'hours');
  const nowPlus24Hours = momentNow
    .clone()
    .add(48, 'hours');
  const relevantTimeActivities = await rootCollections
    .profiles
    .doc(phoneNumber)
    .collection('Activities')
    .where('relevantTime', '>=', nowMinus24Hours.valueOf())
    .where('relevantTime', '<=', nowPlus24Hours.valueOf())
    .get();

  const batch = db.batch();

  relevantTimeActivities
    .forEach(doc => {
      if (doc.get('officeId')
        !== officeId) {
        return;
      }

      if (!doc.get('attachment.Location')) {
        return;
      }

      const gp2 = locals.addendumDocData.location;
      const gp1 = {
        _latitude: doc.get('customerObject.latitude'),
        _longitude: doc.get('customerObject.longitude'),
      };

      const hd = haversineDistance(gp1, gp2);

      console.log('haversineDistance', hd);

      if (hd > 1) {
        return;
      }

      const addendumDocRef = rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .doc();
      const dateObject = new Date();

      batch
        .set(addendumDocRef, {
          date: dateObject.getDate(),
          month: dateObject.getMonth(),
          year: dateObject.getFullYear(),
          user: phoneNumber,
          action: httpsActions.checkIn,
          location: locals.addendumDoc.get('location'),
          timestamp: Date.now(),
          userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
          isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
          geopointAccuracy: locals.addendumDoc.get('geopointAccuracy'),
          provider: locals.addendumDoc.get('provider'),
          userDisplayName: displayName,
          isAutoGenerated: true,
          comment: `${displayName || phoneNumber} checked `
            + `in from Duty Location:`
            + ` ${doc.get('attachment.Location.value')}`,
          activityData: doc.data(),
          activityId: doc.ref.id,
        });

      batch
        .set(locals.change.after.ref, {
          addendumDocRef,
          timestamp: Date.now(),
        }, {
          merge: true,
        });

      const rt = getRelevantTime(doc.get('schedule'));
      const activityRef = rootCollections
        .activities
        .doc(doc.id);
      const checkIns = doc.get('checkIns') || {};

      checkIns[phoneNumber] = checkIns[phoneNumber] || [];
      checkIns[phoneNumber].push(Date.now());

      const activityData = {
        addendumDocRef,
        checkIns,
        timestamp: Date.now(),
        relevantTime: rt,
      };

      batch
        .set(activityRef, activityData, {
          merge: true,
        });
    });

  await batch
    .commit();
};


const handleTypeActivityCreation = async locals => {
  if (locals.addendumDoc
    && (locals.addendumDoc.get('action') === httpsActions.comment
      || locals.addendumDoc.get('action') === httpsActions.share)) {
    return;
  }

  const template = locals
    .change
    .after
    .get('template');

  // leave-type -> 'leave'
  const parentTemplate = template
    .split('-type')[0];

  if (!parentTemplate) {
    return;
  }

  const officeId = locals
    .change
    .after
    .get('officeId');

  const docs = await rootCollections
    .activities
    .where('template', '==', 'subscription')
    .where('officeId', '==', officeId)
    .where('status', '==', 'CONFIRMED')
    .where('attachment.Template.value', '==', parentTemplate)
    .get();

  const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
  const numberOfBatches = Math
    .round(
      Math
        .ceil(docs.size / MAX_DOCS_ALLOWED_IN_A_BATCH)
    );
  const batchArray = Array
    .from(Array(numberOfBatches)).map(() => db.batch());
  let batchIndex = 0;
  let docsCounter = 0;

  docs.forEach(doc => {
    if (docsCounter > 499) {
      docsCounter = 0;
      batchIndex++;
    }

    docsCounter++;

    batchArray[
      batchIndex
    ].set(doc.ref, {
      addendumDocRef: null,
      timestamp: Date.now(),
    }, {
      merge: true,
    });
  });

  return Promise
    .all(batchArray.map(batch => batch.commit()));
};


const handleClaim = async locals => {
  const batch = db.batch();
  const timezone = locals.change.after.get('timezone');
  const officeId = locals.change.after.get('officeId');
  const phoneNumber = locals.change.after.get('creator.phoneNumber');
  const activityId = locals.change.after.id;
  const momentNow = (() => {
    const schedule = locals.change.after.get('schedule')[0];

    if (schedule.startTime) {
      // Do not adjust timestamp because this timestamp is
      // straight from user's device
      return momentTz(schedule.startTime);
    }

    return momentTz(locals.change.after.createTime.toDate())
      .tz(timezone);
  })();

  const dateToday = momentNow.date();
  const monthYearString = momentNow
    .format(dateFormats.MONTH_YEAR);
  const reimbursementsDoc = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .doc(monthYearString)
    .collection(phoneNumber)
    .doc(`${dateToday}`)
    .get();

  const newObject = {
    phoneNumber,
    activityId,
    timestamp: Date.now(),
    template: locals.change.after.get('template'),
    details: locals.change.after.get('attachment.Details.value') || '',
    activityName: locals.change.after.get('activityName') || '',
    createTimestamp: locals.change.after.createTime.toDate().getTime(),
    amount: locals.change.after.get('attachment.Amount.value'),
    status: locals.change.after.get('status'),
    photoURL: locals.change.after.get('attachment.Photo URL.value') || '',
    claimType: locals.change.after.get('attachment.Claim Type.value'),
  };

  if (locals.addendumDocData
    && locals.addendumDocData.action === httpsActions.changeStatus
    && newObject.status === 'CONFIRMED') {
    newObject
      .claimConfirmedBy = locals.addendumDocData.user;
    newObject
      .claimConfirmedAt = Date.now();
  }

  if (locals.addendumDocData
    && locals.addendumDocData.venueQuery) {
    newObject
      .identifier = locals.addendumDocData.venueQuery.location;
  }

  const reimbursementsData = reimbursementsDoc.data()
    || Object.assign({}, {
      phoneNumber,
      date: dateToday,
      month: momentNow.month(),
      year: momentNow.year(),
    });

  reimbursementsData
    .reimbursements = reimbursementsData.reimbursements || [];

  const index = reimbursementsData
    .reimbursements
    .findIndex(el => el.activityId === activityId);

  if (index > -1) {
    reimbursementsData
      .reimbursements[
      index
    ] = newObject;
  } else {
    reimbursementsData
      .reimbursements
      .push(newObject);
  }

  batch
    .set(reimbursementsDoc.ref, reimbursementsData, { merge: true });

  // claim updated
  if (locals.change.before.data()) {
    const oldSchedule = locals.change.before.get('schedule')[0];
    const oldMoment = momentTz(oldSchedule.startTime);

    if (oldSchedule.startTime
      && !momentNow.isSame(oldSchedule.startTime, 'day')) {
      const oldDoc = await rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.REIMBURSEMENTS)
        .doc(oldMoment.format(dateFormats.MONTH_YEAR))
        .collection(phoneNumber)
        .doc(`${oldMoment.date()}`)
        .get();

      const oldData = oldDoc
        .data() || {};

      oldData
        .reimbursements = oldData.reimbursements || [];

      if (oldDoc.exists) {
        const index = oldData
          .reimbursements
          .findIndex(el => el.activityId === activityId);

        if (index > -1) {
          oldData
            .reimbursements
            .splice(index, 1);

          batch
            .set(oldDoc.ref, oldData, { merge: true });
        }
      }
    }
  }

  return batch
    .commit();
};


const handleCheckInActionForkmAllowance = async locals => {
  if (!locals.addendumDoc
    || !locals.previousAddendumDoc) {
    return;
  }

  const phoneNumber = locals.change.after.get('creator.phoneNumber');
  const officeId = locals.change.after.get('officeId');
  const timezone = locals.change.after.get('timezone');
  const batch = db.batch();
  const momentNow = momentTz()
    .tz(timezone);
  const currentCity = locals.city;
  const prevCity = locals.previousAddendumDoc.get('city');
  const monthYearString = momentNow.format(dateFormats.MONTH_YEAR);
  const prevCheckInDate = locals.previousAddendumDoc.get('date');
  const currentCheckInDate = locals.addendumDocData.date;
  const currentGeopoint = locals.addendumDocData.location;
  const isSameDate = prevCheckInDate === currentCheckInDate;
  let previousGeopoint = locals.previousAddendumDoc.get('location');

  if (!isSameDate) {
    const employeeDocQr = await rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('template', '==', 'employee')
      .where('status', '==', 'CONFIRMED')
      .where('attachment.Employee Contact.value', '==', phoneNumber)
      .limit(1)
      .get();

    const baseLocation = (() => {
      if (employeeDocQr.empty) return '';

      return employeeDocQr.docs[0].get('attachment.Base Location.value');
    })();

    const branchQr = await rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', 'branch')
      .where('attachment.Name.value', '==', baseLocation)
      .limit(1)
      .get();

    if (!branchQr.empty) {
      previousGeopoint = branchQr.docs[0].get('venue')[0].geopoint;
    }
  }

  const distanceTravelled = (async () => {
    if (isSameDate) {
      return locals
        .addendumDocData
        .distanceTravelled;
    }

    const distanceMatrixApiResult = await googleMapsClient
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
      .asPromise();

    const distanceResult = distanceMatrixApiResult
      .json
      .rows[0]
      .elements[0]
      .distance;

    if (!distanceResult) {
      return haversineDistance(currentGeopoint, previousGeopoint);
    }

    return distanceResult
      .value / 1000;
  })();

  // local => user's current city is the city of the user's base location

  const isLocal = currentCity === prevCity && distanceTravelled > 0;
  const isTravel = currentCity !== prevCity && distanceTravelled > 0;

  const includeBranch = (() => {
    if (!locals.addendumDocData.venueQuery) {
      return false;
    }

    return locals
      .addendumDocData
      .venueQuery
      .location
      .endsWith('BRANCH');
  })();

  const office = locals.change.after.get('office');

  // Previous or current action is 'check-in';
  const scheduledOnly = locals
    .addendumDocData
    .action === httpsActions.checkIn
    || locals
      .previousAddendumDoc
      .get('action') === httpsActions.checkIn;

  let kmActivitiesQueryBase = rootCollections
    .offices
    .doc(officeId)
    .collection('Activities')
    .where('template', '==', 'km allowance')
    .where('isCancelled', '==', false);

  if (includeBranch) {
    kmActivitiesQueryBase = kmActivitiesQueryBase
      .where('attachment.Include Branch.value', '==', true);
  }

  if (scheduledOnly) {
    kmActivitiesQueryBase = kmActivitiesQueryBase
      .where('attachment.Scheduled Only.value', '==', true);
  }

  const kmAllowanceActivities = await kmActivitiesQueryBase
    .get();

  if (kmAllowanceActivities.empty) {
    return;
  }

  if (kmAllowanceActivities.size > 1) {
    const o = {
      phoneNumber,
      isLocal,
      isTravel,
      includeBranch,
      scheduledOnly,
      office,
      ids: `${kmAllowanceActivities.docs.map(doc => doc.id)}`,
    };

    batch
      .set(rootCollections
        .instant
        .doc(), {
        subject: `${process.env.GCLOUD_PROJECT}:`
          + ` KM Allowances found > 2. Office: ${office}`,
        messageBody: `<pre>
          ${JSON.stringify(o, ' ', 2)}
        </pre>`,
      });
  }

  const reimbursementsDoc = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .doc(monthYearString)
    .collection(phoneNumber)
    .doc(`${momentNow.date()}`)
    .get();

  const reimbursementsDocData = (() => {
    if (reimbursementsDoc.exists) {
      return reimbursementsDoc.data();
    }

    return {
      phoneNumber,
      date: momentNow.date(),
      month: momentNow.month(),
      year: momentNow.year(),
    };
  })();

  reimbursementsDocData
    .reimbursements = reimbursementsDocData.reimbursements || [];

  const kmAllowanceActivity = kmAllowanceActivities
    .docs[0];
  const amount = dinero({
    amount: Number(kmAllowanceActivity.get('attachment.Rate.value') || 0),
  })
    .multiply(Number(await distanceTravelled || 0))
    .getAmount();

  const newObject = {
    amount,
    distanceTravelled: await distanceTravelled,
    name: kmAllowanceActivity.get('attachment.Name.value'),
    activityId: kmAllowanceActivity.id,
    template: kmAllowanceActivity.get('template'),
    rate: kmAllowanceActivity.get('attachment.Rate.value'),
    geopoint: locals.addendumDocData.location,
  };

  const indexOfObject = reimbursementsDocData
    .reimbursements
    .findIndex(el => {
      return el.activityId === kmAllowanceActivity.id;
    });

  const claimedToday = reimbursementsDocData
    .reimbursements
    .reduce((acc, el) => Number(acc) + Number(el.amount), 0);

  const dailyLimit = kmAllowanceActivity
    .get('attachment.Daily Limit.value');

  if (dailyLimit
    && (claimedToday > dailyLimit)) {
    return;
  }

  if (indexOfObject === -1) {
    reimbursementsDocData
      .reimbursements
      .push(newObject);
  } else {
    reimbursementsDocData
      .reimbursements[
      indexOfObject
    ] = newObject;
  }

  batch
    .set(reimbursementsDoc.ref, reimbursementsDocData, {
      merge: true,
    });

  return batch
    .commit();
};

const getReimbursementTimestamp = activityDoc => {
  const template = activityDoc.get('template');

  // For claim, if the schedule timestamp is present, that timestamp
  // will be the claim timestamp
  // otherwise, activity create time is the fallback.
  if (template === 'claim'
    && activityDoc.get('schedule')[0]
    && Number.isInteger(activityDoc.get('schedule')[0].startTime)) {
    return activityDoc.get('schedule')[0].startTime;
  }

  return activityDoc.createTime.toDate().getTime();
};


const reimburseClaim = async locals => {
  console.log('In reimburse claim');

  const phoneNumber = getValueFromActivity(locals.change, 'creator.phoneNumber');
  const timestamp = getReimbursementTimestamp(locals.change.after);
  const officeId = getValueFromActivity(locals.change, 'officeId');
  const timezone = getValueFromActivity(locals.change, 'timezone');
  const momentNow = momentTz(timestamp).tz(timezone);
  const status = getValueFromActivity(locals.change, 'status');
  let uid = locals.addendumDocData.uid;

  if (!uid) {
    uid = (await getAuth(locals.addendumDocData.user)).uid;
  }

  const claimsToday = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .where('date', '==', momentNow.date())
    .where('month', '==', momentNow.month())
    .where('year', '==', momentNow.year())
    .where('phoneNumber', '==', phoneNumber)
    .where('activityId', '==', locals.change.after.id)
    .limit(1)
    .get();

  const claimsDoc = (() => {
    if (claimsToday.empty) {
      return rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.REIMBURSEMENTS)
        .doc();
    }

    return claimsToday.docs[0].ref;
  })();

  const employeeData = await getEmployeeReportData(
    officeId,
    phoneNumber
  );

  const date = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();

  const claimUpdate = Object.assign({}, employeeData, {
    status,
    date,
    month,
    year,
    timestamp: Date.now(),
    currency: 'INR',
    reimbursementType: 'claim',
    activityId: locals.change.after.id,
    claimId: locals.change.after.id,
    office: locals.change.after.get('office'),
    officeId: locals.change.after.get('officeId'),
    reimbursementName: locals.change.after.get('attachment.Claim Type.value'),
    template: getValueFromActivity(locals.change, 'template'),
    photoURL: getValueFromActivity(locals.change, 'attachment.Photo URL.value'),
    amount: getValueFromActivity(locals.change, 'attachment.Amount.value'),
    claimType: getValueFromActivity(locals.change, 'attachment.Claim Type.value'),
  });

  const batch = db.batch();

  if (locals.addendumDocData.action === httpsActions.changeStatus) {
    if (status === 'CANCELLED') {
      claimUpdate
        .cancelledBy = locals.addendumDocData.user;
      claimUpdate
        .cancellationTimestamp = locals.addendumDocData.timestamp;
    }

    if (status === 'CONFIRMED') {
      claimUpdate
        .confirmedBy = locals.addendumDocData.user;
      claimUpdate
        .confirmationTimestamp = locals.addendumDocData.timestamp;
    }
  }

  batch
    .set(claimsDoc, claimUpdate, {
      merge: true,
    });

  console.log('claimsDoc', claimsDoc.path);

  batch
    .set(rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), {
      officeId,
      phoneNumber,
      date,
      month,
      year,
      timestamp: Date.now(),
      activityId: locals.change.after.id,
      _type: addendumTypes.REIMBURSEMENT,
      office: locals.change.after.get('office'),
      amount: locals.change.after.get('attachment.Amount.value'),
      id: `${date}${month}${year}${claimsDoc.id}`,
      key: momentNow.clone().startOf('day').valueOf(),
      currency: 'INR',
      reimbursementType: 'claim',
      reimbursementName: locals.change.after.get('attachment.Claim Type.value') || '',
      details: {
        status,
        rate: null,
        checkInTimestamp: null,
        startLocation: null,
        endLocation: null,
        distanceTravelled: locals.addendumDocData.distanceTravelled,
        photoURL: locals.change.after.get('attachment.Photo URL.value') || '',
        claimId: locals.change.after.id,
      },
    }, {
      merge: true,
    });

  return batch
    .commit();
};

const reimburseDailyAllowance = async locals => {
  const phoneNumber = getValueFromActivity(locals.change, 'creator.phoneNumber');
  const officeId = getValueFromActivity(locals.change, 'officeId');
  const timestamp = getReimbursementTimestamp(locals.change.after);
  const momentNow = momentTz(timestamp);
  const action = locals.addendumDocData.action;
  const scheduledOnly = action === httpsActions.checkIn;
  const existingDailyAllowances = new Set();
  let uid = locals.addendumDocData.uid;

  if (!uid) {
    const auth = await admin
      .auth()
      .getUserByPhoneNumber(phoneNumber);

    uid = auth.uid;
  }

  const claimsToday = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .where('date', '==', momentNow.date())
    .where('month', '==', momentNow.month())
    .where('year', '==', momentNow.year())
    .where('reimbursementType', '==', 'daily allowance')
    .where('phoneNumber', '==', phoneNumber)
    .get();

  claimsToday
    .forEach(doc => {
      existingDailyAllowances
        .add(doc.get('reimbursementName'));
    });

  console.log('scheduledOnly', scheduledOnly);

  let dailyAllowanceBaseQuery = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ACTIVITIES)
    .where('template', '==', 'daily allowance')
    .where('isCancelled', '==', false);

  if (scheduledOnly) {
    dailyAllowanceBaseQuery = dailyAllowanceBaseQuery
      .where('attachment.Scheduled Only.value', '==', true);
  }

  const dailyAllowanceActivities = await dailyAllowanceBaseQuery
    .get();

  console.log('dailyAllowanceActivities', dailyAllowanceActivities.size);

  if (dailyAllowanceActivities.empty) {
    return;
  }

  const employeeDocData = await getEmployeeReportData(
    officeId,
    phoneNumber
  );

  const batch = db.batch();

  dailyAllowanceActivities
    .forEach(daActivity => {
      const attachmentName = daActivity.get('attachment.Name.value');
      const [startHours, startMinutes] = daActivity
        .get('attachment.Start Time.value')
        .split(':');
      const [endHours, endMinutes] = daActivity
        .get('attachment.End Time.value')
        .split(':');

      if (startHours === ''
        || startMinutes === ''
        || endHours === ''
        || endMinutes === '') {
        return;
      }

      const momentStart = momentTz()
        .hours(startHours)
        .minutes(startMinutes);
      const momentEnd = momentTz()
        .hours(endHours)
        .minutes(endMinutes);

      /** Is not in the time range */
      if (momentNow.isBefore(momentStart)
        || momentEnd.isAfter(momentEnd)) {
        return;
      }

      if (existingDailyAllowances.has(attachmentName)) {
        return;
      }

      const date = momentNow.date();
      const month = momentNow.month();
      const year = momentNow.year();

      const update = Object
        .assign({}, employeeDocData, {
          uid,
          officeId,
          date,
          month,
          year,
          phoneNumber,
          timestamp: Date.now(),
          office: locals.change.after.get('office'),
          reimbursementType: daActivity.get('template'),
          checkInTimestamp: locals.change.after.get('timestamp'),
          reimbursementName: daActivity.get('attachment.Name.value'),
          attachmentName: daActivity.get('attachment.Name.value'),
          amount: daActivity.get('attachment.Amount.value'),
          relevantActivityId: locals.change.after.id,
          dailyAllowanceActivityId: daActivity.id,
          geopoint: locals.addendumDocData.location,
        });

      const ref = rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.REIMBURSEMENTS)
        .doc();

      batch
        .set(ref, update, {
          merge: true,
        });

      batch
        .set(rootCollections
          .updates
          .doc(uid)
          .collection(subcollectionNames.ADDENDUM)
          .doc(), Object.assign({}, {
            date,
            month,
            year,
            officeId,
            currency: 'INR',
            timestamp: Date.now(),
            amount: daActivity.get('attachment.Amount.value'),
            office: locals.change.after.get('office'),
            _type: addendumTypes.REIMBURSEMENT,
            key: momentNow.clone().startOf('day').valueOf(),
            id: `${date}${month}${year}${ref.id}`,
            reimbursementType: daActivity.get('template'),
            reimbursementName: daActivity.get('attachment.Name.value'),
            details: {
              rate: null,
              checkInTimestamp: locals.change.after.get('timestamp'), // unix
              startLocation: null, // start
              endLocation: null, // end
              distanceTravelled: locals.addendumDocData.distanceTravelled,
              photoURL: null,
              status: null,
              claimId: null,
            },
          }), {
          merge: true,
        });
    });

  return batch
    .commit();
};

const getDistanceValue = async params => {
  const {
    officeId,
    prevDate,
    currDate,
    baseLocation,
    currentLocation,
    distanceTravelled,
    startPointLatitude,
    startPointLongitude,
    previousAddendumDoc,
  } = params;

  // if action is create, checkin - then look
  // for scheduled only false in
  // employee object and make km allowance if available
  // basis same logic of previous checkin is same
  // date then km allowance
  // between the two else km allowance from
  // startpoint / base location to both

  // if action is checkin - then look for scheduled
  // only true in employee and make km allowance
  // if available basis same logic of previous
  // action == checkin, same date then km
  // allowance between the two else km allowance
  // from start point / base location from both


  let baseLocationGeopoints;

  if (currDate === prevDate) {
    return {
      previousIdentifier: previousAddendumDoc
        .get('venueQuery.location')
        || previousAddendumDoc
          .get('identifier') || '',
      previousGeopoint: previousAddendumDoc.get('location') || null,
      distance: distanceTravelled,
    };
  }

  // date is not same => day changed.
  // Calculate distance from start point to current location.
  // if start point is not present
  if (!startPointLatitude || !startPointLongitude) {
    const baseLocationQuery = await rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ACTIVITIES)
      .where('attachment.Name.value', '==', baseLocation)
      .where('template', '==', 'branch')
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get();

    const baseLocationDoc = baseLocationQuery.docs[0];

    if (!baseLocationDoc) {
      // No base location and no start point
      return {
        distance: 0,
        previousIdentifier: null,
        previousGeopoint: null,
      };
    }

    baseLocationGeopoints = baseLocationDoc.get('venue')[0].location;
  }

  if (!baseLocationGeopoints) {
    return {
      previousIdentifier: null,
      distance: 0,
      previousGeopoint: null,
    };
  }

  return {
    previousIdentifier: baseLocation,
    previousGeopoint: baseLocationGeopoints,
    distance: await getDistanceFromDistanceMatrix(
      baseLocationGeopoints,
      currentLocation
    ),
  };
};


const reimburseKmAllowance = async locals => {
  console.log('in reimburseKmAllowance');

  const {
    timestamp,
    uid,
  } = locals.addendumDocData;
  const {
    creator: {
      phoneNumber,
    },
    office,
    officeId,
    timezone,
  } = locals.change.after.data();

  const employeeDoc = (await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ACTIVITIES)
    .where('template', '==', 'employee')
    .where('attachment.Employee Contact.value', '==', phoneNumber)
    .where('status', '==', 'CONFIRMED')
    .limit(1)
    .get())
    .docs[0];

  console.log('employeeDoc', !!employeeDoc);

  // Not an employee, km allowance is skipped
  if (!employeeDoc) {
    return;
  }

  const {
    value: kmRate,
  } = employeeDoc.get('attachment.KM Rate');
  const {
    value: kmDailyLimit,
  } = employeeDoc.get('attachment.KM Daily Limit');
  const {
    value: startPointLatitude,
  } = employeeDoc.get('attachment.Start Point Latitude');
  const {
    value: startPointLongitude,
  } = employeeDoc.get('attachment.Start Point Longitude');
  const {
    value: scheduledOnly,
  } = employeeDoc.get('attachment.Scheduled Only');

  // Scheduled Only means action === check-in. Exit otherwise
  if (scheduledOnly
    && (locals.addendumDocData.action !== httpsActions.checkIn)) {
    return;
  }

  if (!kmRate) {
    return;
  }

  const momentNow = momentTz(timestamp).tz(timezone);
  const date = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();
  const kmAllowancesToday = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .where('phoneNumber', '==', phoneNumber)
    .where('reimbursementType', '==', 'km allowance')
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .get();

  console.log('kmAllowancesToday', kmAllowancesToday.size);

  const oldSum = kmAllowancesToday
    .docs
    .reduce((prevSum, doc) => {
      return prevSum
        + Number(doc.get('amount') || 0);
    }, 0);

  console.log('oldSum', oldSum);

  /** Max allowances granted already */
  if (kmDailyLimit
    && (oldSum >= Number(kmDailyLimit))) {
    console.log('km limit reached');
    return;
  }

  const {
    distance,
    previousGeopoint,
    previousIdentifier,
  } = await getDistanceValue({
    officeId,
    startPointLatitude,
    startPointLongitude,
    previousAddendumDoc: locals.previousAddendumDoc,
    previousGeopoint: locals.previousGeopoint,
    distanceTravelled: locals.addendumDocData.distanceTravelled,
    prevDate: locals.previousAddendumDoc.get('date'),
    currDate: locals.addendumDocData.date,
    baseLocation: employeeDoc.get('attachment.Base Location.value'),
    currentLocation: locals.addendumDocData.location,
  });

  console.log('after getDistanceValue', {
    distance,
    previousGeopoint,
  });

  if (distance === 0) {
    return;
  }

  const batch = db.batch();

  const prevToCurrReim = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .doc();
  const currToStartReim = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .doc();
  const prevToCurrUpdateRef = rootCollections
    .updates
    .doc(uid)
    .collection(subcollectionNames.ADDENDUM)
    .doc();
  const currToStartUpdateRef = rootCollections
    .updates
    .doc(uid)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  console.log('prevToCurrReim', prevToCurrReim.path);
  console.log('currToStartReim', currToStartReim.path);
  console.log('prevToCurrUpdateRef', prevToCurrUpdateRef.path);
  console.log('currToStartUpdateRef', currToStartUpdateRef.path);

  batch
    .set(currToStartReim, {
      // Current to start point
      // current and previous locations are reversed
      uid,
      office,
      date,
      month,
      year,
      officeId,
      phoneNumber,
      timestamp,
      rate: kmRate,
      intermediateKmAllowance: true,
      distanceTravelled: distance,
      currentIdentifier: previousIdentifier,
      previousGeopoint: locals.addendumDocData.location,
      previousIdentifier: (() => {
        if (locals.addendumDocData.venueQuery) {
          return locals
            .addendumDocData
            .venueQuery
            .location;
        }

        return locals
          .addendumDocData
          .identifier;
      })(),
      currentGeopoint: previousGeopoint,
      reimbursementType: 'km allowance',
      relevantActivityId: locals.change.after.id,
      amount: (Number(kmRate) * distance).toFixed(2),
    });

  batch
    .set(prevToCurrReim, {
      // prev to current reimbursement
      uid,
      office,
      date,
      month,
      year,
      officeId,
      phoneNumber,
      previousIdentifier,
      previousGeopoint,
      rate: kmRate,
      distanceTravelled: distance,
      timestamp: Date.now(),
      currentIdentifier: (() => {
        if (locals.addendumDocData.venueQuery) {
          return locals
            .addendumDocData
            .venueQuery
            .location;
        }

        return locals
          .addendumDocData
          .identifier;
      })(),
      currentGeopoint: locals.addendumDocData.location,
      reimbursementType: 'km allowance',
      relevantActivityId: locals.change.after.id,
      amount: (Number(kmRate) * distance).toFixed(2),
    }, {
      merge: true,
    });

  batch
    .set(prevToCurrUpdateRef, {
      // prev to curr
      date,
      month,
      year,
      office,
      officeId,
      previousGeopoint,
      currency: 'INR',
      timestamp: Date.now(),
      amount: (Number(kmRate) * distance).toFixed(2),
      _type: addendumTypes.REIMBURSEMENT,
      id: `${date}${month}${year}${prevToCurrUpdateRef.id}`,
      key: momentNow.clone().startOf('day').valueOf(),
      reimbursementType: 'km allowance',
      reimbursementName: null, // used for attachment.Claim Type.value for 'claim' activities
      details: {
        rate: kmRate,
        startLocation: locals.addendumDocData.location,
        checkInTimestamp: locals.change.after.get('timestamp'),
        endLocation: previousGeopoint,
        distanceTravelled: distance,
        photoURL: null,
        status: null,
        claimId: null,
      },
    });

  // prevToCurrent
  batch
    .set(currToStartUpdateRef, {
      // curr to start point
      date,
      month,
      year,
      office,
      officeId,
      previousGeopoint,
      timestamp: Date.now(),
      _type: addendumTypes.REIMBURSEMENT,
      amount: (Number(kmRate) * distance).toFixed(2),
      currency: 'INR',
      id: `${date}${month}${year}${currToStartReim.id}`,
      key: momentNow.clone().startOf('day').valueOf(),
      reimbursementType: 'km allowance',
      intermediateKmAllowance: true,
      reimbursementName: null, // used for attachment.Claim Type.value for 'claim' activities
      details: {
        rate: kmRate,
        startLocation: previousGeopoint,
        checkInTimestamp: locals.change.after.get('timestamp'),
        endLocation: locals.addendumDocData.location,
        distanceTravelled: distance,
        photoURL: null,
        status: null,
        claimId: null,
      },
    }, {
      merge: true,
    });

  const intermReimbursementsDoc = (await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('intermediateKmAllowance', '==', true)
    .where('reimbursementType', '==', 'km allowance')
    .where('phoneNumber', '==', phoneNumber)
    .limit(1)
    .get())
    .docs[0];

  const intermReimbursementUpdateDoc = (await rootCollections
    .updates
    .doc(uid)
    .collection(subcollectionNames.ADDENDUM)
    .where('intermediateKmAllowance', '==', true)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('reimbursementType', '==', 'km allowance')
    .limit(1)
    .get())
    .docs[0];

  if (intermReimbursementUpdateDoc) {
    console.log('deleting intermReimbursementUpdateDoc path', intermReimbursementUpdateDoc.ref.path);
    batch
      .delete(intermReimbursementUpdateDoc.ref);
  }

  console.log('deleting intermReimbursementsDoc', Boolean(intermReimbursementsDoc));
  console.log('deleting intermReimbursementUpdateDoc', Boolean(intermReimbursementUpdateDoc));

  if (intermReimbursementsDoc) {
    console.log('deleting intermReimbursementsDoc path', intermReimbursementsDoc.ref.path);

    batch
      .delete(intermReimbursementsDoc.ref);
  }

  console.log('km allowance docs', batch._ops.length);

  return batch
    .commit();
};


const handleReimbursement = async locals => {
  if (!locals.addendumDocData) {
    return;
  }

  /** Support creates/updates stuff */
  if (locals.addendumDocData.isSupportRequest) {
    return;
  }

  const template = getValueFromActivity(locals.change, 'template');

  if (template === 'claim') {
    return reimburseClaim(locals);
  }

  if (template === 'check-in'
    || locals.addendumDocData.action === httpsActions.checkIn) {
    await reimburseDailyAllowance(locals);
    await reimburseKmAllowance(locals);
  }

  return;
};


const getLateStatus = params => {
  const {
    firstCheckInTimestamp,
    dailyStartTime,
    timezone,
  } = params;

  if (Number.isInteger(firstCheckInTimestamp)) {
    return false;
  }

  if (!isNonEmptyString(dailyStartTime)) {
    return false;
  }

  const [
    startHours,
    startMinutes,
  ] = dailyStartTime
    .split(':');

  const momentStartTime = momentTz()
    .hour(startHours)
    .minutes(startMinutes);
  const momentNow = momentTz(firstCheckInTimestamp)
    .tz(timezone);

  return momentNow
    .diff(momentStartTime, 'minutes', true) > 15;
};


const handleWorkday = async locals => {
  if (!locals.addendumDocData) {
    return;
  }

  const phoneNumber = getValueFromActivity(
    locals.change,
    'creator.phoneNumber'
  );
  const officeId = getValueFromActivity(
    locals.change,
    'officeId'
  );
  const timezone = getValueFromActivity(
    locals.change,
    'timezone'
  );
  const momentNow = momentTz(locals.addendumDocData.timestamp).tz(timezone);
  const employeeData = await getEmployeeReportData(officeId, phoneNumber);
  const date = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();
  let uid = locals.addendumDocData.uid;

  if (!uid) {
    const auth = await admin
      .auth()
      .getUserByPhoneNumber(phoneNumber);

    uid = auth.uid;
  }

  const attendanceQuery = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .where('phoneNumber', '==', phoneNumber)
    .where('month', '==', month)
    .where('year', '==', year);

  const attendanceQueryResult = await attendanceQuery
    .limit(1)
    .get();

  console.log('attendanceQueryResult', attendanceQueryResult.size);

  const attendanceObject = attendanceQueryResult
    .empty ? {} : attendanceQueryResult.docs[0].data();

  attendanceObject
    .attendance = attendanceObject.attendance || {};

  attendanceObject
    .attendance[date] = attendanceObject.attendance[date] || getDefaultAttendanceObject();

  attendanceObject
    .attendance[date]
    .working = attendanceObject
      .attendance[date]
      .working || {};

  attendanceObject
    .attendance[date]
    .working
    .firstCheckInTimestamp = attendanceObject
      .attendance[date]
      .working
      .firstCheckInTimestamp
    || locals.addendumDocData.timestamp;

  attendanceObject
    .attendance[date]
    .working
    .lastCheckInTimestamp = locals.addendumDocData.timestamp;

  attendanceObject
    .attendance[date]
    .working
    .numberOfCheckIns = attendanceObject
      .attendance[date]
      .working
      .numberOfCheckIns || 0;

  attendanceObject
    .attendance[date]
    .isLate = getLateStatus({
      firstCheckInTimestamp: attendanceObject
        .attendance[date]
        .working
        .firstCheckInTimestamp,
      dailyStartTime: employeeData.dailyStartTime,
      timezone,
    });

  // activity was created
  if (!locals.change.before.data()
    && locals.change.after.data()) {
    attendanceObject
      .attendance[date]
      .working
      .numberOfCheckIns++;
  }

  attendanceObject
    .attendance[date].addendum = attendanceObject
      .attendance[date].addendum || [];
  const currentDate = momentTz(locals.addendumDocData.timestamp);

  if (attendanceObject.attendance[date].addendum[0]) {
    const previousDate = momentTz(
      attendanceObject.attendance[date].addendum[0].timestamp
    );

    if ((previousDate.date() !== currentDate.date())
      && (currentDate.diff(previousDate, 'days', true) > 1)) {
      // create empty objects for the dates which don't exist except
      // the first and the last date
      console.log('creating empty objects');

      const datesToCreate = getNumbersbetween(
        previousDate.date(),
        currentDate.date() + 1
      );

      console.log('datesToCreate', datesToCreate);

      datesToCreate
        .forEach(date => {
          /** Objects will be created only for the dates which don't exist */
          if (date === previousDate.date()
            || date === previousDate.date()) {
            return;
          }

          attendanceObject
            .attendance[date] = getDefaultAttendanceObject();
        });
    }
  }

  const location = locals.addendumDocData.location;

  attendanceObject
    .attendance[date]
    .addendum
    .push({
      timestamp: locals.addendumDocData.timestamp,
      latitude: location._latitude || location.latitude,
      longitude: location._longitude || location.longitude,
      addendumId: locals.addendumDoc.id,
    });

  /**
   * Sometimes when the code crashes or when an event is missed
   * we trigger activityOnWrite by updating the timestamp.
   * In that case, the sorting of the timestamps in this array
   * might get messed up. We cant ascending
   */
  attendanceObject
    .attendance[date]
    .addendum
    .sort((a, b) => a.timestamp - b.timestamp);

  attendanceObject
    .attendance[date]
    .attendance = await getAttendanceValueForDay(
      officeId,
      phoneNumber,
      momentNow.clone()
    );

  if (attendanceObject.attendance[date].onAr
    || attendanceObject.attendance[date].onLeave
    || attendanceObject.attendance[date].holiday
    || attendanceObject.attendance[date].weeklyOff) {
    attendanceObject
      .attendance
      .attendance = 1;
  }

  const batch = db.batch();
  const ref = (() => {
    if (attendanceQueryResult.empty) {
      return rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ATTENDANCES)
        .doc();
    }

    return attendanceQueryResult.docs[0].ref;
  })();

  const attendanceUpdate = Object.assign({
    month,
    year,
    phoneNumber,
  },
    attendanceObject,
    employeeData
  );

  batch
    .set(ref, attendanceUpdate, { merge: true });

  batch
    .set(rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), Object
        .assign({}, attendanceObject.attendance[date], {
          date,
          month,
          year,
          officeId,
          phoneNumber,
          _type: addendumTypes.ATTENDANCE,
          id: `${date}${month}${year}${officeId}`,
          key: currentDate.clone().startOf('date').valueOf(),
        }), {
      merge: true,
    });

  return batch
    .commit();
};


const ActivityOnWrite = async (change, context) => {
  /** Activity was deleted. For debugging only. */
  if (!change.after.data()) {
    return;
  }

  const {
    activityId,
  } = context.params;

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
  const batch = db.batch();
  const newProfilesMap = new Map();
  const authFetchPromises = [];
  const {
    template,
    status,
    addendumDocRef,
  } = change.after.data();
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
      .collection(subcollectionNames.ASSIGNEES)
      .get(),
  ];

  /** Could be `null` when we update the activity without user intervention */
  if (addendumDocRef) {
    promises
      .push(addendumDocRef.get());
  }

  try {
    const [
      assigneesSnapShot,
      addendumDoc,
    ] = await Promise
      .all(promises);

    if (addendumDoc) {
      locals
        .addendumDoc = addendumDoc;
    }

    assigneesSnapShot
      .forEach(doc => {
        if (addendumDoc
          && doc.id === addendumDoc.get('user')) {
          locals
            .addendumCreatorInAssignees = true;
        }

        authFetchPromises
          .push(getAuth(doc.id));

        locals
          .assigneesMap
          .set(doc.id, {
            addToInclude: doc.get('addToInclude'),
          });

        locals
          .assigneePhoneNumbersArray
          .push(doc.id);
      });

    if (addendumDoc
      && !locals.addendumCreatorInAssignees) {
      authFetchPromises
        .push(
          getAuth(addendumDoc.get('user'))
        );
    }

    let customerObject = null;

    if (template === 'duty'
      || template === 'branch duty') {
      let type = 'customer';

      if (template === 'branch duty') {
        type = 'branch';
      }

      // name, officeId, template
      customerObject = await getCustomerObject(
        locals.change.after.get('attachment.Location.value'),
        locals.change.after.get('officeId'),
        type
      );
    }

    const userRecords = await Promise
      .all(authFetchPromises);

    userRecords
      .forEach(userRecord => {
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
            customerObject,
            addendumDocRef: null,
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
                  .push({ phoneNumber, displayName, photoURL });
              });

            return result;
          })();

        /**
         * Check-ins clutter the `Activities` collection and
         * make the `/read` resource slow. If the user doesn't have
         * auth, there's no point in putting a check-in their
         * profile
         */
        if (template === 'check-in'
          && (!locals.assigneesMap.has(phoneNumber)
            || !locals.assigneesMap.get(phoneNumber).uid)) {
          return;
        }

        if (userRecord.uid) {
          // in updates only if auth exists
          batch
            .set(rootCollections
              .updates
              .doc(userRecord.uid)
              .collection(subcollectionNames.ADDENDUM)
              .doc(), Object.assign({}, profileActivityObject, {
                type: addendumTypes.ACTIVITY,
                _type: addendumTypes.ACTIVITY,
              }), {
              merge: true,
            });
        }

        // in profile
        batch
          .set(rootCollections
            .profiles
            .doc(phoneNumber)
            .collection(subcollectionNames.ACTIVITIES)
            .doc(activityId), profileActivityObject, {
            merge: true
          });
      });

    console.log({
      template,
      activityId,
      action: locals
        .addendumDoc ? locals.addendumDoc.get('action') : 'manual update',
    });

    const activityData = Object
      .assign({}, change.after.data(), {
        timestamp: Date.now(),
        isCancelled: status === 'CANCELLED',
        addendumDocRef: null,
        creationTimestamp: change.after.createTime.toDate().getTime(),
      });

    if (addendumDoc
      && addendumDoc.get('action') === httpsActions.create) {
      const momentToday = momentTz().tz(change.after.get('timezone'));

      activityData
        .creationDate = momentToday.date();
      activityData
        .creationMonth = momentToday.month();
      activityData
        .creationYear = momentToday.year();
    }

    if (customerObject) {
      activityData
        .customerObject = customerObject;
    }

    if (template === 'office') {
      activityData
        .slug = slugify(activityData.attachment.Name.value);
    }

    const copyToRef = getCopyPath(
      template,
      locals.change.after.get('officeId'),
      activityId,
    );

    console.log(template, copyToRef.path);

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
      await require('./template-handlers/office')(locals);
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
      await setLocationsReadEvent(locals);
    }

    if (template === 'admin') {
      await require('./template-handlers/admin')(locals);
    }

    if (template === 'leave') {
      await handleLeaveAndDutyConflict(locals);

      await require('./template-handlers/leave')(locals);
    }

    if (template === 'check-in') {
      await handleRelevantTimeActivities(locals);
      await handleWorkday(locals);
    }

    if (template.endsWith('-type')) {
      await handleTypeActivityCreation(locals);
    }

    if (template === 'claim') {
      await handleClaim(locals);
    }

    if (template === 'attendance regularization') {
      await require('./template-handlers/ar')(locals);
    }

    // if (template === 'leave-type') {
    //   // stuff
    // }

    if (locals.addendumDocData
      && locals.addendumDocData.action === httpsActions.checkIn) {
      await handleCheckInActionForkmAllowance(locals);
      await handleCheckInActionForDailyAllowance(locals);
    }

    await handleActivityUpdates(locals);
    await handleReimbursement(locals);

    return;
  } catch (error) {
    console.error({
      error,
      context,
      activityId: change.after.id,
    });
  }
};


module.exports = ActivityOnWrite;
