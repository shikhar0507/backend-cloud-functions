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
  dateFormats,
} = require('../../admin/constants');
const {
  sendSMS,
  slugify,
  addEmployeeToRealtimeDb,
  millitaryToHourMinutes,
  getBranchName,
  adjustedGeopoint,
  getUsersWithCheckIn,
} = require('../../admin/utils');
const {
  activityName,
  forSalesReport,
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


const sendEmployeeCreationSms = locals => {
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

      if (status === 'CANCELLED'
        && customClaims.admin
        && customClaims.admin.includes(office)) {
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
  const officeId = locals.change.after.get('officeId');
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
    && locals.addendumDoc.get('action')
    === httpsActions.comment) {
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


const createAutoSubscription = async (locals, templateName, subscriber) => {
  if (!subscriber) {
    return Promise.resolve();
  }

  const office = locals.change.after.get('office');
  const officeId = locals.change.after.get('officeId');
  const batch = db.batch();
  // const subscribedTemplate = locals.change.after.get('attachment.Template.value');
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
    if (isArSubscription && payrollRecipientQuery.empty) {
      return;
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
  } catch (error) {
    console.error(error);
  }
};

const handleXTypeActivities = async locals => {
  const typeActivityTemplates = new Set(['customer', 'leave', 'expense claim']);
  const template = locals.change.after.get('template');

  if (template !== 'subscription'
    || !typeActivityTemplates.has(template)) {
    return;
  }

  const officeId = locals.change.after.get('officeId');
  try {
    const typeActivities = await rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', `${locals.change.after.get('attachment.Template.value')}-type`)
      .get();

    const subscriber = locals.change.after.get('attachment.Subscriber.value');

    // if subscription is created/updated
    // fetch all x-type activities from
    // Offices/(officeId)/Activities
    // Put those activities in the subscriber path
    // Profiles/(subscriber)/Activities/{x-type activityId}/
    const batch = db.batch();

    typeActivities.forEach(activity => {
      const activityData = activity.data();

      delete activityData.addendumDocRef;

      activityData.assignees = [];

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

  const office = locals.change.after.get('office');
  const status = locals.change.after.get('status');
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
  const setData = (ref, data) => {
    return new Promise((resolve, reject) => {
      ref.set(data, error => {
        if (error) return reject(error);

        resolve();
      });
    });
  };

  const getData = ref => {
    return new Promise(resolve => {
      ref.on('value', resolve);
    });
  };

  const deleteData = ref => {
    return new Promise((resolve, reject) => {
      ref.remove(error => {
        if (error) return reject(error);

        resolve();
      });
    });
  };

  const template = locals.change.after.get('template');

  if (template !== 'subscription') {
    return;
  }

  const subscribedTemplate = locals.change.after.get('attachment.Template.value');

  if (subscribedTemplate !== 'check-in') {
    return;
  }

  const officeId = locals.change.after.get('officeId');
  const ref = admin.database().ref(`${officeId}/${subscribedTemplate}`);
  const oldSubscriber = locals.change.before.get('attachment.Subscriber.value');
  const newSubscriber = locals.change.after.get('attachment.Subscriber.value');
  const status = locals.change.after.get('status');

  try {
    if (status === 'CANCELLED') {
      return deleteData(ref);
    }

    if (oldSubscriber
      && oldSubscriber !== newSubscriber) {
      const ref = admin.database().ref(`${officeId}/${oldSubscriber}`);

      await deleteData(ref);
    }

    let oldObject = await getData(ref);
    oldObject = oldObject || {};
    oldObject[newSubscriber] = true;

    return setData(ref, oldObject);
  } catch (error) {
    console.error(error);
  }
};


const handleSubscription = locals => {
  const template = locals.change.after.get('template');

  if (template !== 'subscription') {
    return Promise.resolve();
  }

  const batch = db.batch();
  const templateName = locals.change.after.get('attachment.Template.value');
  const newSubscriber = locals.change.after.get('attachment.Subscriber.value');
  const oldSubscriber = locals.change.before.get('attachment.Subscriber.value');
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

const removeFromOfficeActivities = locals => {
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
      .then(docs => {
        if (docs.empty) {
          return 0;
        }

        const batch = db.batch();

        docs.forEach(doc => {
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

          const phoneNumberInAttachment
            = doc.get('attachment.Admin.value')
            || doc.get('attachment.Subscriber.value');

          // Cancelling admin to remove their custom claims.
          // Cancelling subscription to stop them from
          // creating new activities with that subscription
          if (new Set()
            .add('admin')
            .add('subscription')
            .has(template)
            && phoneNumber === phoneNumberInAttachment) {
            batch.set(rootCollections.activities.doc(doc.id), {
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

const createDefaultSubscriptionsForEmployee = (locals, hasBeenCancelled) => {
  const hasBeenCreated = locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;

  if (hasBeenCancelled || !hasBeenCreated) {
    return Promise.resolve();
  }

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

  const getAuth = phoneNumber => {
    return auth.getUserByPhoneNumber(phoneNumber)
      .catch(() => {
        return ({ phoneNumber });
      });
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
  const template = locals.change.after.get('template');

  if (template !== 'employee') {
    return;
  }

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
    employeeOf[office] = deleteField();
  }

  let profileData = {
    employeeOf,
  };

  if (hasBeenCreated) {
    profileData
      .lastLocationMapUpdateTimestamp = Date.now();
  }

  // Phone number changed
  if (oldEmployeeContact
    && oldEmployeeContact !== newEmployeeContact) {
    batch.set(rootCollections.profiles.doc(oldEmployeeContact), {
      employeeOf: {
        [office]: deleteField(),
      },
    }, {
        merge: true,
      });

    const path = `${officeId}/employee/${oldEmployeeContact}`;
    const ref = admin.database().ref(path);

    await new Promise((resolve, reject) => {
      ref.remove(error => {
        if (error) reject(error);

        resolve();
      });
    });

    const profileDoc = await rootCollections.profiles.doc(oldEmployeeContact).get();
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

      removeFromOffice.push(office);

      batch.set(updatesDoc.ref, {
        removeFromOffice,
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

  try {
    await batch.commit();
    await addEmployeeToRealtimeDb(locals.change.after);

    if (hasBeenCancelled) {
      await removeFromOfficeActivities(locals);
    }

    // Move this to `profileOnWrite`
    await sendEmployeeCreationSms(locals);
    await createDefaultSubscriptionsForEmployee(locals, hasBeenCancelled);
    await handleEmployeeSupervisors(locals);

    return handleStatusDocs(locals);
  } catch (error) {
    console.error(error);
  }
};

const createFootprintsRecipient = async locals => {
  const template = locals.change.after.get('template');

  if (template !== 'office') return;

  const activityRef = rootCollections.activities.doc();
  const officeId = locals.change.after.id;
  const addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .doc();
  const batch = db.batch();

  try {
    const recipientQuery = await rootCollections
      .activityTemplates
      .where('name', '==', 'recipient')
      .get();

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

    batch.set(activityRef, activityData);
    batch.set(addendumDocRef, addendumDocData);

    return batch.commit();
  } catch (error) {
    console.error(error);
  }
};

const replaceInvalidCharsInOfficeName = office => {
  let result = office.toLowerCase();
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
    if (!result.endsWith(`.${tld}`)) return;

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

const getPlaceName = (placeid) => {
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
        const openingHours = result.json.result['opening_hours'];

        if (!openingHours) return '';

        const periods = openingHours.periods;

        const relevantObject = periods.filter(item => {
          return item.close && item.close.day === 1;
        });

        if (!relevantObject[0]) return '';

        return relevantObject[0].open.time;
      })();

      const weekdayEndTime = (() => {
        const openingHours = result.json.result['opening_hours'];

        if (!openingHours) return '';

        const periods = openingHours.periods;

        const relevantObject = periods.filter(item => {
          return item.close && item.close.day === 1;
        });

        if (!relevantObject[0]) return '';

        return relevantObject[0].close.time;
      })();

      const saturdayStartTime = (() => {
        const openingHours = result.json.result['opening_hours'];

        if (!openingHours) return '';

        const periods = openingHours.periods;

        const relevantObject = periods.filter(item => {
          return item.open && item.open.day === 6;
        });

        if (!relevantObject[0]) return '';

        return relevantObject[0].open.time;
      })();

      const saturdayEndTime = (() => {
        const openingHours = result.json.result['opening_hours'];

        if (!openingHours) return '';

        const periods = openingHours.periods;

        const relevantObject = periods.filter(item => {
          return item.open && item.open.day === 6;
        });

        if (!relevantObject[0]) return '';

        return relevantObject[0].close.time;
      })();

      const weeklyOff = (() => {
        const openingHours = result.json.result['opening_hours'];

        if (!openingHours) return '';

        const weekdayText = openingHours['weekday_text'];

        if (!weekdayText) return '';

        const closedWeekday = weekdayText
          // ['Sunday: Closed']
          .filter(str => str.includes('Closed'))[0];

        if (!closedWeekday) return '';

        const parts = closedWeekday.split(':');

        if (!parts[0]) return '';

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
  const officeId = locals.change.after.id;
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
    timezone: locals.change.after.get('attachment.Timezone.value'),
    timestamp: Date.now(),
    office: locals.change.after.get('office'),
    activityName: activityName({
      attachmentObject: branchData.attachment,
      templateName: 'branch',
      requester: locals.change.after.get('creator'),
    }),
    adjustedGeopoints: `${gp.latitude},${gp.longitude}`,
  };

  const addendumDocData = {
    activityData,
    timezone: locals.change.after.get('attachment.Timezone.value'),
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

  locals.assigneePhoneNumbersArray.forEach(phoneNumber => {
    batch.set(activityRef.collection('Assignees').doc(phoneNumber), {
      canEdit: true,
      addToInclude: false,
    });
  });

  batch.set(activityRef, activityData);
  batch.set(addendumDocRef, addendumDocData);

  return batch.commit();
};

const createBranches = (locals) => {
  const template = locals.change.after.get('template');
  const hasBeenCreated = locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;

  if (template !== 'office' || !hasBeenCreated) {
    return Promise.resolve();
  }

  let failureCount = 0;

  const getBranchBodies = (office) => {
    return getPlaceIds(office)
      .then(ids => {
        const promises = [];

        if (ids.length === 0) {
          failureCount++;

          if (failureCount > 1) {
            // Has failed once with the actual office name
            // and 2nd time even by replacing invalid chars
            // Give up.

            return Promise.all(promises);
          }

          const filteredOfficeName = replaceInvalidCharsInOfficeName(office);

          return getBranchBodies(filteredOfficeName);
        }

        ids.forEach(id => {
          promises.push(getPlaceName(id));
        });

        return Promise.all(promises);
      })
      .catch(console.error);
  };

  const office = locals.change.after.get('office');

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
      const [branches, templateQuery] = result;
      const templateDoc = templateQuery.docs[0];
      const promises = [];

      branches.forEach(branch => {
        promises.push(createAutoBranch(branch, locals, templateDoc));
      });

      return Promise.all(promises);
    })
    .catch(console.error);
};

const mangeYouTubeDataApi = async locals => {
  const template = locals.change.after.get('template');

  if (template !== 'office') {
    return Promise.resolve();
  }

  if (!env.isProduction) {
    return Promise.resolve();
  }

  const youtube = google.youtube('v3');

  const auth = await google.auth.getClient({
    credentials: require('../../admin/cert.json'),
    scopes: [
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/youtube'
    ],
  });

  const id = locals.change.after.get('attachment.Youtube ID.value');

  if (!id) {
    return Promise.resolve();
  }

  const oldTitle = locals.change.before.get('office');
  const newTitle = locals.change.after.get('office');
  const oldDescription = locals.change.before.get('attachment.Description.value');
  const newDescription = locals.change.after.get('attachment.Description.value');

  if (oldTitle === newTitle
    && oldDescription === newDescription) {
    return Promise.resolve();
  }

  const opt = {
    auth,
    part: 'snippet',
    requestBody: {
      id,
      snippet: {
        categoryId: 22, // People & Blogs
        title: newTitle,
        description: newDescription,
      },
    },
  };


  try {
    return youtube.videos.update(opt);
  } catch (error) {
    console.error(error);
  }
};

const handleOffice = (locals) => {
  const template = locals.change.after.get('template');
  const hasBeenCreated = locals.addendumDoc
    && locals.addendumDoc.get('action') === httpsActions.create;

  if (template !== 'office' || !hasBeenCreated) {
    return Promise.resolve();
  }

  const firstContact = locals.change.after.get('attachment.First Contact.value');
  const secondContact = locals.change.after.get('attachment.Second Contact.value');

  return createFootprintsRecipient(locals)
    .then(() => createAutoSubscription(locals, 'subscription', firstContact))
    .then(() => createAutoSubscription(locals, 'subscription', secondContact))
    .then(() => createAdmin(locals, firstContact))
    .then(() => createAdmin(locals, secondContact))
    .then(() => createBranches(locals))
    .then(() => mangeYouTubeDataApi(locals));
};

const setLocationsReadEvent = async locals => {
  const officeId = locals.change.after.get('officeId');
  const timestamp = Date.now();

  if (locals.change.after.get('status') === 'CANCELLED') {
    return Promise.resolve();
  }

  try {
    const phoneNumbersArray = await getUsersWithCheckIn(officeId);
    let docsCounter = 0;
    let numberOfDocs = phoneNumbersArray.length;
    const numberOfBatches = Math.round(Math.ceil(numberOfDocs / 500));
    const batchArray = Array.from(Array(numberOfBatches)).map(() => db.batch());
    let batchIndex = 0;

    phoneNumbersArray.forEach(phoneNumber => {
      docsCounter++;

      if (docsCounter > 499) {
        docsCounter = 0;
        batchIndex++;
      }

      batchArray[batchIndex].set(rootCollections
        .profiles
        .doc(phoneNumber), {
          lastLocationMapUpdateTimestamp: timestamp,
        }, {
          merge: true,
        });
    });

    const commitBatch = async batch => {
      return process.nextTick(() => batch.commit());
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
  const template = locals.change.after.get('template');
  const templatesSet = new Set(['branch', 'customer']);

  if (!templatesSet.has(template)) {
    return Promise.resolve();
  }

  const setData = (ref, data) => {
    return new Promise(resolve => ref.set(data, resolve));
  };

  const removeData = ref => {
    return new Promise((resolve, reject) => {
      ref.remove(error => {
        if (error) {
          reject(error);
        }

        resolve();
      });
    });
  };

  const realtimeDb = require('firebase-admin').database();
  const officeId = locals.change.after.get('officeId');
  const path = `${officeId}/locations/${locals.change.after.id}`;
  const ref = realtimeDb.ref(path);

  if (locals.change.after.get('status') === 'CANCELLED') {
    return Promise
      .all([
        removeData(ref),
        setLocationsReadEvent(locals),
      ]);
  }

  const venue = locals.change.after.get('venue');

  if (!venue) return;
  if (!venue[0]) return;
  if (!venue[0].location) return;

  const oldVenue = locals.change.before.get('venue');
  const newVenue = locals.change.after.get('venue');

  if (oldVenue && newVenue) {
    const updateVenueDescriptors = getUpdatedVenueDescriptors(newVenue, oldVenue);

    if (!updateVenueDescriptors.length) {
      return Promise.resolve();
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
      setData(ref, data),
      setLocationsReadEvent(locals)
    ]);
};

const handleBranch = async locals => {
  const template = locals.change.after.get('branch');

  if (template !== 'branch') return;

  const office = locals.change.after.get('office');
  const oldSchedule = locals.change.before.get('schedule') || [];
  const newSchedule = locals.change.after.get('schedule') || [];

  const venueUpdated = newSchedule
    .filter((val, index) => {
      return oldSchedule[index]
        && oldSchedule[index].startTime !== val.startTime;
    });

  if (venueUpdated.length === 0) return;

  try {
    const employees = await rootCollections
      .activities
      .where('template', '==', 'employee')
      .where('status', '==', 'CONFIRMED')
      .where('office', '==', office)
      .get();

    const promises = [];

    employees.forEach(employee => {
      promises.push(addEmployeeToRealtimeDb(employee));
    });

    return Promise.all(promises);
  } catch (error) {
    console.error(error);
  }
};


module.exports = (change, context) => {
  /** Activity was deleted. For debugging only. */
  if (!change.after.data()) {
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
          .map(doc => doc.get('attachment.Admin.value'))
      );

      if (addendumDoc) {
        locals.addendumDoc = addendumDoc;
      }

      const authFetch = [];

      assigneesSnapShot.forEach(doc => {
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
    .then(userRecords => {
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

        // /** New user introduced to the system. Saving their phone number. */
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
            .assigneePhoneNumbersArray.forEach(phoneNumber => {
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

          const name = activityData.attachment.Name.value;

          activityData.slug = slugify(name);

          return officeRef;
        }

        const office = activityData.office;

        activityData.slug = slugify(office);

        return officeRef.collection('Activities').doc(change.after.id);
      })();

      batch.set(copyTo, activityData, { merge: true });

      return batch.commit();
    })
    .then(() => handleSubscription(locals))
    .then(() => handleRecipient(locals))
    .then(() => handleBranch(locals))
    .then(() => handleAdmin(locals))
    .then(() => handleEmployee(locals))
    .then(() => handleOffice(locals))
    .then(() => handleLocations(locals))
    .catch(error => {
      console.error({
        error,
        context,
        activityId: change.after.id,
      });
    });
};
