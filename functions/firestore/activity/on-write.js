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
  getLatLngString,
  adjustedGeopoint,
  isNonEmptyString,
  getNumbersbetween,
  getEmployeeReportData,
  getDefaultAttendanceObject,
  populateWeeklyOffInAttendance,
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

const getAttendanceHoursWorked = ({
  attendanceData,
  date
}) => {
  const checkInsArray = attendanceData.attendance[date].addendum || [];
  const {
    length: numberOfCheckIns
  } = checkInsArray;

  if (checkInsArray.length === 0) {
    return 0;
  }

  const [first] = attendanceData.attendance[date].addendum;
  const last = attendanceData.attendance[date].addendum[numberOfCheckIns - 1];

  return momentTz(momentTz(last)).diff(momentTz(first), 'hours', true);
};


const getLocationUrl = plusCode => `https://plus.codes/${plusCode}`;

const getLocalityCityState = mapsApiResult => {
  let locality = '';
  let city = '';
  let state = '';

  if (mapsApiResult.json.results.length === 0) {
    return {
      locality,
      city,
      state
    };
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

  return {
    locality,
    city,
    state
  };
};


const getPlaceInformation = (mapsApiResult, geopoint) => {
  const value = toMapsUrl(geopoint);

  if (!mapsApiResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const [firstResult] = mapsApiResult.json.results;

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
  if (typeof fromOldState === 'boolean' && fromOldState) {
    return change.before.get(field);
  }

  return change.after.get(field);
};


const getUpdatedVenueDescriptors = (newVenue, oldVenue) => {
  const updatedFields = [];

  oldVenue.forEach((venue, index) => {
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

    if (oldLocation === newLocation &&
      oldAddress === newAddress &&
      oldLatitude === newLatitude &&
      oldLongitude === newLongitude) {
      return;
    }

    updatedFields.push(venueDescriptor);
  });

  return updatedFields;
};

const getCustomerObject = async ({
  name,
  officeId,
  template
}) => {
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

  const {
    attachment
  } = customerDoc.data();
  const [venue] = customerDoc.get('venue');
  const {
    location,
    address,
    geopoint
  } = venue;

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
  if (!adminContact ||
    !locals.addendumDoc) {
    return;
  }

  const {
    officeId
  } = locals.change.after.data();

  const batch = db.batch();
  const activityRef = rootCollections.activities.doc();
  const addendumDocRef = rootCollections
    .offices
    .doc(officeId).collection(subcollectionNames.ADDENDUM).doc();

  const [adminTemplateQuery, adminQuery] = await Promise
    .all([
      rootCollections
      .activityTemplates
      .where('name', '==', 'admin')
      .limit(1)
      .get(),
      rootCollections
      .activities
      .where('attachment.Phone Number.value', '==', adminContact)
      .where('office', '==', officeId)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get(),
    ]);

  /** Is already an admin */
  if (!adminQuery.empty) {
    return;
  }

  const [adminTemplateDoc] = adminTemplateQuery.docs;
  const activityData = {
    officeId,
    addendumDocRef,
    office: locals.change.after.get('office'),
    timezone: locals.change.after.get('timezone'),
    timestamp: locals.addendumDocData.timestamp,
    schedule: [],
    venue: [],
    attachment: {
      // Admin field is redundant
      'Admin': {
        value: adminContact,
        type: 'phoneNumber',
      },
      'Phone Number': {
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
    activityData,
    timestamp: Date.now(),
    user: locals.change.after.get('creator.phoneNumber'),
    userDisplayName: locals.change.after.get('creator.displayName'),
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

  locals.assigneePhoneNumbersArray.forEach(phoneNumber => {
    const ref = activityRef
      .collection(subcollectionNames.ASSIGNEES)
      .doc(phoneNumber);

    batch.set(ref, {
      addToInclude: false
    });
  });

  return batch.commit();
};


const handleXTypeActivities = async locals => {
  const template = locals.change.after.get('attachment.Template.value');
  const subscriber = locals.change.after.get('attachment.Phone Number.value');
  const {
    officeId
  } = locals.change.after.data();
  const typeActivities = await rootCollections
    .activities
    .where('officeId', '==', officeId)
    .where('status', '==', 'CONFIRMED')
    .where('template', '==', `${template}-type`)
    .get();

  // if subscription is created/updated
  // fetch all x-type activities from
  // Offices/(officeId)/Activities
  // Put those activities in the subscriber path
  // Profiles/(subscriber)/Activities/{x-type activityId}/
  const batch = db.batch();

  typeActivities.forEach(activity => {
    batch.set(
      rootCollections
      .profiles
      .doc(subscriber)
      .collection(subcollectionNames.ACTIVITIES)
      .doc(activity.id),
      Object.assign({}, activity.data(), {
        addendumDocRef: null
      }), {
        merge: true
      }
    );
  });

  return batch.commit();
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
  } = attachment['Phone Number'];

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
      .where('attachment.Phone Number.value', '==', subscriberPhoneNumber)
      .where('officeId', '==', officeId)
      .limit(1)
      .get();

    if (adminActivityQueryResult.empty) {
      return;
    }

    return adminActivityQueryResult.docs[0].ref.set({
      status: 'CANCELLED',
      addendumDocRef: null,
    }, {
      merge: true
    });
  }

  return createAdmin(locals, subscriberPhoneNumber);
};


const handleSubscription = async locals => {
  const batch = db.batch();
  const {
    id: activityId
  } = locals.change.after;
  const templateName = locals.change.after.get('attachment.Template.value');
  const newSubscriber = locals.change.after.get('attachment.Phone Number.value');
  const oldSubscriber = locals.change.before.get('attachment.Phone Number.value');
  const subscriptionDocRef = rootCollections
    .profiles
    .doc(newSubscriber)
    .collection(subcollectionNames.SUBSCRIPTIONS)
    .doc(activityId);

  const [templateDocsQueryResult, profileSubscriptionDoc] = await Promise.all([
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

    return profileSubscriptionDoc.get('include') || [];
  })();

  locals.assigneePhoneNumbersArray.forEach(phoneNumber => {
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

    include.push(phoneNumber);
  });

  const subscriptionDocData = {
    timestamp: Date.now(),
    include: Array.from(new Set(include)),
    template: templateDoc.get('name'),
    office: locals.change.after.get('office'),
    status: locals.change.after.get('status'),

    report: templateDoc.get('report') || null,
    schedule: templateDoc.get('schedule'),
    venue: templateDoc.get('venue'),
    attachment: templateDoc.get('attachment'),
    canEditRule: templateDoc.get('canEditRule'),
    hidden: templateDoc.get('hidden'),
    statusOnCreate: templateDoc.get('statusOnCreate'),
  };

  batch.set(subscriptionDocRef, subscriptionDocData, {
    merge: true
  });

  const newSubscriberAuth = await getAuth(newSubscriber);

  if (newSubscriberAuth.uid) {
    batch.set(
      rootCollections
      .updates
      .doc(newSubscriberAuth.uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), Object.assign({}, subscriptionDocData, {
        _type: addendumTypes.SUBSCRIPTION,
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
    .data() &&
    oldSubscriber !== newSubscriber;

  /** Subscriber changed, so, deleting old doc in old `Updates` */
  if (newSubscriberAuth.uid && subscriberChanged) {
    batch.delete(
      rootCollections
      .updates
      .doc(newSubscriberAuth.uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(locals.change.after.id)
    );
  }

  if (subscriberChanged) {
    batch.delete(rootCollections
      .profiles
      .doc(oldSubscriber)
      .collection(subcollectionNames.SUBSCRIPTIONS)
      .doc(locals.change.after.id)
    );
  }

  await Promise
    .all([
      batch.commit(),
      handleCanEditRule(locals, templateDoc)
    ]);

  return handleXTypeActivities(locals);
};


const removeFromOfficeActivities = async locals => {
  // const activityDoc = locals.change.after;
  const {
    status,
    office
  } = locals.change.after.data();

  /** Only remove when the status is `CANCELLED` */
  if (status !== 'CANCELLED') {
    return;
  }

  let oldStatus;

  if (locals.change.before.data()) {
    oldStatus = locals.change.before.get('status');
  }

  if (oldStatus &&
    oldStatus === 'CANCELLED' &&
    status === 'CANCELLED') {
    return;
  }

  const {
    value: activityPhoneNumber
  } = locals.change.after.get('attachment.Phone Number');

  const runQuery = (query, resolve, reject) => {
    return query
      .get()
      .then(docs => {
        if (docs.empty) {
          return 0;
        }

        const batch = db.batch();

        docs
          .forEach(doc => {
            const {
              template,
              status: activityStatus
            } = doc.data();

            /**
             * Not touching the same activity which causes this flow
             * to run. Allowing that will send the activityOnWrite
             * to an infinite spiral.
             */
            if (doc.id === locals.change.after.id) {
              return;
            }

            // No point of recancelling the already cancelled activities.
            if (activityStatus === 'CANCELLED') {
              return;
            }

            const {
              value: phoneNumberInAttachment
            } = doc.get('attachment.Phone Number');

            // Cancelling admin to remove their custom claims.
            // Cancelling subscription to stop them from
            // creating new activities with that subscription
            if (new Set(['admin', 'subscription']).has(template) &&
              activityPhoneNumber === phoneNumberInAttachment) {
              batch.set(
                rootCollections.activities.doc(doc.id), {
                  status: 'CANCELLED',
                  addendumDocRef: null
                }, {
                  merge: true
                }
              );

              return;
            }


            // TODO: Check if this is required since AssigneOnDelete
            // does this stuff automatically.
            batch
              .set(
                rootCollections.activities.doc(doc.id), {
                  addendumDocRef: null,
                  timestamp: Date.now(),
                }, {
                  merge: true
                }
              );

            batch.delete(
              rootCollections
              .activities
              .doc(doc.id)
              .collection(subcollectionNames.ASSIGNEES)
              .doc(activityPhoneNumber)
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
    .doc(activityPhoneNumber)
    .collection(subcollectionNames.ACTIVITIES)
    .where('office', '==', office)
    .orderBy('__name__')
    .limit(250);

  return new Promise((resolve, reject) => {
      return runQuery(query, resolve, reject);
    })
    .catch(console.error);
};


const getPhoneNumbersFromAttachment = ({
  attachment = {}
}) => {
  return Object.keys(attachment).map(field => {
    const {
      type,
      value
    } = attachment[field];

    return type === 'phoneNumber' ? value : null;
  }).filter(Boolean);
};


const handleAttachmentPhoneNumberChange = async locals => {
  const {
    status
  } = locals.change.after.data();

  if (status === 'CANCELLED') {
    return;
  }

  const {
    before: activityOld,
    after: activityNew
  } = locals.change;

  /**
   * Activity was just created
   */
  if (!activityOld.data()) {
    return;
  }

  const activityPhoneNumber = locals.change.after.get('attachment.Phone Number.value');

  if (!activityPhoneNumber) {
    return;
  }

  // Unassign all old phone numbers
  const oldPhoneNumbers = getPhoneNumbersFromAttachment({
    attachment: activityOld.get('attachment')
  });

  // assign all new phone numbers
  const newPhoneNumbers = getPhoneNumbersFromAttachment({
    attachment: activityNew.get('attachment'),
  });

  // Nothing changed in the array
  // Doing this to prevent unnecessary invocations of cloud functions
  // whenever any activityOnWrite instance with type `phoneNumber` in attachment
  // get triggered.
  // This might not be the most efficient way to do it, but I'm short on time.
  // probably use `JSON.stringify`.
  if (oldPhoneNumbers.sort().toString() === newPhoneNumbers.sort().toString()) {
    return;
  }

  const batch = db.batch();
  const subscriptions = await rootCollections
    .activities
    .where('template', '==', 'subscription')
    .where('attachment.Phone Number.value', '==', activityPhoneNumber)
    .where('office', '==', locals.change.after.get('office'))
    .get();

  subscriptions.forEach(doc => {
    batch
      .set(doc.ref, {
        addendumDocRef: null,
        timestamp: Date.now(),
      }, {
        merge: true,
      });

    oldPhoneNumbers.forEach(phoneNumber => {
      batch.delete(
        doc.ref.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber)
      );
    });

    newPhoneNumbers.forEach(phoneNumber => {
      // Any or all of these values could be empty strings...
      batch.set(doc
        .ref
        .collection(subcollectionNames.ASSIGNEES)
        .doc(phoneNumber), {
          addToInclude: true,
        });
    });
  });

  return batch.commit();
};


const createDefaultSubscriptionsForUser = locals => {
  const {
    value: activityPhoneNumber
  } = locals.change.after.get('attachment.Phone Number');
  const {
    status
  } = locals.change.after.data();

  /**
   * Activity is cancelled, so creating subscription
   * is useless.
   */
  if (status === 'CANCELLED') {
    return;
  }

  console.log('in createDefaultSubscriptionsForUser');

  return Promise
    .all([
      createAutoSubscription(locals, 'check-in', activityPhoneNumber),
      createAutoSubscription(locals, 'leave', activityPhoneNumber),
      createAutoSubscription(locals, 'attendance regularization', activityPhoneNumber),
    ]);
};


const updatePhoneNumberFields = (doc, oldPhoneNumber, newPhoneNumber, newPhoneNumberAuth) => {
  const result = Object.assign({}, doc.data(), {
    timestamp: Date.now(),
    addendumDocRef: null,
  });

  const {
    attachment,
    creator
  } = doc.data();

  delete result.assignees;

  if (creator === oldPhoneNumber || creator.phoneNumber === oldPhoneNumber) {
    result.creator = {
      phoneNumber: newPhoneNumber,
      photoURL: newPhoneNumberAuth.photoURL || '',
      displayName: newPhoneNumberAuth.displayName || '',
    };
  }

  Object.keys(attachment).forEach(field => {
    if (attachment[field].value === oldPhoneNumber) {
      result.attachment[field].value = newPhoneNumber;
    }
  });

  return result;
};


const replaceNumberInActivities = async locals => {
  const {
    value: oldPhoneNumber
  } = locals.change.before.get('attachment.Phone Number');
  const {
    value: newPhoneNumber
  } = locals.change.after.get('attachment.Phone Number');
  const {
    after: activityDoc
  } = locals.change;

  console.log('in replaceNumberInActivities');

  const runQuery = async (query, newPhoneNumberAuth, resolve, reject) => {
    return query.get().then(docs => {
        console.log('replaceNumberInActivities docs =>', docs.size);

        if (docs.empty) {
          return [0];
        }

        const batch = db.batch();

        docs.forEach(doc => {
          const {
            template
          } = doc.data();

          /**
           * Not touching the same activity which causes this flow
           * to run. Allowing that will send the activityOnWrite
           * to an infinite spiral.
           */
          if (doc.id === activityDoc.id) {
            return;
          }

          const activityRef = rootCollections.activities.doc(doc.id);

          console.log('change phone number', activityRef.id);

          // add new assignee
          batch.set(
            activityRef
            .collection(subcollectionNames.ASSIGNEES)
            .doc(newPhoneNumber), {
              addToInclude: template !== 'subscription',
            }, {
              merge: true,
            }
          );

          // Remove old assignee
          batch.delete(
            activityRef.collection(subcollectionNames.ASSIGNEES).doc(oldPhoneNumber)
          );

          const activityData = updatePhoneNumberFields(
            doc,
            oldPhoneNumber,
            newPhoneNumber,
            newPhoneNumberAuth
          );

          // Update the main activity in root `Activities` collection
          batch.set(activityRef, activityData, {
            merge: true
          });
        });

        return Promise.all([docs.docs[docs.size - 1], batch.commit()]);
      })
      .then(result => {
        const [lastDoc] = result;

        if (!lastDoc) {
          return resolve();
        }

        return process
          .nextTick(() => {
            return runQuery(query.startAfter(lastDoc.id), resolve, reject);
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
    .orderBy('__name__')
    .limit(100);

  return new Promise((resolve, reject) => {
    return runQuery(query, newPhoneNumberAuth, resolve, reject);
  });
};

const handleAttendanceDocsForPayroll = async locals => {
  const {
    officeId
  } = locals.change.after.data();
  const batch = db.batch();
  const {
    after: activityDoc
  } = locals.change;
  const {
    value: phoneNumber
  } = activityDoc.get('attachment.Phone Number');

  const momentNow = momentTz();
  const month = momentNow.month();
  const year = momentNow.year();

  const [attendanceDoc] = (
    await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('phoneNumber', '==', phoneNumber)
    .limit(1)
    .get()
  ).docs;
  const ref = attendanceDoc ? attendanceDoc.ref : rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc();
  const attendanceUpdate = attendanceDoc ? attendanceDoc.data() : {};

  attendanceUpdate
    .attendance = attendanceUpdate.attendance || {};

  batch.set(ref, Object.assign({}, attendanceUpdate, {
    month,
    year,
    phoneNumber,
    employeeName: activityDoc.get('attachment.Name.value'),
    employeeCode: activityDoc.get('attachment.Employee Code.value'),
    baseLocation: activityDoc.get('attachment.Base Location.value'),
    region: activityDoc.get('attachment.Region.value'),
    department: activityDoc.get('attachment.Department.value'),
  }), {
    merge: true,
  });

  return batch.commit();
};


const handleConfig = async locals => {
  const {
    office,
    officeId,
    template,
  } = locals.change.after.data();
  const {
    value: oldActivityPhoneNumber,
  } = locals.change.before.get('attachment.Phone Number') || {};
  const {
    value: newActivityPhoneNumber,
  } = locals.change.after.get('attachment.Phone Number') || {};
  const phoneNumberChanged = oldActivityPhoneNumber && oldActivityPhoneNumber !== newActivityPhoneNumber;

  /**
   * check-in, recipient, and office don't have attachment.Phone Number
   * .value field
   */
  if (new Set(['admin', 'subscription']).has(template)) {
    return;
  }

  if (!newActivityPhoneNumber) {
    return;
  }

  console.log('handleConfig');
  console.log('phoneNumberChanged =>', phoneNumberChanged);
  console.log({
    oldActivityPhoneNumber,
    newActivityPhoneNumber
  });

  const batch = db.batch();
  const hasBeenCancelled = locals
    .change
    .before.data() &&
    locals
    .change
    .before
    .get('status') !== 'CANCELLED' &&
    locals
    .change
    .after
    .get('status') === 'CANCELLED';

  const employeeOf = {
    [office]: officeId,
  };

  const hasBeenCreated = locals.addendumDoc &&
    locals.addendumDoc.get('action') === httpsActions.create;

  console.log('hasBeenCreated', hasBeenCreated);

  // Change of status from `CONFIRMED` to `CANCELLED`
  if (hasBeenCancelled) {
    employeeOf[office] = admin.firestore.FieldValue.delete();
  }

  let profileData = {};

  if (hasBeenCreated) {
    profileData.lastLocationMapUpdateTimestamp = Date.now();
    profileData.employeeOf = employeeOf;
  }

  // Phone number changed
  if (phoneNumberChanged) {
    batch
      .set(rootCollections
        .profiles
        .doc(oldActivityPhoneNumber), {
          employeeOf: {
            [office]: admin.firestore.FieldValue.delete(),
          },
        }, {
          merge: true,
        });

    const profileDoc = await rootCollections
      .profiles
      .doc(oldActivityPhoneNumber)
      .get();

    profileData = Object.assign(profileDoc.data(), profileData);

    if (profileDoc.get('uid')) {
      batch
        .set(rootCollections.updates.doc(profileDoc.get('uid')), {
          removeFromOffice: admin.firestore.FieldValue.arrayUnion(office),
        }, {
          merge: true,
        });
    }

    const userRecord = await getAuth(oldActivityPhoneNumber);

    if (userRecord.uid) {
      await auth
        .updateUser(userRecord.uid, {
          phoneNumber: newActivityPhoneNumber,
        });

      batch.set(
        rootCollections
        .updates
        .doc(userRecord.uid), {
          phoneNumber: newActivityPhoneNumber,
        }, {
          merge: true,
        });
    }

    await replaceNumberInActivities(locals);
  }

  batch
    .set(rootCollections
      .profiles
      .doc(newActivityPhoneNumber), profileData, {
        merge: true,
      });

  await batch.commit();

  console.log('hasBeenCancelled', hasBeenCancelled);

  if (hasBeenCancelled) {
    await removeFromOfficeActivities(locals);
  }

  await createDefaultSubscriptionsForUser(
    locals,
    hasBeenCancelled
  );

  await handleAttendanceDocsForPayroll(locals);

  return handleAttachmentPhoneNumberChange(locals);
};

const getUsersWithCheckInSubscription = async officeId => {
  const checkInSubscriptions = await rootCollections
    .activities
    .where('officeId', '==', officeId)
    .where('template', '==', 'subscription')
    .where('attachment.Template.value', '==', 'check-in')
    .where('status', '==', 'CONFIRMED')
    .get();

  return checkInSubscriptions
    .docs
    .map(doc => doc.get('attachment.Phone Number.value'));
};


const setLocationsReadEvent = async locals => {
  const {
    officeId,
    template
  } = locals.change.after.data();
  const [venue] = locals.change.after.get('venue');

  /**
   * Activity has no venue, so this activity is not
   * related to any location.
   */
  if (template === 'check-in' || !venue) {
    return;
  }

  let docsCounter = 0;
  let batchIndex = 0;
  const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
  const phoneNumbersArray = await getUsersWithCheckInSubscription(officeId);
  const numberOfBatches = Math.round(Math.ceil(phoneNumbersArray.length / MAX_DOCS_ALLOWED_IN_A_BATCH));
  const batchArray = Array.from(Array(numberOfBatches)).map(() => db.batch());
  const updatesPromises = [];

  phoneNumbersArray.forEach(phoneNumber => {
    updatesPromises.push(
      rootCollections
      .updates
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get()
    );
  });

  const updateDocs = await Promise.all(updatesPromises);

  updateDocs.forEach(doc => {
    if (!doc.exists) {
      return;
    }

    docsCounter++;

    if (docsCounter > 499) {
      docsCounter = 0;
      batchIndex++;
    }

    batchArray[batchIndex].set(
      rootCollections
      .updates
      .doc(doc.id), {
        lastLocationMapUpdateTimestamp: Date.now(),
      }, {
        merge: true,
      });
  });

  const commitBatch = async batch => {
    return process.nextTick(() => batch.commit());
  };

  return batchArray.reduce(async (accumulatorPromise, currentBatch) => {
    await accumulatorPromise;

    return commitBatch(currentBatch);
  }, Promise.resolve());
};


const handleRecipient = async locals => {
  const batch = db.batch();
  const recipientsDocRef = rootCollections.recipients.doc(locals.change.after.id);

  if (locals.addendumDoc && locals.addendumDoc.get('action') === httpsActions.comment) {
    return;
  }

  const {
    status
  } = locals.change.after.data();

  batch.set(recipientsDocRef, {
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
    batch.delete(recipientsDocRef);
  }

  return batch.commit();
};


const createNewProfiles = async ({
  newPhoneNumbersSet,
  smsContext
}) => {
  const profileBatch = db.batch();
  const profilePromises = [];

  const promiseCreator = phoneNumber => {
    profilePromises.push(
      rootCollections.profiles.doc(phoneNumber).get()
    );
  };

  newPhoneNumbersSet.forEach(promiseCreator);

  const snap = await Promise.all(profilePromises);
  const batchCreator = doc => {
    /** Profile already exists */
    if (doc.exists) {
      return;
    }

    // doc.id => phoneNumber
    profileBatch.set(doc.ref, {
      smsContext
    }, {
      merge: true
    });
  };

  snap.forEach(batchCreator);

  return profileBatch.commit();
};


const getCopyPath = ({
  template,
  officeId,
  activityId
}) => {
  if (template === 'office') {
    return rootCollections.offices.doc(activityId);
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
const isComment = action => action === httpsActions.comment ? 1 : 0;


const getUpdatedScheduleNames = (newSchedule, oldSchedule) => {
  const updatedFields = [];

  oldSchedule.forEach((item, index) => {
    const name = item.name;
    /** Request body ===> Update API request body. */
    const {
      startTime: newStartTime
    } = newSchedule[index];
    const {
      endTime: newEndTime
    } = newSchedule[index];
    const {
      startTime: oldStartTime
    } = item;
    const {
      endTime: oldEndTime
    } = item;

    if (newEndTime === oldEndTime && newStartTime === oldStartTime) {
      return;
    }

    updatedFields.push(name);
  });

  return updatedFields;
};


const getUpdatedAttachmentFieldNames = (newAttachment, oldAttachment) => {
  const updatedFields = [];

  Object.keys(newAttachment).forEach(field => {
    /** Comparing the `base64` photo string is expensive. Not doing it. */
    if (newAttachment[field].type === 'base64') {
      return;
    }

    const oldFieldValue = oldAttachment[field].value;
    const newFieldValue = newAttachment[field].value;
    const isUpdated = oldFieldValue !== newFieldValue;

    if (!isUpdated) {
      return;
    }

    updatedFields.push(field);
  });

  return updatedFields;
};


const getUpdatedFieldNames = options => {
  const {
    before: activityOld,
    after: activityNew
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

  if (assigneesMap.get(addendumCreator) &&
    assigneesMap.get(addendumCreator).displayName) {
    return assigneesMap.get(addendumCreator).displayName;
  }

  if (!assigneesMap.get(addendumCreator) &&
    !locals.addendumCreatorInAssignees) {
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
  const [templateNameFirstCharacter] = template;
  const article = vowels.has(templateNameFirstCharacter) ? 'an' : 'a';

  if (template === 'check-in' && locationFromVenue) {
    return `${pronoun} checked in from ${locationFromVenue}`;
  }

  return `${pronoun} created ${article} ${template}`;
};


const getChangeStatusComment = (status, activityName, pronoun) => {
  /** `PENDING` isn't grammatically correct with the comment here. */
  if (status === 'PENDING') {
    status = 'reversed';
  }

  return `${pronoun}` +
    ` ${status.toLowerCase()} ${activityName}`;
};


const getCommentString = (locals, recipient) => {
  const {
    action
  } = locals.addendumDoc.data();
  const pronoun = getPronoun(locals, recipient);
  const template = locals.addendumDoc.get('activityData.template');

  if (action === httpsActions.create) {
    const locationFromVenue = (() => {
      if (template !== 'check-in') {
        return null;
      }

      if (locals.addendumDocData.activityData &&
        locals.addendumDocData.activityData.venue &&
        locals.addendumDocData.activityData.venue[0] &&
        locals.addendumDocData.activityData.venue[0].location) {
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
    const {
      share
    } = locals.addendumDoc.data();
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
      const userName = locals.addendumDoc.get('activityData.attachment.Name.value');

      return `${userName} changed their phone number` +
        ` from ${oldPhoneNumber}` +
        ` to ${newPhoneNumber}`;
    }

    return `Phone number` +
      ` '${oldPhoneNumber} was` +
      ` changed to ${newPhoneNumber}`;
  }

  /** Action is `comment` */
  return locals.addendumDoc.get('comment');
};

const getRegTokenMap = async assigneesMap => {
  const regTokenMap = new Map();
  const updateDocRefs = [];

  assigneesMap
    .forEach(userRecord => {
      const {
        uid
      } = userRecord;

      if (!uid) {
        return;
      }

      updateDocRefs.push(
        rootCollections.updates.doc(uid)
      );
    });

  /**
   * Need to check for empty array here because db.getAll throws
   * an error when passing 0 arguments.
   */
  if (updateDocRefs.length === 0) {
    return regTokenMap;
  }

  (await db.getAll(...updateDocRefs)).forEach(doc => {
    const {
      phoneNumber,
      registrationToken
    } = doc.data();

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

const getCommentObject = ({
  addendumDoc,
  activityId,
  comment
}) => {
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

  locals.assigneePhoneNumbersArray.forEach(phoneNumber => {
    const {
      uid
    } = locals.assigneesMap.get(phoneNumber);
    const registrationToken = regTokenMap.get(phoneNumber);

    if (!uid || !registrationToken) {
      return;
    }

    const comment = getCommentString(locals, phoneNumber);

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
      admin.messaging().sendToDevice(
        registrationToken,
        getNotificationObject(comment), {
          priority: 'high',
          timeToLive: 60,
        }
      )
    );
  });

  await batch.commit();

  return Promise.all(notificationPromises);
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

  batch.set(initDoc, dataObject, {
    merge: true
  });

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
  if (accuracy && accuracy < 350) {
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

const handlePopulatedVenue = ({
  addendumDoc
}) => {
  /** User's current location */
  const deviceLocation = {
    _latitude: addendumDoc.get('location')._latitude,
    _longitude: addendumDoc.get('location')._longitude,
  };

  const {
    activityData,
    geopointAccuracy
  } = addendumDoc.data();
  const activityVenue = getVenueFromActivity(activityData);
  const distanceTolerance = getAccuracyTolerance(geopointAccuracy);

  // venue is populated => calculate distabce btw actual and venue location.
  // haversineDistance(geopointOne, geopointTwo)
  return {
    distanceAccurate: haversineDistance(deviceLocation, activityVenue.geopoint) < distanceTolerance,
    venueQuery: activityVenue,
  };
};

const handleUnpopulatedVenue = async ({
  addendumDoc
}) => {
  // venue is not populated.
  // query db with adjusted geopoint.
  const {
    activityData,
    geopointAccuracy,
    location: currentGeopoint,
  } = addendumDoc.data();
  const {
    officeId
  } = activityData;
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
  ).docs;

  // { isAccurate: false, venueQuery: null };
  if (!queriedActivity) {
    const mapsApiResult = await googleMapsClient.reverseGeocode({
      latlng: getLatLngString(currentGeopoint),
    }).asPromise();

    const csl = getLocalityCityState(mapsApiResult);
    const ui = getPlaceInformation(mapsApiResult, currentGeopoint);

    return Object.assign({}, csl, ui, {
      distanceAccurate: false,
      venueQuery: null,
    });
  }

  const [activityVenue] = queriedActivity.get('venue');
  const {
    geopoint: activityGeopoint
  } = activityVenue;

  const distanceBetween = haversineDistance(currentGeopoint, activityGeopoint);

  return {
    distanceAccurate: distanceBetween < distanceTolerance,
    venueQuery: activityVenue,
  };
};

const handleNoVenue = async ({
  currentGeopoint
}) => {
  const mapsApiResult = await googleMapsClient.reverseGeocode({
    latlng: getLatLngString(currentGeopoint),
  }).asPromise();

  /** city, state, locality */
  const csl = getLocalityCityState(mapsApiResult);
  /** url, identifier */
  const ui = getPlaceInformation(mapsApiResult, currentGeopoint);

  return Object.assign({}, csl, ui, {
    isAccurate: false,
    venueQuery: null,
  });
};

const checkDistanceAccurate = async ({
  addendumDoc
}) => {
  //   if activity.venue is NOT populated => use adjustedGeopoint and query / Activities collection;
  //   if a doc is found:
  //   check haversine distance between queried activity geopoint and current geopoint
  //   if distance < 1km:
  //     distance accurate = true
  //   else:
  //     distance accurate = false

  const {
    activityData,
    location: currentGeopoint
  } = addendumDoc.data();
  const activityVenue = getVenueFromActivity(activityData);

  /** Activity with template that does have venue array of 0 length */
  if (!activityVenue) {
    return handleNoVenue({
      currentGeopoint
    });
  }

  if (activityVenue.location) {
    return handlePopulatedVenue({
      addendumDoc
    });
  }

  return handleUnpopulatedVenue({
    addendumDoc
  });
};

const setGeopointAndTimestampInCheckInSubscription = async ({
  addendumDoc
}) => {
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
  ).docs;

  if (!checkInSubscriptionDoc) {
    return;
  }

  return checkInSubscriptionDoc.ref.set({
    lastGeopoint,
    lastTimestamp,
    lastAddendumRef: addendumDoc.ref
  }, {
    merge: true
  });
};

const getDistanceTravelled = ({
  previousAddendumDoc,
  distanceMatrixApiResult
}) => {
  if (!previousAddendumDoc) {
    return 0;
  }

  const [firstRow] = distanceMatrixApiResult.json.rows;
  const [firstElement] = firstRow.elements;
  const {
    distance: distanceData
  } = firstElement;

  return distanceData ? (distanceData.value / 1000) : 0;
};

const getUserRole = async ({
  addendumDoc
}) => {
  const {
    user: phoneNumber,
    userRole,
    activityData,
  } = addendumDoc.data();

  const {
    officeId
  } = activityData;

  if (userRole) {
    return userRole;
  }

  const [roleDocument] = (
    await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ACTIVITIES)
    .where('template', '==', 'employee')
    .where('attachment.Phone Number.value', '==', phoneNumber)
    .where('status', '==', 'CONFIRMED')
    .limit(1)
    .get()
  ).docs;

  return roleDocument;
};


const handleAddendum = async locals => {
  const {
    addendumDoc
  } = locals;

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
    .tz(
      addendumDoc.get('activityData.timezone') || 'Asia/Kolkata'
    );

  const isSkippableEvent = action === httpsActions.install ||
    action === httpsActions.signup ||
    action === httpsActions.branchView ||
    action === httpsActions.productView ||
    action === httpsActions.videoPlay;

  const date = momentWithOffset.date();
  const month = momentWithOffset.month();
  const year = momentWithOffset.year();

  if (isSkippableEvent) {
    return addendumDoc.ref.set({
      date,
      month,
      year
    }, {
      merge: true
    });
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
    if (addendumQuery.docs[0] &&
      addendumQuery.docs[0].id !== addendumDoc.id) {
      return addendumQuery.docs[0];
    }

    return addendumQuery.docs[1];
  })();

  if (previousAddendumDoc) {
    /**
     * The field `location` could be undefined for install or
     * signup events in the previous addendum
     */
    previousGeopoint = previousAddendumDoc.get('location') || currentGeopoint;

    promises.push(
      googleMapsClient.distanceMatrix({
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

  const daR = await checkDistanceAccurate({
    addendumDoc
  });
  const updateObject = Object.assign({},
    daR, {
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

  locals.previousAddendumDoc = previousAddendumDoc;

  /**
   * Seperating this part out because handling even a single crash
   * with `addendumOnCreate` cloud function messes up whole data for the user
   * after the time of the crash.
   */
  batch.set(addendumDoc.ref, updateObject, {
    merge: true
  });

  await batch.commit();

  await setGeopointAndTimestampInCheckInSubscription({
    addendumDoc
  });
  await createActivityStats(addendumDoc);

  locals.roleObject = await getUserRole({
    addendumDoc
  });

  return handleComments(addendumDoc, locals);
};

const getMetaBaseQuery = ({
  officeId,
  name,
  template
}) => {
  const baseQuery = rootCollections
    .activities
    .where('officeId', '==', officeId)
    .where('template', '==', 'employee');

  if (template === 'branch') {
    return baseQuery
      .where('attachment.Base Location.value', '==', name);
  }

  if (template === 'region') {
    return baseQuery
      .where('attachment.Region.value', '==', name);
  }

  if (template === 'department') {
    return baseQuery
      .where('attachment.Department.value', '==', name);
  }

  return null;
};

/**
 * If name is updated
 * get all the activities with this name
 * and update the activities
 * If this instance has run because of activity being cancelled
 * during status-change, set all the activities using this value
 * in their type as '' (empty string).
 */
const handleMetaUpdate = async locals => {
  if (!locals.change.before.data() || !locals.change.after.get('attachment.Name.value')) {
    return;
  }

  const {
    template,
    officeId,
    status: newStatus,
    attachment: {
      Name: {
        value: newName,
      }
    }
  } = locals.change.after.data();
  const {
    attachment: {
      Name: {
        value: oldName,
      },
    },
  } = locals.change.before.data();

  /**
   * Name was not updated, so no need to proceed further
   */
  if (oldName && (oldName === newName)) {
    return;
  }

  const query = getMetaBaseQuery({
    officeId,
    template,
    name: oldName
  });

  // Only proceed for branch, region and department
  if (!query) {
    return;
  }

  const value = (() => {
    if (newStatus === 'CANCELLED') {
      return '';
    }

    return newName;
  })();

  const field = (() => {
    if (template === 'branch') {
      return 'Base Location';
    }
    if (template === 'region') {
      return 'Region';
    }
    if (template === 'department') {
      return 'Department';
    }
  })();

  const docs = await query.get();
  const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
  const numberOfBatches = Math.round(Math.ceil(docs.size / MAX_DOCS_ALLOWED_IN_A_BATCH));
  const batchArray = Array.from(Array(numberOfBatches)).map(() => db.batch());
  let batchIndex = 0;
  let docsCounter = 0;

  docs.forEach(doc => {
    if (docsCounter > 499) {
      docsCounter = 0;
      batchIndex++;
    }

    docsCounter++;

    batchArray[batchIndex].set(doc.ref, {
      addendumDocRef: null,
      attachment: {
        [field]: {
          value
        }
      },
    }, {
      merge: true
    });
  });

  return Promise.all(batchArray.map(batch => batch.commit()));
};

const getDutyCheckIns = ({
  doc,
  phoneNumber
}) => {
  const checkIns = doc.get('checkIns') || {};

  checkIns[phoneNumber] = checkIns[phoneNumber] || [];
  checkIns[phoneNumber].push(Date.now());

  return checkIns;
};

const handleScheduledActivities = async locals => {
  const batch = db.batch();
  const {
    officeId,
    timezone
  } = locals.change.after.data();
  const momentNow = momentTz().tz(timezone);
  const dateStringToday = momentNow.format(dateFormats.DATE);
  const phoneNumber = locals.change.after.get('creator.phoneNumber');
  const displayName = locals.change.after.get('creator.displayName');

  const scheduledActivities = await rootCollections
    .profiles
    .doc(phoneNumber)
    .collection(subcollectionNames.ACTIVITIES)
    .where('officeId', '==', officeId)
    .where('scheduleDates', 'array-contains', dateStringToday)
    .get();

  const activityIds = new Set();

  scheduledActivities.forEach(doc => {
    const {
      id: activityId
    } = doc;
    const location = doc.get('attachment.Location.value');

    if (location) {
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

    /**
     * Since we are using an array_contains query
     * to fetch the activities, it is certainly possible that
     * we might get duplicate activities in a single response.
     * We don't want that.
     */
    if (activityIds.has(activityId)) {
      return;
    }

    activityIds.add(activityId);

    const addendumDocRef = rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ADDENDUM)
      .doc();

    batch.set(addendumDocRef, {
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
      userDisplayName: displayName,
      isAutoGenerated: true,
      comment: `${displayName || phoneNumber} checked ` +
        `in from ${doc.get('template')} Location: ${location}`,
      activityData: doc.data(),
      activityId: doc.ref.id,
    });

    batch.set(locals.change.after.ref, {
      addendumDocRef,
      timestamp: Date.now(),
    }, {
      merge: true,
    });

    batch.set(rootCollections.activities.doc(doc.id), {
      addendumDocRef,
      timestamp: Date.now(),
      checkIns: getDutyCheckIns({
        doc,
        phoneNumber
      }),
    }, {
      merge: true
    });
  });

  return batch.commit();
};


const handleTypeActivityCreation = async locals => {
  if (locals.addendumDoc &&
    (locals.addendumDoc.get('action') === httpsActions.comment ||
      locals.addendumDoc.get('action') === httpsActions.share)) {
    return;
  }

  const {
    template,
    officeId
  } = locals.change.after.data();

  // eg => leave-type -> 'leave'
  const [parentTemplate, typePart] = template.split('-type');

  if (!typePart) {
    return;
  }

  console.log('handleTypeActivityCreation');

  const docs = await rootCollections
    .activities
    .where('template', '==', 'subscription')
    .where('officeId', '==', officeId)
    .where('status', '==', 'CONFIRMED')
    .where('attachment.Template.value', '==', parentTemplate)
    .get();

  const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
  const numberOfBatches = Math.round(Math.ceil(docs.size / MAX_DOCS_ALLOWED_IN_A_BATCH));
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

    batchArray[batchIndex].set(doc.ref, {
      addendumDocRef: null,
      timestamp: Date.now(),
    }, {
      merge: true,
    });
  });

  return Promise.all(batchArray.map(batch => batch.commit()));
};


const getReimbursementTimestamp = activityDoc => {
  const {
    template
  } = activityDoc.data();

  // For claim, if the schedule timestamp is present, that timestamp
  // will be the claim timestamp
  // otherwise, activity create time is the fallback.
  if (template === 'claim' &&
    activityDoc.get('schedule')[0] &&
    Number.isInteger(activityDoc.get('schedule')[0].startTime)) {
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
  const {
    id: claimId
  } = locals.change.after;
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
    .where('claimId', '==', claimId)
    .limit(1)
    .get();

  const claimsDocRef = !claimsToday.empty ? claimsToday.docs[0].ref : rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.REIMBURSEMENTS)
    .doc();

  const roleData = getEmployeeReportData(
    locals.roleObject,
    phoneNumber
  );

  const claimUpdate = Object.assign({}, roleData, {
    status,
    date,
    month,
    year,
    office,
    officeId,
    claimId,
    timestamp: Date.now(),
    currency: 'INR',
    reimbursementType: 'claim',
    relevantActivityId: locals.change.after.id,
    reimbursementName: locals.change.after.get('attachment.Claim Type.value'),
    photoURL: getValueFromActivity(locals.change, 'attachment.Photo URL.value'),
    amount: getValueFromActivity(locals.change, 'attachment.Amount.value'),
    claimType: getValueFromActivity(locals.change, 'attachment.Claim Type.value'),
  });

  const batch = db.batch();

  if (locals.addendumDocData.action === httpsActions.changeStatus) {
    if (status === 'CANCELLED') {
      claimUpdate.cancelledBy = locals.addendumDocData.user;
      claimUpdate.cancellationTimestamp = locals.addendumDocData.timestamp;
    }

    if (status === 'CONFIRMED') {
      claimUpdate.confirmedBy = locals.addendumDocData.user;
      claimUpdate.confirmationTimestamp = locals.addendumDocData.timestamp;
    }
  }

  batch.set(claimsDocRef, claimUpdate, {
    merge: true,
  });

  const [claimUpdatesDoc] = (
    await rootCollections
    .updates
    .doc(uid)
    .collection(subcollectionNames.ADDENDUM)
    .where('details.claimId', '==', claimId)
    .limit(1)
    .get()
  ).docs;

  const claimRef = claimUpdatesDoc ? claimUpdatesDoc.ref : rootCollections
    .updates
    .doc(uid)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  batch.set(claimRef, {
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
      claimId,
      rate: null,
      checkInTimestamp: null,
      startLocation: null,
      endLocation: null,
      distanceTravelled: locals.addendumDocData.distanceTravelled,
      photoURL: locals.change.after.get('attachment.Photo URL.value') || '',
    },
  }, {
    merge: true,
  });

  return batch.commit();
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
  claimsToday.forEach(doc => {
    existingDailyAllowances.add(doc.get('reimbursementName'));
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

  const dailyAllowanceActivities = await dailyAllowanceBaseQuery.get();

  if (dailyAllowanceActivities.empty) {
    return;
  }

  const roleData = getEmployeeReportData(
    locals.roleObject,
    phoneNumber
  );

  dailyAllowanceActivities.forEach(daActivity => {
    const {
      value: attachmentName
    } = daActivity.get('attachment.Name');
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

    if (startHours === '' || startMinutes === '' || endHours === '' || endMinutes === '') {
      return;
    }

    const momentStart = momentTz().hours(startHours).minutes(startMinutes);
    const momentEnd = momentTz().hours(endHours).minutes(endMinutes);

    /** Is not in the time range */
    if (momentNow.isBefore(momentStart) ||
      momentEnd.isAfter(momentEnd)) {
      return;
    }

    if (existingDailyAllowances.has(attachmentName)) {
      return;
    }

    const update = Object.assign({}, roleData, {
      uid,
      date,
      month,
      year,
      officeId,
      phoneNumber,
      reimbursementType,
      currency: 'INR',
      timestamp: Date.now(),
      office: locals.change.after.get('office'),
      checkInTimestamp: locals.change.after.get('timestamp'),
      reimbursementName: daActivity.get('attachment.Name.value'),
      amount: daActivity.get('attachment.Amount.value'),
      relevantActivityId: locals.change.after.id,
      dailyAllowanceActivityId: daActivity.id,
      currentGeopoint: locals.addendumDocData.location,
      previousGeopoint: (() => {
        if (locals.previousAddendumDoc &&
          locals.previousAddendumDoc.get('location')) {
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
        if (locals.previousAddendumDoc &&
          locals.previousAddendumDoc.get('venueQuery.location')) {
          return locals
            .previousAddendumDoc
            .get('venueQuery.location');
        }

        if (locals.previousAddendumDoc &&
          locals.previousAddendumDoc.get('identifier')) {
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

    batch.set(ref, update, {
      merge: true,
    });

    batch.set(rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), Object.assign({}, {
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
          checkInTimestamp: momentNow.tz(timezone).valueOf(), // unix
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

  return batch.commit();
};


const getStartPointObject = ({
  startPointLatitude,
  startPointLongitude,
}) => {
  if (typeof startPointLatitude !== 'number' ||
    typeof startPointLongitude !== 'number') {
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

  const {
    timestamp
  } = locals.addendumDocData;
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

  const roleDoc = locals.roleObject;

  // Not an employee, km allowance is skipped
  if (!roleDoc) {
    console.log('Skip km allowance => no employee doc');

    return;
  }

  const {
    value: kmRate,
  } = roleDoc.get('attachment.KM Rate');
  const {
    value: startPointLatitude,
  } = roleDoc.get('attachment.Start Point Latitude');
  const {
    value: startPointLongitude,
  } = roleDoc.get('attachment.Start Point Longitude');
  const {
    value: scheduledOnly,
  } = roleDoc.get('attachment.Scheduled Only');

  // Scheduled Only means action === check-in. Exit otherwise
  if (scheduledOnly &&
    (locals.addendumDocData.action !== httpsActions.checkIn)) {
    console.log('Skip km allowance => scheduled Only');

    return;
  }

  if (!kmRate) {
    console.log('Skip km allowance => no km rate', kmRate);

    return;
  }

  const roleData = {
    phoneNumber,
    employeeName: roleDoc.get('attachment.Name.value'),
    employeeCode: roleDoc.get('attachment.Employee Code.value'),
    baseLocation: roleDoc.get('attachment.Base Location.value'),
    region: roleDoc.get('attachment.Region.value'),
    department: roleDoc.get('attachment.Department.value'),
    minimumDailyActivityCount: roleDoc.get('attachment.Minimum Daily Activity Count.value'),
    minimumWorkingHours: roleDoc.get('attachment.Minimum Working Hours.value'),
  };

  const batch = db.batch();
  const reimbursementType = 'km allowance';
  const momentNow = momentTz(timestamp).tz(timezone);
  const date = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();
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
  ] = await Promise.all([
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

  const startPointDetails = getStartPointObject({
    officeId,
    startPointLatitude,
    startPointLongitude,
    baseLocation: roleData.baseLocation,
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
    batch.set(r1, Object.assign({}, roleData, commonReimObject, {
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
        latitude: locals.addendumDocData.location.latitude ||
          locals.addendumDocData.location._latitude,
        longitude: locals.addendumDocData.location.longitude ||
          locals.addendumDocData.location._latitude,
      },
      intermediate: false,
    }), {
      merge: true,
    });

    // current location to start point
    batch.set(r2, Object.assign({}, commonReimObject, {
      rate: kmRate,
      previousIdentifier: (() => {
        if (locals.addendumDocData.venueQuery) {
          return locals.addendumDocData.venueQuery.location;
        }

        return locals.addendumDocData.identifier;
      })(),
      previousGeopoint: {
        latitude: locals.addendumDocData.location.latitude ||
          locals.addendumDocData.location._latitude,
        longitude: locals.addendumDocData.location.longitude ||
          locals.addendumDocData.location._latitude,
      },
      currentIdentifier: startPointDetails.identifier,
      currentGeopoint: startPointDetails.geopoint,
      intermediate: true,
      amount: (kmRate * distanceBetweenCurrentAndStartPoint).toFixed(0),
      distance: distanceBetweenCurrentAndStartPoint,
    }));

    // start point to current location
    batch.set(u1, Object.assign({}, commonReimObject, {
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
          latitude: locals.addendumDocData.location.latitude ||
            locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude ||
            locals.addendumDocData.location._latitude,
        },
        distanceTravelled: distanceBetweenCurrentAndStartPoint,
        photoURL: null,
        status: null,
        claimId: null,
      },
    }));

    // curr to start point
    batch.set(u2, Object.assign({}, commonReimObject, {
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
          latitude: locals.addendumDocData.location.latitude ||
            locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude ||
            locals.addendumDocData.location._latitude,
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
      .set(oldReimbursementDoc.ref, Object.assign({}, roleData, commonReimObject, {
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
          latitude: locals.addendumDocData.location.latitude ||
            locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude ||
            locals.addendumDocData.location._latitude,
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

    batch.set(oldUpdatesRef, Object.assign({}, commonReimObject, {
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
          latitude: locals.addendumDocData.location.latitude ||
            locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude ||
            locals.addendumDocData.location._latitude,
        },
      },
    }), {
      merge: true,
    });

    // currentLocation (start) to startPoint (end)
    batch
      .set(r1, Object.assign({}, roleData, commonReimObject, {
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
          latitude: locals.addendumDocData.location.latitude ||
            locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude ||
            locals.addendumDocData.location._latitude,
        },
        intermediate: true,
      }), {
        merge: true,
      });

    // currentLocation (start) to startPoint (end)
    batch.set(u1, Object.assign({}, commonReimObject, {
      _type: addendumTypes.REIMBURSEMENT,
      amount: amountThisTime.toFixed(0),
      id: `${date}${month}${year}${r1.id}`,
      // momentTz().date(date).month(month).year(year).startOf('date').valueOf()
      key: momentTz().date(date).month(month).year(year).startOf('date').valueOf(),
      // used for attachment.Claim Type.value for 'claim' activities
      reimbursementName: null,
      intermediate: true,
      details: {
        rate: kmRate,
        startLocation: {
          latitude: locals.addendumDocData.location.latitude ||
            locals.addendumDocData.location._latitude,
          longitude: locals.addendumDocData.location.longitude ||
            locals.addendumDocData.location._latitude,
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

  return;
};


const getLateStatus = ({
  firstCheckInTimestamp,
  dailyStartTime,
  timezone
}) => {
  if (Number.isInteger(firstCheckInTimestamp)) {
    return false;
  }

  if (!isNonEmptyString(dailyStartTime)) {
    return false;
  }

  const [
    startHours,
    startMinutes,
  ] = dailyStartTime.split(':');

  const momentStartTime = momentTz()
    .hour(startHours)
    .minutes(startMinutes);
  const momentNow = momentTz(firstCheckInTimestamp)
    .tz(timezone);

  return momentNow.diff(momentStartTime, 'minutes', true) > 15;
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
      'Phone Number': {
        value: phoneNumber,
      }
    }
  } = employeeDoc.data();

  const timezone = employeeDoc.get('timezone') || 'Asia/Kolkata';
  const momentToday = momentTz().tz(timezone);
  const momentPrevMonth = momentToday.clone().subtract(1, 'months');
  const monthYearCombinations = new Set();
  const attendanceDocPromises = [];
  const empCt = momentTz(employeeDoc.createTime.toMillis());

  batch.set(employeeDoc.ref, {
    lastAttendanceTimestamp: dateRangeEnd.valueOf(),
  }, {
    merge: true,
  });

  const dateRangeStart = (() => {
    /**
     * Employee created in the previous month
     * The Loop will run from creation date to today
     */
    if (empCt.month() === momentPrevMonth.month() &&
      empCt.year() && momentPrevMonth.year()) {
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
      return momentTz(lastAttendanceTimestamp).tz(timezone);
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

    allDates[`${month}-${year}`] = allDates[`${month}-${year}`] || [];
    allDates[`${month}-${year}`].push(date);
    monthYearCombinations.add(`${month}-${year}`);

    tempMoment.add(1, 'days');
  }

  monthYearCombinations.forEach(monthYear => {
    const [
      monthString,
      yearString,
    ] = monthYear.split('-');
    const month = Number(monthString);
    const year = Number(yearString);

    attendanceDocPromises.push(
      rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ATTENDANCES)
      .where('month', '==', month)
      .where('year', '==', year)
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get()
    );
  });

  (await Promise.all(attendanceDocPromises)).forEach(snap => {
    const [doc] = snap.docs;
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

    const dates = allDates[`${month}-${year}`];

    dates.forEach(date => {
      data.attendance = data.attendance || {};

      if (data.attendance.hasOwnProperty(date)) {
        return;
      }

      data.attendance[date] = data.attendance[date] ||
        getDefaultAttendanceObject();

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

  return batch.commit();
};


const handleWorkday = async locals => {
  /**
   * Template === check-in and action === 'create'
   */
  if (!locals.addendumDocData) {
    return;
  }

  if (locals.addendumDocData.action !== httpsActions.create) {
    return;
  }

  const {
    officeId,
    timezone,
    office,
    creator: {
      phoneNumber,
    },
  } = locals.change.after.data();
  const momentNow = momentTz(locals.addendumDocData.timestamp).tz(timezone);
  const todaysDate = momentNow.date();
  const month = momentNow.month();
  const year = momentNow.year();
  const roleData = getEmployeeReportData(locals.roleObject, phoneNumber);

  // If employee Location Validation Check => true
  // AND distanceAccurate => false
  // skip
  // Using explicit check for this case because
  // values can be empty strings.
  if (roleData.locationValidationCheck === true &&
    locals.addendumDocData.distanceAccurate === false) {
    return;
  }

  const {
    location
  } = locals.addendumDocData;

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
  ).docs;

  const attendanceDocRef = attendanceDoc ? attendanceDoc.ref : rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc();

  const attendanceObject = attendanceDoc ? attendanceDoc.data() : {};

  attendanceObject.attendance = attendanceObject.attendance || {};
  attendanceObject.attendance[todaysDate] = attendanceObject
    .attendance[todaysDate] || getDefaultAttendanceObject();
  attendanceObject.attendance[todaysDate].working = attendanceObject
    .attendance[todaysDate].working || {};

  /**
   * If the first check-in has already been set for this user
   * we don't need to update it again for the day
   */
  attendanceObject.attendance[todaysDate].working.firstCheckInTimestamp = attendanceObject
    .attendance[todaysDate]
    .working.firstCheckInTimestamp || locals.addendumDocData.timestamp;

  attendanceObject
    .attendance[todaysDate]
    .working
    .lastCheckInTimestamp = locals.addendumDocData.timestamp;

  attendanceObject.attendance[todaysDate].isLate = getLateStatus({
    timezone,
    firstCheckInTimestamp: attendanceObject
      .attendance[todaysDate]
      .working
      .firstCheckInTimestamp,
    dailyStartTime: roleData.dailyStartTime,
  });

  attendanceObject.attendance[todaysDate].addendum = attendanceObject
    .attendance[todaysDate].addendum || [];

  attendanceObject.attendance[todaysDate].addendum.push({
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
    .sort((first, second) => first.timestamp - second.timestamp);

  const {
    length: numberOfCheckIns
  } = attendanceObject.attendance[todaysDate].addendum;
  const [firstAddendum] = attendanceObject.attendance[todaysDate].addendum;
  const lastAddendum = attendanceObject.attendance[todaysDate].addendum[numberOfCheckIns - 1];
  const hoursWorked = momentTz(lastAddendum.timestamp).diff(
    momentTz(firstAddendum.timestamp),
    'hours',
    true
  );

  attendanceObject.attendance[todaysDate].attendance = getStatusForDay({
    // difference between first and last action in hours
    hoursWorked,
    // number of actions done in the day by the user
    numberOfCheckIns,
    minimumDailyActivityCount: roleData.minimumDailyActivityCount,
    minimumWorkingHours: roleData.minimumWorkingHours,
  });

  if (attendanceObject.attendance[todaysDate].onAr ||
    attendanceObject.attendance[todaysDate].onLeave ||
    attendanceObject.attendance[todaysDate].holiday ||
    attendanceObject.attendance[todaysDate].weeklyOff) {
    attendanceObject.attendance[todaysDate].attendance = 1;
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
    attendanceObject.attendance[date] = attendanceObject.attendance[date] || getDefaultAttendanceObject();

    const checkInsArray = attendanceObject.attendance[date].addendum || [];
    const {
      length: numberOfCheckIns
    } = checkInsArray || [];

    const hoursWorked = getAttendanceHoursWorked({
      attendanceData: attendanceObject,
      date,
    });

    attendanceObject.attendance[date].attendance = (() => {
      const {
        onAr,
        onLeave,
        holiday,
        weeklyOff
      } = attendanceObject.attendance[date];

      if (onAr || onLeave || holiday || weeklyOff) {
        return 1;
      }

      return getStatusForDay({
        hoursWorked,
        numberOfCheckIns,
        minimumDailyActivityCount: roleData.minimumDailyActivityCount,
        minimumWorkingHours: roleData.minimumWorkingHours,
      });
    })();

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

  batch.set(
    attendanceDocRef,
    Object.assign({}, roleData, attendanceObject, {
      year,
      month,
      office,
      officeId,
      phoneNumber,
      timestamp: Date.now(),
    }), {
      merge: true,
    });

  batch.set(rootCollections
    .updates
    .doc(uid)
    .collection(subcollectionNames.ADDENDUM)
    .doc(), Object.assign({}, attendanceObject.attendance[todaysDate], {
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

  await batch.commit();
  await handleScheduledActivities(locals);

  /** Only populate the missing attendances when the attendance doc was created */
  if (!attendanceDoc) {
    await populateWeeklyOffInAttendance({
      uid,
      employeeDoc: locals.roleObject,
      month: momentNow.month(),
      year: momentNow.year(),
    });
  }

  if (!attendanceDoc || !roleData) {
    return;
  }

  // backfill
  return populateMissingAttendances(
    locals.roleObject,
    momentNow.clone(),
    uid
  );
};

const getSubcollectionActivityObject = ({
  activityObject,
  customerObject
}) => {
  const {
    status,
    template
  } = activityObject.data();

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

const getProfileActivityObject = ({
  activityDoc,
  assigneesMap,
  assigneePhoneNumbersArray,
  customerObject
}) => {
  const {
    id: activityId
  } = activityDoc;

  const assigneeCallback = phoneNumber => {
    const {
      displayName,
      photoURL
    } = assigneesMap.get(phoneNumber) || {};

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
  const {
    template
  } = locals.change.after.data();

  const action = locals.addendumDocData ? locals.addendumDocData.action : null;

  if (template === 'check-in' || action === httpsActions.checkIn) {
    await reimburseDailyAllowance(locals);
    await reimburseKmAllowance(locals);
  }

  if (template === 'check-in') {
    return handleWorkday(locals);
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

  if (template === 'admin') {
    await require('./template-handlers/admin')(locals);
  }

  await handleConfig(locals);
  await handleTypeActivityCreation(locals);
  await handleMetaUpdate(locals);

  return setLocationsReadEvent(locals);
};

const handleProfile = async change => {
  const batch = db.batch();
  const {
    id: activityId
  } = change.after;
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

  const newPhoneNumbersSet = new Set();
  const authFetchPromises = [];
  const {
    template,
    addendumDocRef
  } = change.after.data();

  const promises = [
    rootCollections
    .activities
    .doc(activityId)
    .collection(subcollectionNames.ASSIGNEES)
    .get(),
  ];

  /** Could be `null` when we update the activity without user intervention */
  if (addendumDocRef) {
    promises.push(addendumDocRef.get());
  }

  const [assigneesSnapShot, addendumDoc] = await Promise.all(promises);

  locals.addendumDoc = addendumDoc || null;

  assigneesSnapShot.forEach(doc => {
    const {
      id: phoneNumber
    } = doc;
    const {
      addToInclude,
    } = doc.data();

    if (addendumDoc && phoneNumber === addendumDoc.get('user')) {
      locals.addendumCreatorInAssignees = true;
    }

    authFetchPromises.push(getAuth(phoneNumber));

    /** Storing phoneNumber in the object because we are storing assigneesMap in addendum doc */
    locals.assigneesMap.set(
      phoneNumber, {
        phoneNumber,
        addToInclude: addToInclude || false
      }
    );

    locals.assigneePhoneNumbersArray.push(phoneNumber);
  });

  if (addendumDoc && !locals.addendumCreatorInAssignees) {
    authFetchPromises.push(getAuth(addendumDoc.get('user')));
  }

  locals.customerObject = await getCustomerObject({
    name: change.after.get('attachment.Location.value'),
    officeId: change.after.get('officeId'),
    template: template === 'duty' ? 'customer' : 'branch',
  });

  const userRecords = await Promise.all(authFetchPromises);

  userRecords.forEach(userRecord => {
    const {
      phoneNumber,
      uid
    } = userRecord;

    if (addendumDoc && !locals.addendumCreatorInAssignees && phoneNumber === addendumDoc.get('user')) {
      locals.addendumCreator.displayName = userRecord.displayName;

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
    customerObject: locals.customerObject,
    activityDoc: change.after,
    assigneePhoneNumbersArray: locals.assigneePhoneNumbersArray,
    assigneesMap: locals.assigneesMap,
  });

  userRecords.forEach(userRecord => {
    const {
      uid,
      phoneNumber
    } = userRecord;

    /**
     * Check-ins clutter the `Activities` collection and
     * make the `/read` resource slow. If the user doesn't have
     * auth, there's no point in putting a check-in their
     * profile.
     */
    if (template === 'check-in' && !uid) {
      return;
    }

    // in profile
    batch.set(
      rootCollections
      .profiles
      .doc(phoneNumber)
      .collection(subcollectionNames.ACTIVITIES)
      .doc(activityId),
      profileActivityObject, {
        merge: true
      }
    );

    if (uid) {
      // in updates only if auth exists
      batch.set(
        rootCollections
        .updates
        .doc(uid)
        .collection(subcollectionNames.ADDENDUM)
        .doc(), Object.assign({}, profileActivityObject, {
          _type: addendumTypes.ACTIVITY,
        }), {
          merge: true
        }
      );
    }
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
    getSubcollectionActivityObject({
      activityObject: change.after,
      customerObject: locals.customerObject,
    }), {
      merge: true
    }
  );

  await batch.commit();

  await createNewProfiles({
    newPhoneNumbersSet,
    smsContext: {
      activityName: change.after.get('activityName'),
      office: change.after.get('office'),
      creator: change.after.get('creator.phoneNumber') || change.after.get('creator'),
    }
  });

  return locals;
};

const getActivityReportName = async ({
  activityDoc
}) => {
  const {
    report,
    template,
  } = activityDoc.data();

  if (report) {
    return report;
  }

  const [templateDoc] = (
    await rootCollections
    .activityTemplates
    .where('name', '==', template)
    .limit(1)
    .get()
  ).docs;

  return templateDoc.get('report');
};


const attendanceHandler = async locals => {
  if (!locals.addendumDocData) {
    return;
  }

  const {
    template,
    status,
    officeId,
    office,
    creator: {
      phoneNumber,
    },
    schedule,
    attachment: {
      Reason: {
        value: reason,
      },
    },
  } = locals.change.after.data();
  const isCancelled = status === 'CANCELLED';
  const [firstSchedule] = schedule;

  const roleData = getEmployeeReportData(locals.roleObject, phoneNumber);
  let uid = locals.addendumDocData.uid;
  const batch = db.batch();

  if (!uid) {
    uid = (await getAuth(phoneNumber)).uid;
  }

  const {
    startTime,
    endTime
  } = firstSchedule;

  const momentStartTime = momentTz(startTime).startOf('date');
  const copyOfMomentStartTime = momentStartTime.clone();
  const momentEndTime = momentTz(endTime).endOf('date');
  const datesToSet = new Set();
  const startTimeMonth = momentStartTime.month();
  const {
    user
  } = locals.addendumDocData;

  const hasBeenCancelled = locals.change.before.data() &&
    locals.change.before.get('status') !== 'CANCELLED' &&
    locals.change.after.get('status') === 'CANCELLED';

  console.log('before loop');

  while (copyOfMomentStartTime.isSameOrBefore(momentEndTime)) {
    if (startTimeMonth === copyOfMomentStartTime.month()) {
      datesToSet.add(copyOfMomentStartTime.date());
    }

    copyOfMomentStartTime.add(1, 'days');
  }

  console.log('datesToSet', datesToSet.values());

  const [attendanceDoc] = (
    await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .where('phoneNumber', '==', phoneNumber)
    .where('month', '==', momentStartTime.month())
    .where('year', '==', momentStartTime.year())
    .limit(1)
    .get()
  ).docs;

  const attendanceData = attendanceDoc ? attendanceDoc.data() : {};

  attendanceData.attendance = attendanceData.attendance || {};

  datesToSet.forEach(date => {
    attendanceData.attendance[date] = attendanceData
      .attendance[date] || getDefaultAttendanceObject();

    if (!isCancelled) {
      attendanceData.attendance[date].attendance = 1;
    }

    if (template === 'leave') {
      attendanceData.attendance[date].leave.reason = reason;
      attendanceData.attendance[date].onLeave = !isCancelled;
      attendanceData.attendance[date].leave[status] = {
        phoneNumber: user,
        timestamp: Date.now()
      };
    }

    if (template === 'attendance regularization') {
      attendanceData.attendance[date].ar.reason = reason;
      attendanceData.attendance[date].onAr = !isCancelled;
      attendanceData.attendance[date].ar[status] = {
        phoneNumber: user,
        timestamp: Date.now()
      };
    }

    console.log(date, hasBeenCancelled);

    if (hasBeenCancelled) {
      // recalculate attendance for these dates
      const checkInsArray = attendanceData.attendance[date].addendum || [];
      const {
        length: numberOfCheckIns
      } = checkInsArray;

      const hoursWorked = getAttendanceHoursWorked({
        attendanceData,
        date
      });

      console.log('hoursWorked', hoursWorked);
      console.log('before calculation', attendanceData.attendance[date].attendance);
      attendanceData.attendance[date].attendance = (() => {
        const {
          holiday,
          weeklyOff
        } = attendanceData.attendance[date];

        if (holiday || weeklyOff) {
          console.log('attendance from if');
          return 1;
        }

        const params = {
          numberOfCheckIns, // number of actions done in the day by the user
          // difference between first and last action in hours,
          hoursWorked,
          minimumWorkingHours: roleData.minimumWorkingHours,
          minimumDailyActivityCount: roleData.minimumDailyActivityCount,
        };

        console.log('attendance from getStatusForDay', params);

        return getStatusForDay(params);
      })();

      console.log('after calculation', attendanceData.attendance[date].attendance);
    }

    const momentInstance = momentStartTime.clone().date(date);

    batch.set(
      rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), Object.assign({}, attendanceData.attendance[date], {
        date,
        office,
        officeId,
        timestamp: Date.now(),
        activityId: locals.change.after.id,
        _type: addendumTypes.ATTENDANCE,
        month: momentStartTime.month(),
        year: momentStartTime.year(),
        key: momentInstance.clone().startOf('day').valueOf(),
        id: `${date}${momentStartTime.month()}${momentStartTime.year()}${officeId}`,
      }), {
        merge: true
      });
  });

  const attendanceRef = attendanceDoc ? attendanceDoc.ref : rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc();

  console.log(template, attendanceRef.path);

  batch.set(
    attendanceRef,
    Object.assign({}, attendanceData, roleData, {
      month: momentStartTime.month(),
      year: momentStartTime.year(),
      office,
      officeId,
    }), {
      merge: true
    });

  return batch.commit();
};


const ActivityOnWrite = async change => {
  /** Activity was deleted. For debugging only. */
  if (!change.after.data()) {
    return;
  }

  const locals = await handleProfile(change);

  /**
   * The sequence of handleAddendum and handleProfile matters for
   * correct execution flow. All other functions can be called in
   * any order.
   */
  await handleAddendum(locals);
  await templateHandler(locals);

  const activityReportName = await getActivityReportName({
    activityDoc: locals.change.after,
  });

  if (activityReportName === 'attendance') {
    await attendanceHandler(locals);
  }

  if (activityReportName === 'reimbursement') {
    await handleReimbursement(locals);
  }

  return;
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
