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
  populateWeeklyOffInAttendance,
  getLatLngString,
  getDistanceFromDistanceMatrix,
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
const googleMapsClient = require('@google/maps')
  .createClient({
    key: env.mapsApiKey,
    Promise: Promise,
  });


const getLocationUrl = plusCode =>
  `https://plus.codes/${plusCode}`;

const getLocalityCityState = mapsApiResult => {
  let locality = '';
  let city = '';
  let state = '';

  if (mapsApiResult.json.results.length === 0) {
    return { locality, city, state };
  }

  const {
    address_components: components,
  } = mapsApiResult.json.results[0];

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

const getCustomerObject = async ({ name, officeId, template }) => {
  if (!name) {
    return null;
  }

  const customerActivityResult = await rootCollections
    .activities
    .where('template', '==', template)
    .where('attachment.Name.value', '==', name)
    .where('officeId', '==', officeId)
    .where('status', '==', 'CONFIRMED')
    .get();

  const [customerDoc] = customerActivityResult.docs;

  if (!customerDoc) {
    return null;
  }

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
      )
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

  const {
    value: employeeContact
  } = locals.change.after.get('attachment.Employee Contact');

  const runQuery = (query, resolve, reject) => {
    query
      .get()
      .then(docs => {
        if (docs.empty) {
          return 0;
        }

        const batch = db.batch();

        docs
          .forEach(doc => {
            const template = doc.get('template'); // leave/ar etc
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
              && employeeContact === phoneNumberInAttachment) {
              batch
                .set(rootCollections.activities.doc(doc.id), {
                  status: 'CANCELLED',
                  addendumDocRef: null,
                }, {
                  merge: true,
                });

              return;
            }


            // TODO: Check if this is required since AssigneOnDelete
            // does this stuff automatically.
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
              .delete(
                rootCollections
                  .activities
                  .doc(doc.id)
                  .collection(subcollectionNames.ASSIGNEES)
                  .doc(employeeContact)
              );
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
  };

  const query = rootCollections
    .profiles
    .doc(employeeContact)
    .collection(subcollectionNames.ACTIVITIES)
    .where('office', '==', office)
    .orderBy('__name__')
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
  const { after: activityDoc } = locals.change;

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
              .delete(
                activityRef
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
  const { value: phoneNumber } = employeeDoc.get('attachment.Employee Contact');
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

const handleBranchWeeklyOffUpdate = async locals => {
  if (!locals.change.before.data()) {
    // Activity has been created. Nothing is updated in this instance.
    return;
  }

  const {
    officeId,
    timezone,
    attachment: {
      Name: {
        value: branchName,
      },
      'Weekly Off': {
        value: weeklyOffNew,
      },
    },
  } = locals.change.after.data();

  const {
    attachment: {
      'Weekly Off': {
        value: weeklyOffOld,
      },
    },
  } = locals.change.before.get('attachment');

  // Nothing changed
  if (!isNonEmptyString(weeklyOffOld) && (weeklyOffOld === weeklyOffNew)) {
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

  const momentToday = momentTz().tz(timezone || 'Asia/Kolkata');
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

      attendanceQueries.push(
        base
          .where('month', '==', momentToday.month())
          .where('year', '==', momentToday.year())
          .limit(1)
          .get()
      );

      if (prevMonth) {
        attendanceQueries.push(
          base
            .where('month', '==', prevMonth.month())
            .where('year', '==', prevMonth.year())
            .limit(1)
            .get()
        );
      }
    });

  const attendanceSnaps = await Promise.all(attendanceQueries);
  const batch = db.batch();

  attendanceSnaps.forEach(snap => {
    const doc = snap.docs[0];
    const { year, month } = doc.data();
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

  const { status, officeId } = locals.change.after.data();

  batch
    .set(recipientsDocRef, {
      status,
      include: locals.assigneePhoneNumbersArray,
      cc: locals.change.after.get('attachment.cc.value'),
      office: locals.change.after.get('office'),
      report: locals.change.after.get('attachment.Name.value'),
      officeId: locals.change.after.get('officeId'),
    }, {
      /**
       * Required since anyone updating the this activity will cause
       * the report data to be lost.
       */
      merge: true,
    });

  if (status === 'CANCELLED') {
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


const createNewProfiles = async ({ newPhoneNumbersSet, smsContext }) => {
  const profileBatch = db.batch();
  const profilePromises = [];

  const promiseCreator = phoneNumber => {
    const promise = rootCollections
      .profiles
      .doc(phoneNumber)
      .get();

    profilePromises
      .push(promise);
  };

  newPhoneNumbersSet
    .forEach(promiseCreator);

  const snap = await Promise
    .all(profilePromises);
  const batchCreator = doc => {
    /** Profile already exists */
    if (doc.exists) {
      return;
    }

    // doc.id => phoneNumber
    profileBatch.set(doc.ref, { smsContext }, { merge: true });
  };

  snap.forEach(batchCreator);

  return profileBatch.commit();
};


const getCopyPath = ({ template, officeId, activityId }) => {
  if (template === 'office') {
    return rootCollections
      .offices
      .doc(activityId);
  }

  return rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ACTIVITIES)
    .doc(activityId);
};


/**
* Checks if the action was a comment.
* @param {string} action Can be one of the activity actions from HTTPS functions.
* @returns {number} 0 || 1 depending on whether the action was a comment or anything else.
*/
const isComment = action => {
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
  const { action } = locals.addendumDoc.data();
  const pronoun = getPronoun(locals, recipient);
  const template = locals.addendumDoc.get('activityData.template');

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
    const { share } = locals.addendumDoc.data();
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
    const oldPhoneNumber = locals.addendumDoc.get('oldPhoneNumber');
    const newPhoneNumber = locals.addendumDoc.get('newPhoneNumber');

    // Employee changed their number themselves
    if (locals.addendumDocRef.get('user') === oldPhoneNumber) {
      // <person name> changed their phone number
      // from < old phone number > to < new phone number >
      const employeeName = locals
        .addendumDoc
        .get('activityData.attachment.Name.value');

      return `${employeeName} changed their phone number`
        + ` from ${oldPhoneNumber}`
        + ` to ${newPhoneNumber}`;
    }

    return `Phone number`
      + ` '${oldPhoneNumber} was`
      + ` changed to ${newPhoneNumber}`;
  }

  /** Action is `comment` */
  return locals.addendumDoc.get('comment');
};

const getRegTokenMap = async assigneesMap => {
  const regTokenMap = new Map();
  const updateDocRefs = [];

  assigneesMap
    .forEach(userRecord => {
      const { uid } = userRecord;

      if (!uid) {
        return;
      }

      const ref = rootCollections
        .updates
        .doc(uid);

      updateDocRefs.push(ref);
    });

  const updateDocs = await db.getAll(...updateDocRefs);

  updateDocs.forEach(doc => {
    const { phoneNumber, registrationToken } = doc.data();

    // registrationToken can be null or undefined or a
    // non-empty string.
    if (!registrationToken) {
      return;
    }

    regTokenMap.set(phoneNumber, registrationToken);
  });

  return regTokenMap;
};


const getNotificationObject = comment => ({
  data: {
    // Ask the client to send a request to the /read endpoint
    read: '1',
  },
  notification: {
    body: comment,
    tile: `Growthfile`,
  },
});

const getCommentObject = ({ addendumDoc, activityId, comment }) => {
  return {
    comment,
    activityId,
    _type: addendumTypes.COMMENT,
    isComment: isComment(addendumDoc.get('action')),
    timestamp: addendumDoc.get('userDeviceTimestamp'),
    location: addendumDoc.get('location'),
    user: addendumDoc.get('user'),
  };
};


const handleComments = async (addendumDoc, locals) => {
  if (!addendumDoc) {
    return;
  }

  const regTokenMap = await getRegTokenMap(locals.assigneesMap);
  const batch = db.batch();
  const notificationPromises = [];

  locals.assigneePhoneNumbersArray
    .forEach(phoneNumber => {
      const { uid } = locals.assigneesMap.get(phoneNumber);
      const registrationToken = regTokenMap.get(phoneNumber);

      if (!uid || !registrationToken) {
        return;
      }

      const comment = getCommentString(locals, phoneNumber);

      console.log(phoneNumber, comment);

      batch
        .set(
          rootCollections
            .updates
            .doc(uid)
            .collection(subcollectionNames.ADDENDUM)
            .doc(), getCommentObject({
              comment,
              addendumDoc,
              activityId: locals.change.after.id,
            })
        );

      notificationPromises.push(
        admin
          .messaging()
          .sendToDevice(
            registrationToken,
            getNotificationObject(comment),
            {
              priority: 'high',
              timeToLive: 60,
            }
          )
      );
    });

  await batch
    .commit();

  return Promise
    .all(notificationPromises);
};


const createActivityStats = async addendumDoc => {
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

  const initDocRef = snapShot => {
    return snapShot
      .empty ? rootCollections.inits.doc() : snapShot.docs[0].ref;
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

  const dataObject = todayInitQuery
    .empty ? {} : todayInitQuery.docs[0].data();

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

const getVenueFromActivity = activityData => {
  const [venue] = activityData.venue;

  /**
   * Some activities might have empty venue object
   * based on template.
   */
  return venue ? venue : null;
};

const handlePopulatedVenue = ({ addendumDoc }) => {
  /** User's current location */
  const deviceLocation = {
    _latitude: addendumDoc.get('location')._latitude,
    _longitude: addendumDoc.get('location')._longitude,
  };

  const { activityData, geopointAccuracy } = addendumDoc.data();
  const activityVenue = getVenueFromActivity(activityData);
  const distanceTolerance = getAccuracyTolerance(geopointAccuracy);

  // venue is populated => calculate distabce btw actual and venue location.
  // haversineDistance(geopointOne, geopointTwo)
  return {
    distanceAccurate: haversineDistance(deviceLocation, activityVenue.geopoint) < distanceTolerance,
    venueQuery: activityVenue,
  };
};

const handleUnpopulatedVenue = async ({ addendumDoc }) => {
  // venue is not populated.
  // query db with adjusted geopoint.
  const {
    activityData,
    geopointAccuracy,
    location: currentGeopoint,
  } = addendumDoc.data();
  const { officeId } = activityData;
  const distanceTolerance = getAccuracyTolerance(geopointAccuracy);
  const adjGP = adjustedGeopoint(currentGeopoint);

  const [queriedActivity] = (
    await rootCollections
      .activities
      .where('officeId', '==', officeId)
      // Branch, and customer
      .where('adjustedGeopoints', '==', `${adjGP.latitude},${adjGP.longitude}`)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get()
  )
    .docs;

  // { isAccurate: false, venueQuery: null };
  if (!queriedActivity) {
    const mapsApiResult = await googleMapsClient.reverseGeocode({
      latlng: getLatLngString(currentGeopoint),
    })
      .asPromise();

    const csl = getLocalityCityState(mapsApiResult);
    const ui = getPlaceInformation(mapsApiResult, currentGeopoint);

    return Object.assign({}, csl, ui, {
      distanceAccurate: false,
      venueQuery: null,
    });
  }

  const [activityVenue] = queriedActivity.get('venue');
  const { geopoint: activityGeopoint } = activityVenue;

  const distanceBetween = haversineDistance(currentGeopoint, activityGeopoint);

  return {
    distanceAccurate: distanceBetween < distanceTolerance,
    venueQuery: activityVenue,
  };
};

const handleNoVenue = async ({ currentGeopoint }) => {
  const mapsApiResult = await googleMapsClient.reverseGeocode({
    latlng: getLatLngString(currentGeopoint),
  })
    .asPromise();

  /** city, state, locality */
  const csl = getLocalityCityState(mapsApiResult);
  /** url, identifier */
  const ui = getPlaceInformation(mapsApiResult, currentGeopoint);

  return Object.assign({}, csl, ui, {
    isAccurate: false,
    venueQuery: null,
  });
};

const checkDistanceAccurate = async ({ addendumDoc }) => {
  //   if activity.venue is NOT populated => use adjustedGeopoint and query / Activities collection;
  //   if a doc is found:
  //   check haversine distance between queried activity geopoint and current geopoint
  //   if distance < 1km:
  //     distance accurate = true
  //   else:
  //     distance accurate = false

  const { activityData, location: currentGeopoint } = addendumDoc.data();
  const activityVenue = getVenueFromActivity(activityData);

  /** Activity doesn't have a venue field */
  if (!activityVenue) {
    return handleNoVenue({ currentGeopoint });
  }

  if (activityVenue.location) {
    return handlePopulatedVenue({ addendumDoc });
  }

  return handleUnpopulatedVenue({ addendumDoc });
};

const setGeopointAndTimestampInCheckInSubscription = async ({ addendumDoc }) => {
  const {
    activityData: {
      office,
    },
    user: phoneNumber,
    location: lastGeopoint,
    timestamp: lastTimestamp,
  } = addendumDoc.data();

  const [checkInSubscriptionDoc] = (
    await rootCollections
      .profiles
      .doc(phoneNumber)
      .collection(subcollectionNames.SUBSCRIPTIONS)
      .where('office', '==', office)
      .where('template', '==', 'check-in')
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get()
  )
    .docs;

  if (!checkInSubscriptionDoc) {
    return;
  }

  return checkInSubscriptionDoc.ref.set({
    lastGeopoint,
    lastTimestamp,
    lastAddendumRef: addendumDoc.ref
  }, { merge: true });
};

const getDistanceTravelled = ({ previousAddendumDoc, distanceMatrixApiResult }) => {
  if (!previousAddendumDoc) {
    return 0;
  }

  const [firstRow] = distanceMatrixApiResult.json.rows;
  const [firstElement] = firstRow.elements;
  const { distance: distanceData } = firstElement;

  return distanceData ? (distanceData.value / 1000) : 0;
};


const handleAddendum = async locals => {
  const { addendumDoc } = locals;

  if (!addendumDoc) {
    return;
  }

  const {
    action,
    timestamp,
    location: currentGeopoint,
    user: phoneNumber,
  } = addendumDoc.data();

  const momentWithOffset = momentTz(timestamp)
    .tz(addendumDoc.get('activityData.timezone') || 'Asia/Kolkata');

  const isSkippableEvent = action === httpsActions.install
    || action === httpsActions.signup
    || action === httpsActions.branchView
    || action === httpsActions.productView
    || action === httpsActions.videoPlay;

  const date = momentWithOffset.date();
  const month = momentWithOffset.month();
  const year = momentWithOffset.year();

  if (isSkippableEvent) {
    return addendumDoc.ref.set({ date, month, year }, { merge: true });
  }

  /** Phone Number change addendum does not have geopoint */
  if (typeof currentGeopoint === 'undefined') {
    return handleComments(addendumDoc, locals);
  }

  const batch = db.batch();
  const promises = [];
  let previousGeopoint;

  // venue populated => fetch branch/customer activity with adjustedGeopoints {lat,lng}
  // if doc is found:
  // distanceAccurate => diff CURR and resulting activity < 1
  // if doc is not found:
  // distance accurate = false.

  //   if activity.venue is NOT populated => use adjustedGeopoint and query / Activities collection;
  //   if a doc is found:
  //   check haversine distance between queried activity geopoint and current geopoint
  //   if distance < 1km:
  //     distance accurate = true
  //   else:
  //     distance accurate = false

  const addendumQuery = await rootCollections
    .offices
    .doc(locals.change.after.get('officeId'))
    .collection(subcollectionNames.ADDENDUM)
    .where('user', '==', phoneNumber)
    .where('timestamp', '<', timestamp)
    .orderBy('timestamp', 'desc')
    .limit(2)
    .get();

  const previousAddendumDoc = (() => {
    if (addendumQuery.docs[0]
      && addendumQuery.docs[0].id !== addendumDoc.id) {
      return addendumQuery.docs[0];
    }

    return addendumQuery.docs[1];
  })();

  if (previousAddendumDoc) {
    /**
     * The field `location` could be undefined for install or
     * signup events in the previous addendum
     */
    previousGeopoint = previousAddendumDoc
      .get('location')
      || currentGeopoint;

    promises.push(
      googleMapsClient
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
        .asPromise()
    );
  }

  const [distanceMatrixApiResult] = await Promise.all(promises);

  const daR = await checkDistanceAccurate({ addendumDoc });
  const updateObject = Object
    .assign(
      {},
      daR,
      {
        date,
        month,
        year,
        customerObject: locals.customerObject,
        // [{ displayName, phoneNumber, photoURL }]
        assigneesMap: [...locals.assigneesMap.values()],
        adjustedGeopoint: adjustedGeopoint(addendumDoc.get('location')),
        distanceTravelled: getDistanceTravelled({
          previousAddendumDoc,
          distanceMatrixApiResult,
        }),
      });

  console.log('updateObject =>', updateObject);

  // Required for comment creation since the addendumDoc.data() won't contain
  // the updates made during this function instance
  locals.addendumDocData = Object.assign({},
    addendumDoc.data(),
    updateObject
  );

  locals
    .previousAddendumDoc = previousAddendumDoc;

  /**
   * Seperating this part out because handling even a single crash
   * with `addendumOnCreate` cloud function messes up whole data for the user
   * after the time of the crash.
   */
  batch.set(addendumDoc.ref, updateObject, { merge: true });

  await batch.commit();

  await setGeopointAndTimestampInCheckInSubscription({ addendumDoc });
  await createActivityStats(addendumDoc);

  return handleComments(addendumDoc, locals);
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

  const { template } = locals.change.after.data();

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
      attachment: { [field]: { value } },
    }, { merge: true });
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
        .collection(subcollectionNames.ACTIVITIES)
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
      action: httpsActions.changeStatus,
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
      activityId: locals.change.after.id,
    });

  resolvedConflictDocs
    .forEach(doc => {
      const addendumDocRef = rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ADDENDUM)
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
  const {
    creator: {
      phoneNumber,
    },
    office,
    officeId,
    status,
    timezone,
  } = locals.change.after.data();
  const timestamp = getReimbursementTimestamp(locals.change.after);
  const momentNow = momentTz(timestamp).tz(timezone);
  const date = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();
  let uid = locals.addendumDocData.uid;

  if (!uid) {
    uid = (await getAuth(locals.addendumDocData.user)).uid;
  }

  const claimsToday = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('phoneNumber', '==', phoneNumber)
    .where('claimId', '==', locals.change.after.id)
    .limit(1)
    .get();

  const claimsDocRef = !claimsToday
    .empty ? claimsToday.docs[0].ref : rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.REIMBURSEMENTS)
      .doc();

  const employeeData = await getEmployeeReportData(
    officeId,
    phoneNumber
  );

  const claimUpdate = Object.assign({}, employeeData, {
    status,
    date,
    month,
    year,
    office,
    officeId,
    timestamp: Date.now(),
    currency: 'INR',
    reimbursementType: 'claim',
    relevantActivityId: locals.change.after.id,
    claimId: locals.change.after.id,
    reimbursementName: locals.change.after.get('attachment.Claim Type.value'),
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
    .set(claimsDocRef, claimUpdate, {
      merge: true,
    });

  const claimUpdatesDoc = (await rootCollections
    .updates
    .doc(uid)
    .collection(subcollectionNames.ADDENDUM)
    .where('details.claimId', '==', locals.change.after.id)
    .limit(1)
    .get())
    .docs[0];

  const claimRef = claimUpdatesDoc ? claimUpdatesDoc.ref : rootCollections
    .updates
    .doc(uid)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  batch
    .set(claimRef, {
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
      id: `${date}${month}${year}${claimsDocRef.id}`,
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
  const reimbursementType = 'daily allowance';
  const {
    creator: {
      phoneNumber,
    },
    officeId,
    office,
    timezone,
  } = locals.change.after.data();
  const timestamp = locals.addendumDocData.timestamp;
  const momentNow = momentTz(timestamp).tz(timezone);
  const action = locals.addendumDocData.action;
  const scheduledOnly = action === httpsActions.checkIn;
  const existingDailyAllowances = new Set();
  const batch = db.batch();
  const date = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();
  let uid = locals.addendumDocData.uid;

  if (!uid) {
    uid = (await getAuth(phoneNumber)).uid;
  }

  const claimsToday = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('reimbursementType', '==', reimbursementType)
    .where('phoneNumber', '==', phoneNumber)
    .get();

  /**
   * one type of reimbursement in a single day will
   * be given to a user only once.
   */
  claimsToday
    .forEach(doc => {
      existingDailyAllowances
        .add(doc.get('reimbursementName'));
    });

  let dailyAllowanceBaseQuery = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ACTIVITIES)
    .where('template', '==', reimbursementType)
    .where('isCancelled', '==', false);

  if (scheduledOnly) {
    dailyAllowanceBaseQuery = dailyAllowanceBaseQuery
      .where('attachment.Scheduled Only.value', '==', true);
  }

  const dailyAllowanceActivities = await dailyAllowanceBaseQuery
    .get();

  if (dailyAllowanceActivities.empty) {
    return;
  }

  const employeeDocData = await getEmployeeReportData(
    officeId,
    phoneNumber
  );

  dailyAllowanceActivities
    .forEach(daActivity => {
      const attachmentName = daActivity.get('attachment.Name.value');
      const [
        startHours,
        startMinutes,
      ] = daActivity
        .get('attachment.Start Time.value')
        .split(':');
      const [
        endHours,
        endMinutes,
      ] = daActivity
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

      const update = Object
        .assign({}, employeeDocData, {
          uid,
          date,
          month,
          year,
          officeId,
          phoneNumber,
          currency: 'INR',
          reimbursementType,
          timestamp: Date.now(),
          office: locals.change.after.get('office'),
          checkInTimestamp: locals.change.after.get('timestamp'),
          reimbursementName: daActivity.get('attachment.Name.value'),
          amount: daActivity.get('attachment.Amount.value'),
          relevantActivityId: locals.change.after.id,
          dailyAllowanceActivityId: daActivity.id,
          currentGeopoint: locals.addendumDocData.location,
          previousGeopoint: (() => {
            if (locals.previousAddendumDoc
              && locals.previousAddendumDoc.get('location')) {
              return locals.previousAddendumDoc.get('location');
            }

            return null;
          })(),
          currentIdentifier: (() => {
            if (locals.addendumDocData.venueQuery) {
              return locals.addendumDocData.venueQuery.location;
            }

            return locals.addendumDocData.identifier;
          })(),
          previousIdentifier: (() => {
            if (locals.previousAddendumDoc
              && locals.previousAddendumDoc.get('venueQuery.location')) {
              return locals
                .previousAddendumDoc
                .get('venueQuery.location');
            }

            if (locals.previousAddendumDoc
              && locals.previousAddendumDoc.get('identifier')) {
              return locals
                .previousAddendumDoc
                .get('identifier');
            }

            return null;
          })(),
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

      const u = rootCollections
        .updates
        .doc(uid)
        .collection(subcollectionNames.ADDENDUM)
        .doc();

      batch
        .set(u, Object.assign({}, {
          date,
          month,
          year,
          officeId,
          office,
          currency: 'INR',
          timestamp: Date.now(),
          amount: daActivity.get('attachment.Amount.value'),
          _type: addendumTypes.REIMBURSEMENT,
          key: momentNow.clone().startOf('day').valueOf(),
          id: `${date}${month}${year}${ref.id}`,
          reimbursementType: daActivity.get('template'),
          reimbursementName: daActivity.get('attachment.Name.value'),
          details: {
            rate: null,
            checkInTimestamp: momentNow
              .tz(timezone)
              .valueOf(), // unix
            startLocation: null, // start
            endLocation: null, // end
            distanceTravelled: null,
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


const getStartPointObject = async params => {
  const {
    startPointLatitude,
    startPointLongitude,
  } = params;

  if (typeof startPointLatitude !== 'number'
    || typeof startPointLongitude !== 'number') {
    return null;
  }

  return {
    identifier: 'Start Point',
    geopoint: {
      latitude: startPointLatitude,
      longitude: startPointLongitude,
    }
  };
};

const reimburseKmAllowance = async locals => {
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

  const { timestamp } = locals.addendumDocData;
  let uid = locals.addendumDocData.uid;

  const {
    creator: {
      phoneNumber,
    },
    office,
    officeId,
    timezone,
  } = locals.change.after.data();

  if (!uid) {
    uid = (await getAuth(phoneNumber)).uid;
  }

  const [employeeDoc] = (
    await rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ACTIVITIES)
      .where('template', '==', 'employee')
      .where('attachment.Employee Contact.value', '==', phoneNumber)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get()
  )
    .docs;

  // Not an employee, km allowance is skipped
  if (!employeeDoc) {
    console.log('Skip km allowance => no employee doc');

    return;
  }

  const {
    value: kmRate,
  } = employeeDoc.get('attachment.KM Rate');
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
    console.log('Skip km allowance => scheduled Only');

    return;
  }

  if (!kmRate) {
    console.log('Skip km allowance => no km rate', kmRate);

    return;
  }

  const employeeData = {
    phoneNumber,
    employeeName: employeeDoc.get('attachment.Name.value'),
    employeeCode: employeeDoc.get('attachment.Employee Code.value'),
    baseLocation: employeeDoc.get('attachment.Base Location.value'),
    region: employeeDoc.get('attachment.Region.value'),
    department: employeeDoc.get('attachment.Department.value'),
    minimumDailyActivityCount: employeeDoc.get('attachment.Minimum Daily Activity Count.value'),
    minimumWorkingHours: employeeDoc.get('attachment.Minimum Working Hours.value'),
  };

  const reimbursementType = 'km allowance';
  const momentNow = momentTz(timestamp).tz(timezone);
  const date = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();
  const batch = db.batch();

  const commonReimObject = Object.assign({}, {
    date,
    month,
    year,
    office,
    officeId,
    uid,
    phoneNumber,
    reimbursementType,
    currency: 'INR',
    timestamp: Date.now(),
    relevantActivityId: locals.change.after.id,
  });

  const [
    previousKmReimbursementQuery,
    previousReimbursementUpdateQuery,
  ] = await Promise
    .all([
      rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.REIMBURSEMENTS)
        .where('intermediate', '==', true)
        .where('date', '==', date)
        .where('month', '==', month)
        .where('year', '==', year)
        .where('reimbursementType', '==', reimbursementType)
        .where('phoneNumber', '==', phoneNumber)
        .limit(1)
        .get(),
      rootCollections
        .updates
        .doc(uid)
        .collection(subcollectionNames.ADDENDUM)
        .where('_type', '==', addendumTypes.REIMBURSEMENT)
        .where('intermediate', '==', true)
        .where('date', '==', date)
        .where('month', '==', month)
        .where('year', '==', year)
        .where('reimbursementType', '==', reimbursementType)
        .limit(1)
        .get(),
    ]);

  const startPointDetails = await getStartPointObject({
    officeId,
    startPointLatitude,
    startPointLongitude,
    baseLocation: employeeData.baseLocation,
  });

  if (!startPointDetails) {
    console.log('Skip km allowance => no startPointDetails');

    return;
  }

  const distanceBetweenCurrentAndStartPoint = await getDistanceFromDistanceMatrix(
    startPointDetails.geopoint,
    locals.addendumDocData.location
  );

  if (distanceBetweenCurrentAndStartPoint < 1) {
    console.log('Skip km allowance => distanceBetweenCurrentAndStartPoint < 1', distanceBetweenCurrentAndStartPoint);
    return;
  }

  if (kmRate * distanceBetweenCurrentAndStartPoint < 1) {
    console.log('Skip km allowance amt < 1', kmRate * distanceBetweenCurrentAndStartPoint);
    return;
  }

  const amountThisTime = Number(kmRate) * locals.addendumDocData.distanceTravelled;

  /**
   * This function should be refactored. But I'm short on time.
   * Also don't want to touch it since it might break stuff.
   */
  if (previousKmReimbursementQuery.empty) {
    console.log('In km allowance if');
    // create km allowance for start point to current location
    // create km allowance for current location to start point.
    const r1 = rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.REIMBURSEMENTS)
      .doc();
    const r2 = rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.REIMBURSEMENTS)
      .doc();
    const u1 = rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc();
    const u2 = rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc();

    // startPoint (previous) to current location(current)
    batch
      .set(r1, Object.assign({}, employeeData, commonReimObject, {
        amount: (kmRate * distanceBetweenCurrentAndStartPoint).toFixed(0),
        distance: distanceBetweenCurrentAndStartPoint,
        previousIdentifier: startPointDetails.identifier,
        previousGeopoint: startPointDetails.geopoint,
        currentIdentifier: (() => {
          if (locals.addendumDocData.venueQuery) {
            return locals.addendumDocData.venueQuery.location;
          }

          return locals.addendumDocData.identifier;
        })(),
        currentGeopoint: {
          latitude: locals.addendumDocData.location.latitude
            || locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude
            || locals.addendumDocData.location._latitude,
        },
        intermediate: false,
      }), {
        merge: true,
      });

    // current location to start point
    batch
      .set(r2, Object.assign({}, commonReimObject, {
        rate: kmRate,
        previousIdentifier: (() => {
          if (locals.addendumDocData.venueQuery) {
            return locals.addendumDocData.venueQuery.location;
          }

          return locals.addendumDocData.identifier;
        })(),
        previousGeopoint: {
          latitude: locals.addendumDocData.location.latitude
            || locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude
            || locals.addendumDocData.location._latitude,
        },
        currentIdentifier: startPointDetails.identifier,
        currentGeopoint: startPointDetails.geopoint,
        intermediate: true,
        amount: (kmRate * distanceBetweenCurrentAndStartPoint).toFixed(0),
        distance: distanceBetweenCurrentAndStartPoint,
      }));

    // start point to current location
    batch
      .set(u1, Object.assign({}, commonReimObject, {
        amount: (kmRate * distanceBetweenCurrentAndStartPoint).toFixed(0),
        _type: addendumTypes.REIMBURSEMENT,
        id: `${date}${month}${year}${r1.id}`,
        key: momentNow.clone().startOf('day').valueOf(),
        // used for attachment.Claim Type.value for 'claim' activities
        reimbursementName: null,
        details: {
          rate: kmRate,
          startLocation: startPointDetails.geopoint,
          checkInTimestamp: locals.change.after.get('timestamp'),
          endLocation: {
            latitude: locals.addendumDocData.location.latitude
              || locals.addendumDocData.location._latitude,
            longitude: locals.addendumDocData.location.longitude
              || locals.addendumDocData.location._latitude,
          },
          distanceTravelled: distanceBetweenCurrentAndStartPoint,
          photoURL: null,
          status: null,
          claimId: null,
        },
      }));

    // curr to start point
    batch
      .set(u2, Object.assign({}, commonReimObject, {
        _type: addendumTypes.REIMBURSEMENT,
        amount: (kmRate * distanceBetweenCurrentAndStartPoint).toFixed(0),
        id: `${date}${month}${year}${r2.id}`,
        key: momentNow.clone().startOf('day').valueOf(),
        // used for attachment.Claim Type.value for 'claim' activities
        reimbursementName: null,
        intermediate: true,
        details: {
          rate: kmRate,
          startLocation: {
            latitude: locals.addendumDocData.location.latitude
              || locals.addendumDocData.location._latitude,
            longitude: locals.addendumDocData.location.longitude
              || locals.addendumDocData.location._latitude,
          },
          checkInTimestamp: locals.change.after.get('timestamp'),
          endLocation: startPointDetails.geopoint,
          distanceTravelled: distanceBetweenCurrentAndStartPoint,
          photoURL: null,
          status: null,
          claimId: null,
        },
      }));
  } else {
    if (locals.addendumDocData.distanceTravelled < 1) {
      return;
    }

    const [oldReimbursementDoc] = previousKmReimbursementQuery.docs;
    const [oldUpdatesDoc] = previousReimbursementUpdateQuery.docs;
    const r1 = rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.REIMBURSEMENTS)
      .doc();
    const u1 = rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc();

    // r2
    batch
      .set(oldReimbursementDoc.ref, Object.assign({}, employeeData, commonReimObject, {
        rate: kmRate,
        amount: amountThisTime.toFixed(0),
        intermediate: false,
        currentIdentifier: (() => {
          if (locals.addendumDocData.venueQuery) {
            return locals.addendumDocData.venueQuery.location;
          }

          return locals.addendumDocData.identifier;
        })(),
        currentGeopoint: {
          latitude: locals.addendumDocData.location.latitude
            || locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude
            || locals.addendumDocData.location._latitude,
        },
      }), {
        merge: true,
      });

    const oldUpdatesRef = (() => {
      if (oldUpdatesDoc) {
        return oldUpdatesDoc.ref;
      }

      return rootCollections
        .updates
        .doc(uid)
        .collection(subcollectionNames.ADDENDUM)
        .doc();
    })();

    batch
      .set(oldUpdatesRef, Object.assign({}, commonReimObject, {
        // cumulativeAmount,
        date,
        month,
        year,
        id: `${date}${month}${year}${oldReimbursementDoc.id}`,
        key: momentTz().date(date).month(month).year(year).startOf('date').valueOf(),
        amount: amountThisTime.toFixed(0),
        _type: addendumTypes.REIMBURSEMENT,
        reimbursementName: null,
        intermediate: false,
        details: {
          rate: kmRate,
          startLocation: oldReimbursementDoc.get('previousGeopoint'),
          distanceTravelled: locals.addendumDocData.distanceTravelled,
          photoURL: null,
          status: null,
          claimId: null,
          checkInTimestamp: locals.change.after.get('timestamp'),
          endLocation: {
            latitude: locals.addendumDocData.location.latitude
              || locals.addendumDocData.location._latitude,
            longitude: locals.addendumDocData.location.longitude
              || locals.addendumDocData.location._latitude,
          },
        },
      }), {
        merge: true,
      });

    // currentLocation (start) to startPoint (end)
    batch
      .set(r1, Object.assign({}, employeeData, commonReimObject, {
        // cumulativeAmount,
        rate: kmRate,
        amount: amountThisTime.toFixed(0),
        currentIdentifier: startPointDetails.identifier,
        currentGeopoint: startPointDetails.geopoint,
        previousIdentifier: (() => {
          if (locals.addendumDocData.venueQuery) {
            return locals.addendumDocData.venueQuery.location;
          }

          return locals.addendumDocData.identifier;
        })(),
        previousGeopoint: {
          latitude: locals.addendumDocData.location.latitude
            || locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude
            || locals.addendumDocData.location._latitude,
        },
        intermediate: true,
      }), {
        merge: true,
      });

    // currentLocation (start) to startPoint (end)
    batch
      .set(u1, Object.assign({}, commonReimObject, {
        _type: addendumTypes.REIMBURSEMENT,
        amount: amountThisTime.toFixed(0),
        id: `${date}${month}${year}${r1.id}`,
        key: momentNow.clone().startOf('day').valueOf(),
        // used for attachment.Claim Type.value for 'claim' activities
        reimbursementName: null,
        intermediate: true,
        details: {
          rate: kmRate,
          startLocation: {
            latitude: locals.addendumDocData.location.latitude
              || locals.addendumDocData.location._latitude,
            longitude: locals.addendumDocData.location.longitude
              || locals.addendumDocData.location._latitude,
          },
          checkInTimestamp: locals.change.after.get('timestamp'),
          endLocation: startPointDetails.geopoint,
          distanceTravelled: distanceBetweenCurrentAndStartPoint,
          photoURL: null,
          status: null,
          claimId: null,
        },
      }));
  }

  return batch.commit();
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


const getLateStatus = ({ firstCheckInTimestamp, dailyStartTime, timezone }) => {
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


const populateMissingAttendances = async (employeeDoc, dateRangeEnd, uid) => {
  if (!employeeDoc) {
    return;
  }

  const batch = db.batch();

  const {
    office,
    officeId,
    lastAttendanceTimestamp,
    attachment: {
      'Employee Contact': {
        value: phoneNumber,
      }
    }
  } = employeeDoc.data();


  const timezone = employeeDoc.get('timezone') || 'Asia/Kolkata';

  const momentToday = momentTz().tz(timezone);
  const momentPrevMonth = momentToday
    .clone()
    .subtract(1, 'months');
  const monthYearCombinations = new Set();
  const attendanceDocPromises = [];
  const empCt = momentTz(
    employeeDoc.createTime.toMillis()
  );

  batch
    .set(employeeDoc.ref, {
      lastAttendanceTimestamp: dateRangeEnd.valueOf(),
    }, {
      merge: true,
    });

  const dateRangeStart = (() => {
    /**
     * Employee created in the previous month
     * The Loop will run from creation date to today
     */
    if (empCt.month() === momentPrevMonth.month()
      && empCt.year() && momentPrevMonth.year()) {
      return empCt;
    }

    /**
     * Employee created more than 1 month ago.
     * Loop will run from start of previous month
     * to today.
     */
    if (momentToday.diff(empCt, 'months') > 1) {
      return momentToday
        .clone()
        .subtract(1, 'month')
        .startOf('month');
    }

    if (lastAttendanceTimestamp) {
      return momentTz(lastAttendanceTimestamp)
        .tz(timezone);
    }

    return null;
  })();

  if (!dateRangeStart) {
    return;
  }

  const momentStart = momentTz(dateRangeStart)
    .tz(timezone)
    .startOf('day');
  const momentEnd = momentTz(dateRangeEnd)
    .tz(timezone)
    .endOf('day');
  const tempMoment = momentStart
    .clone();
  const allDates = {};

  while (tempMoment.isSameOrBefore(momentEnd)) {
    const month = tempMoment.month();
    const year = tempMoment.year();
    const date = tempMoment.date();

    allDates[
      `${month}-${year}`
    ] = allDates[`${month}-${year}`] || [];

    allDates[
      `${month}-${year}`
    ].push(date);

    monthYearCombinations
      .add(`${month}-${year}`);
    tempMoment
      .add(1, 'days');
  }

  monthYearCombinations
    .forEach(monthYear => {
      const [
        monthString,
        yearString,
      ] = monthYear.split('-');
      const month = Number(monthString);
      const year = Number(yearString);
      const promise = rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ATTENDANCES)
        .where('month', '==', month)
        .where('year', '==', year)
        .where('phoneNumber', '==', phoneNumber)
        .limit(1)
        .get();

      attendanceDocPromises
        .push(promise);
    });

  const snaps = await Promise
    .all(attendanceDocPromises);

  snaps
    .forEach(snap => {
      const doc = snap.docs[0];
      const filters = snap.query._queryOptions.fieldFilters;
      const month = filters[0].value;
      const year = filters[1].value;
      const ref = doc ? doc.ref : rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ATTENDANCES)
        .doc();
      const data = Object.assign(doc ? doc.data() : {}, {
        month,
        year,
        office,
        officeId,
        phoneNumber,
      });

      const dates = allDates[
        `${month}-${year}`
      ];

      dates
        .forEach(date => {
          data
            .attendance = data.attendance || {};

          if (data.attendance.hasOwnProperty(date)) {
            return;
          }

          data
            .attendance[date] = data.attendance[date]
            || getDefaultAttendanceObject();

          batch
            .set(rootCollections
              .updates
              .doc(uid)
              .collection(subcollectionNames.ADDENDUM)
              .doc(), Object.assign({}, data.attendance[date], {
                date,
                month,
                year,
                office,
                officeId,
                timestamp: Date.now(),
                key: momentTz()
                  .tz(timezone)
                  .date(date)
                  .month(month)
                  .year(year)
                  .startOf('day')
                  .valueOf(),
                id: `${date}${month}${year}${officeId}`,
                _type: addendumTypes.ATTENDANCE,
              }), {
              merge: true,
            });
        });

      const employeeData = {
        phoneNumber,
        id: employeeDoc.id,
        activationDate: empCt.valueOf(),
        employeeName: employeeDoc.get('attachment.Name.value'),
        employeeCode: employeeDoc.get('attachment.Employee Code.value'),
        baseLocation: employeeDoc.get('attachment.Base Location.value'),
        region: employeeDoc.get('attachment.Region.value'),
        department: employeeDoc.get('attachment.Department.value'),
        minimumDailyActivityCount: employeeDoc.get('attachment.Minimum Daily Activity Count.value'),
        minimumWorkingHours: employeeDoc.get('attachment.Minimum Working Hours.value'),
      };

      batch
        .set(ref, Object.assign({}, employeeData, data), {
          merge: true,
        });
    });

  return batch
    .commit();
};


const handleWorkday = async locals => {
  /**
   * Template === check-in and action === 'create'
   */
  if (!locals.addendumDocData) {
    return;
  }

  if (locals.addendumDocData.action
    !== httpsActions.create) {
    return;
  }

  const {
    officeId,
    timezone,
    creator: {
      phoneNumber,
    },
    office,
  } = locals.change.after.data();
  const momentNow = momentTz(locals.addendumDocData.timestamp)
    .tz(timezone);
  const todaysDate = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();
  const employeeData = await getEmployeeReportData(
    officeId,
    phoneNumber
  );

  // If employee Location Validation Check => true
  // AND distanceAccurate => false
  // skip
  // Using explicit check for this case because
  // values can be empty strings.
  if (employeeData.locationValidationCheck === true
    && locals.addendumDocData.distanceAccurate === false) {
    return;
  }

  const { location } = locals.addendumDocData;
  const batch = db.batch();

  let uid = locals.addendumDocData.uid;

  if (!uid) {
    uid = (await getAuth(phoneNumber)).uid;
  }

  /**
   * This query might return 0 docs if the date = 1 in the month
   * or the user hasn't done anything since the start of the month
   */
  const [attendanceDoc] = (
    await rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ATTENDANCES)
      .where('phoneNumber', '==', phoneNumber)
      .where('month', '==', month)
      .where('year', '==', year)
      .limit(1)
      .get()
  )
    .docs;

  const attendanceDocRef = attendanceDoc ? attendanceDoc.ref : rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc();

  const attendanceObject = attendanceDoc ? attendanceDoc.data() : {};

  attendanceObject
    .attendance = attendanceObject.attendance || {};
  attendanceObject
    .attendance[todaysDate] = attendanceObject.attendance[todaysDate]
    || getDefaultAttendanceObject();
  attendanceObject
    .attendance[todaysDate]
    .working = attendanceObject
      .attendance[todaysDate]
      .working || {};

  /**
   * If the first check-in has already been set for this user
   * we don't need to update it again for the day
   */
  attendanceObject
    .attendance[todaysDate]
    .working
    .firstCheckInTimestamp = attendanceObject
      .attendance[todaysDate]
      .working
      .firstCheckInTimestamp
    || locals.addendumDocData.timestamp;

  attendanceObject
    .attendance[todaysDate]
    .working
    .lastCheckInTimestamp = locals.addendumDocData.timestamp;

  attendanceObject
    .attendance[todaysDate]
    .isLate = getLateStatus({
      timezone,
      firstCheckInTimestamp: attendanceObject
        .attendance[todaysDate]
        .working
        .firstCheckInTimestamp,
      dailyStartTime: employeeData.dailyStartTime,
    });

  attendanceObject
    .attendance[todaysDate].addendum = attendanceObject
      .attendance[todaysDate].addendum || [];

  attendanceObject
    .attendance[todaysDate]
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
   * might get messed up. Sorting regardless helps us migitate
   * this case.
   */
  attendanceObject
    .attendance[todaysDate]
    .addendum
    .sort((a, b) => a.timestamp - b.timestamp);

  const numberOfCheckIns = attendanceObject.attendance[todaysDate].addendum.length;
  const firstAddendum = attendanceObject.attendance[todaysDate].addendum[0];
  const lastAddendum = attendanceObject.attendance[todaysDate].addendum[numberOfCheckIns - 1];
  const hoursWorked = momentTz(lastAddendum.timestamp)
    .diff(
      momentTz(firstAddendum.timestamp),
      'hours',
      true
    );

  attendanceObject
    .attendance[todaysDate]
    .attendance = getStatusForDay({
      // difference between first and last action in hours
      hoursWorked,
      // number of actions done in the day by the user
      numberOfCheckIns,
      minimumDailyActivityCount: employeeData.minimumDailyActivityCount,
      minimumWorkingHours: employeeData.minimumWorkingHours,
    });

  if (attendanceObject.attendance[todaysDate].onAr
    || attendanceObject.attendance[todaysDate].onLeave
    || attendanceObject.attendance[todaysDate].holiday
    || attendanceObject.attendance[todaysDate].weeklyOff) {
    attendanceObject
      .attendance[todaysDate]
      .attendance = 1;
  }

  attendanceObject
    .attendance[todaysDate]
    .working
    .numberOfCheckIns = attendanceObject.attendance[todaysDate].addendum.length;


  // Will iterate over 1 to (todays date - 1)
  // Eg. if today is 18 => range {1, 17}
  const tempDates = getNumbersbetween(1, todaysDate);

  tempDates.forEach(date => {
    // TODO: Dates in this loop should only be the ones where the user
    // was an employee
    attendanceObject.attendance[
      date
    ] = attendanceObject.attendance[date] || getDefaultAttendanceObject();

    const checkInsArray = attendanceObject.attendance[date].addendum || [];
    const { length: numberOfCheckIns } = checkInsArray || [];

    const hoursWorked = (() => {
      if (checkInsArray.length === 0) {
        return 0;
      }

      const [firstCheckInAddendum] = checkInsArray;
      const lastCheckInAddendum = checkInsArray[checkInsArray.length - 1];
      const { timestamp: firstCheckInTimestamp } = firstCheckInAddendum;
      const { timestamp: lastCheckInTimestamp } = lastCheckInAddendum;
      const firstMoment = momentTz(firstCheckInTimestamp).tz(timezone);
      const lastMoment = momentTz(lastCheckInTimestamp).tz(timezone);

      return lastMoment.diff(firstMoment, 'hours', true);
    })();

    const newCalculatedAttendance = (() => {
      const { onAr, onLeave, holiday, weeklyOff } = attendanceObject.attendance[date];

      if (onAr || onLeave || holiday || weeklyOff) {
        return 1;
      }

      return getStatusForDay({
        hoursWorked,
        minimumDailyActivityCount: employeeData.minimumDailyActivityCount,
        minimumWorkingHours: employeeData.minimumWorkingHours,
        numberOfCheckIns,
      });
    })();

    attendanceObject.attendance[date].attendance = newCalculatedAttendance;

    const updateRef = rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc();

    batch.set(updateRef, Object.assign({}, attendanceObject.attendance[date], {
      date,
      month,
      year,
      office,
      officeId,
      phoneNumber,
      timestamp: Date.now(),
      _type: addendumTypes.ATTENDANCE,
      id: `${date}${month}${year}${officeId}`,
      key: momentTz()
        .date(date)
        .month(month)
        .year(year)
        .startOf('date')
        .valueOf(),
    }));
  });

  batch
    .set(
      attendanceDocRef, Object
        .assign({}, employeeData, attendanceObject, {
          year,
          month,
          office,
          officeId,
          phoneNumber,
          timestamp: Date.now(),
        }), {
      merge: true,
    });

  batch
    .set(rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), Object
        .assign({}, attendanceObject.attendance[todaysDate], {
          date: todaysDate,
          month,
          year,
          office,
          officeId,
          phoneNumber,
          timestamp: Date.now(),
          _type: addendumTypes.ATTENDANCE,
          id: `${todaysDate}${month}${year}${officeId}`,
          key: momentNow.clone().startOf('date').valueOf(),
        }), {
      merge: true,
    });

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

  await batch
    .commit();

  /** Only populate the missing attendances when the attendance doc was created */
  if (!attendanceDoc) {
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

    await populateWeeklyOffInAttendance({
      uid,
      employeeDoc,
      month: momentNow.month(),
      year: momentNow.year(),
    });
  }

  if (!attendanceDoc
    || !employeeData) {
    return;
  }

  // backfill
  return populateMissingAttendances(
    employeeDoc,
    momentNow.clone(),
    uid
  );
};

const getSubcollectionActivityObject = ({ activityObject, customerObject }) => {
  const { status, template } = activityObject.data();

  const creationTimestamp = activityObject.createTime.toDate().getTime();
  const momentOfCreation = momentTz(creationTimestamp).tz(activityObject.get('timezone') || 'Asia/Kolkata');

  const intermediate = Object.assign({}, activityObject.data(), {
    creationTimestamp,
    timestamp: Date.now(),
    addendumDocRef: null,
    isCancelled: status === 'CANCELLED',
    creationDate: momentOfCreation.date(),
    creationMonth: momentOfCreation.month(),
    creationYear: momentOfCreation.year(),
  });

  if (template === 'office') {
    intermediate.slug = slugify(activityObject.get('attachment.Name.value'));
  }

  if (customerObject) {
    intermediate.customerObject = customerObject;
  }

  return intermediate;
};

const getProfileActivityObject = ({ activityDoc, assigneesMap, assigneePhoneNumbersArray, customerObject }) => {
  const { id: activityId } = activityDoc;

  const assigneeCallback = phoneNumber => {
    const { displayName, photoURL } = assigneesMap.get(phoneNumber) || {};

    return {
      phoneNumber,
      displayName: displayName || '',
      photoURL: photoURL || '',
    };
  };

  const intermediate = Object.assign({}, activityDoc.data(), {
    activityId,
    addendumDocRef: null,
    timestamp: Date.now(),
    assignees: assigneePhoneNumbersArray.map(assigneeCallback),
  });

  if (customerObject) {
    intermediate.customerObject = customerObject;
  }

  return intermediate;
};

const templateHandler = async locals => {
  const { template } = locals.change.after.data();

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

  if (template === 'admin') {
    await require('./template-handlers/admin')(locals);
  }

  if (template === 'attendance regularization') {
    await require('./template-handlers/ar')(locals);
  }

  if (template === 'branch'
    || template === 'customer') {
    await setLocationsReadEvent(locals);
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

  // branch, region, department
  if (template === 'branch'
    || template === 'region'
    || template === 'department') {
    await handleActivityUpdates(locals);
  }

  return;
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
  const newPhoneNumbersSet = new Set();
  const authFetchPromises = [];
  const {
    template,
    addendumDocRef,
  } = change.after.data();
  const locals = {
    change,
    /** Used while creating comment */
    activityNew: change.after,
    addendumDoc: null,
    assigneesMap: new Map(),
    assigneePhoneNumbersArray: [],
    addendumCreator: {},
    addendumCreatorInAssignees: false,
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
      const { id: phoneNumber } = doc;
      const { addToInclude } = doc.data();

      if (addendumDoc && phoneNumber === addendumDoc.get('user')) {
        locals.addendumCreatorInAssignees = true;
      }

      authFetchPromises
        .push(getAuth(phoneNumber));

      /** Storing phoneNumber in the object because we are storing assigneesMap in addendum doc */
      locals.assigneesMap.set(phoneNumber, { phoneNumber, addToInclude: addToInclude || false });

      locals
        .assigneePhoneNumbersArray
        .push(phoneNumber);
    });

  if (addendumDoc
    && !locals.addendumCreatorInAssignees) {
    authFetchPromises.push(getAuth(addendumDoc.get('user')));
  }

  const customerObject = await getCustomerObject({
    name: change.after.get('attachment.Location.value'),
    officeId: change.after.get('officeId'),
    template: template === 'duty' ? 'customer' : 'branch',
  });

  locals.customerObject = customerObject;

  const userRecords = await Promise
    .all(authFetchPromises);

  userRecords.forEach(userRecord => {
    const { phoneNumber, uid } = userRecord;

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

    const oldMap = locals.assigneesMap.get(phoneNumber);

    locals.assigneesMap.set(phoneNumber, Object.assign({}, oldMap, {
      uid: uid || '',
      displayName: userRecord.displayName || '',
      photoURL: userRecord.photoURL || '',
      customClaims: userRecord.customClaims || {},
    }));

    /** New user introduced to the system. Saving their phone number. */
    if (!uid) {
      newPhoneNumbersSet.add(phoneNumber);
    }
  });

  const profileActivityObject = getProfileActivityObject({
    customerObject,
    activityDoc: change.after,
    assigneePhoneNumbersArray: locals.assigneePhoneNumbersArray,
    assigneesMap: locals.assigneesMap,
  });

  userRecords.forEach(userRecord => {
    const { uid, phoneNumber } = userRecord;

    /**
     * Check-ins clutter the `Activities` collection and
     * make the `/read` resource slow. If the user doesn't have
     * auth, there's no point in putting a check-in their
     * profile
     */
    if (template === 'check-in' && !uid) {
      return;
    }

    if (uid) {
      // in updates only if auth exists
      batch
        .set(rootCollections
          .updates
          .doc(uid)
          .collection(subcollectionNames.ADDENDUM)
          .doc(), Object.assign({}, profileActivityObject, {
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

  const copyToRef = getCopyPath({
    template,
    activityId,
    officeId: change.after.get('officeId'),
  });

  batch.set(copyToRef,
    getSubcollectionActivityObject({ activityObject: change.after, customerObject }),
    { merge: true }
  );

  await batch.commit();

  /**
   * The sequence of handleAddendum and handleProfile matters for
   * correct execution flow. All other functions can be called in
   * any order.
   */
  await handleAddendum(locals);
  await templateHandler(locals);
  await handleReimbursement(locals);

  return createNewProfiles({
    newPhoneNumbersSet,
    smsContext: {
      activityName: change.after.get('activityName'),
      office: change.after.get('office'),
      creator: change.after.get('creator.phoneNumber') || change.after.get('creator'),
    }
  });
};


module.exports = (change, context) => {
  try {
    return ActivityOnWrite(change, context);
  } catch (error) {
    console.error({
      error,
      context,
      activityId: change.after.id,
    });
  }
};
