'use strict';

const {
  db,
  rootCollections,
  getGeopointObject,
} = require('../../admin/admin');
const env = require('../../admin/env');
const {
  sendJSON,
  handleError,
  isValidDate,
  isHHMMFormat,
  sendResponse,
  isValidEmail,
  isEmptyObject,
  isValidGeopoint,
  adjustedGeopoint,
  isNonEmptyString,
  isE164PhoneNumber,
  addressToCustomer,
  getBranchName,
  getEmployeesMapFromRealtimeDb,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const {
  forSalesReport,
} = require('../activity/helper');
const {
  weekdays,
  validTypes,
  httpsActions,
  timezonesSet,
} = require('../../admin/constants');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const admin = require('firebase-admin');
const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: env.mapsApiKey,
      Promise: Promise,
    });

const getVenueFieldsSet = templateDoc => {
  if (!templateDoc.get('venue').length > 0) {
    return new Set();
  }

  return new Set()
    .add('venueDescriptor')
    .add('location')
    .add('address')
    .add('latitude')
    .add('longitude');
};

const templateNamesObject = {
  ADMIN: 'admin',
  SUBSCRIPTION: 'subscription',
  EMPLOYEE: 'employee',
  OFFICE: 'office',
  RECIPIENT: 'recipient',
};

const handleValidation = (body) => {
  const result = {
    success: true,
    message: null
  };
  const messageString = (field) =>
    `Invalid/Missing field '${field}' found in the request body`;

  /** Field 'office' can be skipped. */
  if (body.template !== templateNamesObject.OFFICE &&
    !isNonEmptyString(body.office)) {
    return {
      success: false,
      message: messageString('office'),
    };
  }

  if (!isNonEmptyString(body.template) ||
    !body.hasOwnProperty('template')) {
    return {
      success: false,
      message: messageString('template'),
    };
  }

  if (!isValidDate(body.timestamp) ||
    !body.hasOwnProperty('timestamp')) {
    return {
      success: false,
      message: messageString('timestamp'),
    };
  }

  if (!isValidGeopoint(body.geopoint, false) ||
    !body.hasOwnProperty('geopoint')) {
    return {
      success: false,
      message: messageString('geopoint'),
    };
  }

  if (!Array.isArray(body.data) ||
    !body.hasOwnProperty('data')) {
    return {
      success: false,
      message: messageString('data'),
    };
  }

  if (body.data.length === 0) {
    return {
      success: false,
      message: `Invalid/empty excel file`,
    };
  }

  for (let iter = 0; iter < body.data.length; iter++) {
    const item = body.data[iter];

    if (!item) {
      return {
        success: false,
        message: `Expected an array of objects in the field 'data'`,
      };
    }

    const shareArray = item.share || [];

    for (let index = 0; index < shareArray.length; index++) {
      const phoneNumber = shareArray[index];

      if (isE164PhoneNumber(phoneNumber)) {
        // return;
        continue;
      }

      return {
        success: false,
        message: `Invalid phoneNumber '${phoneNumber}'` +
          ` in data object at index: ${iter}`,
      };
    }

    if (Object.prototype.toString.call(item) === '[object Object]') {
      continue;
    }

    return {
      success: false,
      message: `In field 'data', object at position: ${iter} is invalid`,
    };
  }

  return result;
};

const getActivityName = params => {
  const {
    template,
    subscriber,
    admin,
    name,
    number,
    displayName,
    phoneNumber,
  } = params;

  let result = `${template.toUpperCase()}: `;

  if (name) {
    result += `${name}`;
  } else if (number) {
    result += `${number}`;
  } else if (template === templateNamesObject.ADMIN) {
    result += `${admin}`;
  } else if (template === templateNamesObject.SUBSCRIPTION) {
    result += `${subscriber}`;
  } else {
    result += `${displayName || phoneNumber}`;
  }

  if (template === templateNamesObject.RECIPIENT) {
    result += ` report`;
  }

  return result;
};

const getCanEditValue = (locals, phoneNumber, requestersPhoneNumber) => {
  const canEditRule = locals.templateDoc.get('canEditRule');

  if (canEditRule === 'NONE') return false;
  if (canEditRule === 'ADMIN') return locals.adminsSet.has(phoneNumber);
  if (canEditRule === 'EMPLOYEE') return locals.employeesSet.has(phoneNumber);
  if (canEditRule === 'CREATOR') return phoneNumber === requestersPhoneNumber;

  // for `ALL`
  return true;
};

const executeSequentially = (batchFactories) => {
  let result = Promise.resolve();

  batchFactories.forEach((promiseFactory, index) => {
    result = result
      .then(promiseFactory)
      .then(() => console.log(
        `Commited ${index + 1} of ${batchFactories.length}`
      ));
  });

  return result;
};

const commitData = (batchesArray, batchFactories) => {
  // For a single batch, no need to create batch factories
  if (batchesArray.length === 1) {
    return batchesArray[0].commit();
  }

  return executeSequentially(batchFactories);
};

const createObjects = (conn, locals, trialRun) => {
  let totalDocsCreated = 0;
  let currentBatchIndex = 0;
  let batchDocsCount = 0;
  const batchFactories = [];
  const batchesArray = [];
  const timestamp = Date.now();
  const childActivitiesBatch = db.batch();
  const isOfficeTemplate = conn.req.body.template === templateNamesObject.OFFICE;
  const attachmentFieldsSet = new Set(Object.keys(locals.templateDoc.get('attachment')));
  const scheduleFieldsSet = new Set(locals.templateDoc.get('schedule'));
  const venueFieldsSet = getVenueFieldsSet(locals.templateDoc)
    .add('placeId');

  conn.req.body.data.forEach((item, index) => {
    if (item.rejected) {

      return;
    }

    const batch = (() => {
      const batchPart = db.batch();

      if (batchesArray.length === 0) {
        batchesArray.push(batchPart);
      }

      if (batchDocsCount > 450) {
        // reset count
        batchDocsCount = 0;
        batchesArray.push(batchPart);

        currentBatchIndex++;
        batchFactories.push(() => batchPart.commit());
      }

      return batchesArray[currentBatchIndex];
    })();

    const activityRef = rootCollections.activities.doc();
    const officeRef = (() => {
      if (conn.req.body.template === templateNamesObject.OFFICE) {
        return rootCollections.offices.doc(activityRef.id);
      }

      return locals.officeDoc.ref;
    })();
    const addendumDocRef = officeRef.collection('Addendum').doc();
    const params = {
      subscriber: item.Subscriber,
      admin: item.Admin,
      name: item.Name,
      number: item.Number,
      template: conn.req.body.template,
      displayName: conn.requester.displayName,
      phoneNumber: conn.requester.phoneNumber,
    };
    const officeId = (() => {
      if (isOfficeTemplate) {
        return officeRef.id;
      }

      return locals.officeDoc.id;
    })();
    const office = (() => {
      if (isOfficeTemplate) {
        return conn.req.body.data[index].Name;
      }

      return locals.officeDoc.get('attachment.Name.value');
    })();
    const timezone = (() => {
      if (conn.req.body.template === templateNamesObject.OFFICE) {
        return conn.req.body.data[index].Timezone;
      }

      return locals.officeDoc.get('attachment.Timezone.value');
    })();

    const activityObject = {
      office,
      timezone,
      officeId,
      timestamp,
      addendumDocRef,
      schedule: [],
      venue: [],
      attachment: {},
      canEditRule: locals.templateDoc.get('canEditRule'),
      creator: {
        phoneNumber: conn.requester.phoneNumber,
        displayName: conn.requester.displayName,
        photoURL: conn.requester.photoURL,
      },
      hidden: locals.templateDoc.get('hidden'),
      status: locals.templateDoc.get('statusOnCreate'),
      template: locals.templateDoc.get('name'),
      activityName: getActivityName(params),
      createTimestamp: Date.now(),
      forSalesReport: forSalesReport(locals.templateDoc.get('name')),
    };

    const objectFields = Object.keys(item);
    let scheduleCount = 0;

    objectFields.forEach(field => {
      const value = item[field];
      const isFromAttachment = attachmentFieldsSet.has(field);
      const isFromSchedule = scheduleFieldsSet.has(field);
      const isFromVenue = venueFieldsSet.has(field);

      if (isFromAttachment) {
        activityObject.attachment[field] = {
          value,
          type: locals.templateDoc.get(`attachment.${field}.type`),
        };

        return;
      }

      if (isFromSchedule) {
        activityObject.schedule.push({
          startTime: value,
          endTime: value,
          name: locals.templateDoc.get('schedule')[scheduleCount],
        });

        scheduleCount++;

        return;
      }

      if (isFromVenue) {
        activityObject.venue[0] = activityObject.venue[0] || {
          venueDescriptor: locals.templateDoc.get('venue')[0],
          geopoint: {},
        };

        if (field === 'placeId') {
          activityObject.venue[0].placeId = value;
        }

        if (field === 'location') {
          activityObject.venue[0].location = value;
        }

        if (field === 'latitude') {
          activityObject.venue[0].geopoint.latitude = value;
        }

        if (field === 'longitude') {
          activityObject.venue[0].geopoint.longitude = value;
        }

        if (field === 'address') {
          activityObject.venue[0].address = value;
        }
      }
    });

    if (activityObject.venue[0] &&
      activityObject.venue[0].geopoint.latitude &&
      activityObject.venue[0].geopoint.longitude) {
      activityObject.venue[0].geopoint = new admin.firestore.GeoPoint(
        activityObject.venue[0].geopoint.latitude,
        activityObject.venue[0].geopoint.longitude
      );

      const adjusted = adjustedGeopoint(activityObject.venue[0].geopoint);

      activityObject
        .adjustedGeopoints = `${adjusted.latitude},${adjusted.longitude}`;
    }

    const addendumObject = {
      timestamp,
      activityData: activityObject,
      user: conn.requester.phoneNumber,
      userDisplayName: conn.requester.displayName,
      action: httpsActions.create,
      template: conn.req.body.template,
      location: getGeopointObject(conn.req.body.geopoint),
      userDeviceTimestamp: conn.req.body.timestamp,
      activityId: activityRef.id,
      activityName: activityObject.activityName,
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      provider: conn.req.body.geopoint.provider || null,
      isSupportRequest: locals.isSupportRequest,
      isAdminRequest: locals.isAdminRequest,
    };

    // Not all templates will have type phoneNumber in attachment.
    if (locals.assigneesFromAttachment.has(index)) {
      locals
        .assigneesFromAttachment
        .get(index)
        .forEach(phoneNumber => {
          conn.req.body.data[index].share.push(phoneNumber);
        });
    }

    conn
      .req
      .body
      .data[index]
      .share
      .forEach(phoneNumber => {
        const ref = activityRef
          .collection('Assignees')
          .doc(phoneNumber.trim());
        const addToInclude = conn.req.body.template === templateNamesObject.SUBSCRIPTION &&
          phoneNumber !== activityObject.attachment.Subscriber.value;

        const canEdit = getCanEditValue(
          locals,
          phoneNumber,
          conn.requester.phoneNumber
        );

        batch.set(ref, {
          canEdit,
          addToInclude,
        });
      });

    // 1 activity doc, and 2 addendum object
    batch.set(activityRef, activityObject);
    batch.set(addendumDocRef, addendumObject);

    // One doc for activity
    // Second for addendum
    totalDocsCreated += 2;
    batchDocsCount += 2;
    batchDocsCount += conn.req.body.data[index].share.length;
    totalDocsCreated += conn.req.body.data[index].share.length;
  });

  const responseObject = {
    totalDocsCreated,
    numberOfBatches: batchFactories.length,
    data: conn.req.body.data,
  };

  /** For testing out code */
  if (trialRun) {
    return Promise.resolve(responseObject);
  }

  return commitData(batchesArray, batchFactories)
    .then(() => childActivitiesBatch.commit())
    .then(() => responseObject);
};

const fetchDataForCanEditRule = (conn, locals) => {
  const rule = locals.templateDoc.get('canEditRule');

  if (rule !== 'ADMIN' &&
    rule !== 'EMPLOYEE') {
    return Promise.resolve();
  }

  /** Office's canEditRule is `NONE`. No handling required here */
  return rootCollections
    .activities
    .where('template', '==', rule.toLowerCase())
    .where('status', '==', 'CONFIRMED')
    .where('office', '==', conn.req.body.office)
    .get()
    .then(docs => {
      const set = new Set();

      docs.forEach(doc => {
        const phoneNumber =
          doc.get('attachment.Employee Contact.value') ||
          doc.get('attachment.Admin.value');

        set.add(phoneNumber);
      });

      return Promise.resolve();
    });
};

const handleEmployees = (conn, locals) => {
  const promises = [];

  if (conn.req.body.template !== templateNamesObject.EMPLOYEE) {
    return Promise.resolve();
  }

  locals
    .employeesToCheck
    .forEach(item => {
      const promise = rootCollections
        .activities
        .where('office', '==', conn.req.body.office)
        .where('template', '==', templateNamesObject.EMPLOYEE)
        .where('attachment.Employee Contact.value', '==', item.phoneNumber)
        .where('attachment.Name.value', '==', item.name)
        // The `statusOnCreate` is most probably `CONFIRMED` in most cases.
        .where('status', '==', locals.templateDoc.get('statusOnCreate'))
        .limit(1)
        .get();

      promises.push(promise);
    });

  const phoneNumbersToRejectSet = new Set();

  return Promise
    .all([
      getEmployeesMapFromRealtimeDb(locals.officeDoc.id),
      Promise
        .all(promises)
    ])
    .then(result => {
      const [employeesData, snapShots] = result;

      snapShots.forEach(snapShot => {
        if (snapShot.empty) return;

        /** Doc exists, employee already exists */
        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('attachment.Employee Contact.value');
        phoneNumbersToRejectSet.add(phoneNumber);
      });

      conn.req.body.data.forEach((item, index) => {
        const phoneNumber = item['Employee Contact'];

        if (phoneNumbersToRejectSet.has(phoneNumber)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Phone number`
            + ` ${phoneNumber} is already an employee`;

          return;
        }

        if (employeesData[phoneNumber]) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Phone number: ${phoneNumber} is already` +
            ` in use by ${employeesData[phoneNumber].Name}`;
        }
      });

      return Promise.resolve();
    });
};

const handleUniqueness = (conn, locals) => {
  const hasName = locals
    .templateDoc
    .get('attachment')
    .hasOwnProperty('Name');
  const hasNumber = locals
    .templateDoc
    .get('attachment')
    .hasOwnProperty('Number');

  if (!hasName && !hasNumber) {
    return Promise.resolve();
  }

  const promises = [];
  let index = 0;
  const indexMap = new Map();
  const baseQuery = (() => {
    if (conn.req.body.template === templateNamesObject.OFFICE) {
      return rootCollections.offices;
    }

    return rootCollections
      .activities
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', conn.req.body.template)
      .where('office', '==', conn.req.body.office);
  })();

  const param = (() => {
    if (hasNumber) {
      return 'Number';
    }

    return 'Name';
  })();

  conn.req.body.data.forEach(item => {
    // Not querying anything for already rejected objects
    if (item.rejected) return;

    indexMap.set(item.Name || item.Number, index);
    index++;

    const promise = baseQuery
      .where(`attachment.${param}.value`, '==', item.Name || item.Number)
      .limit(1)
      .get();

    promises.push(promise);
  });

  return Promise
    .all(promises)
    .then(snapShots => {
      snapShots.forEach(snapShot => {
        // Empty means that the person with the name/number doesn't exist.
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const nameOrNumber = doc.get('attachment.Name.value')
          || doc.get('attachment.Number.value');
        const index = indexMap.get(nameOrNumber);
        const value = conn.req.body.data[index].Name
          || conn.req.body.data[index].Number;

        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason =
          `${param} '${value}' is already in use`;

        if (conn.req.body.template === 'office') {
          conn.req.body.data[index].reason =
            `Office: '${value} already exists'`;
        }
      });

      return Promise.resolve();
    });
};

const handleSubscriptions = (conn, locals) => {
  if (conn.req.body.template !== templateNamesObject.SUBSCRIPTION) {
    return Promise.resolve();
  }

  const promises = [];

  locals
    .subscriptionsToCheck
    .forEach(item => {
      const {
        phoneNumber,
        template,
      } = item;

      const promise = rootCollections
        .activities
        .where('office', '==', conn.req.body.office)
        .where('status', '==', 'CONFIRMED')
        .where('template', '==', templateNamesObject.SUBSCRIPTION)
        .where('attachment.Subscriber.value', '==', phoneNumber)
        .where('attachment.Template.value', '==', template)
        .limit(1)
        .get();

      promises.push(promise);
    });

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        if (snapShot.empty) return;
        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('attachment.Subscriber.value');
        const template = doc.get('attachment.Template.value');

        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason =
          `${phoneNumber} already has subscription of '${template}'`;
      });

      return Promise.resolve();
    });
};

const handleAdmins = (conn, locals) => {
  const promises = [];

  if (conn.req.body.template !== templateNamesObject.ADMIN) {
    return Promise.resolve();
  }

  locals
    .adminToCheck
    .forEach((phoneNumber) => {
      promises
        .push(
          rootCollections
            .activities
            .where('office', '==', conn.req.body.office)
            .where('template', '==', templateNamesObject.ADMIN)
            .where('attachment.Admin.value', '==', phoneNumber)
            .where('status', '==', 'CONFIRMED')
            .limit(1)
            .get()
        );
    });
  const adminsToReject = new Set();

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        if (snapShot.empty) return;

        const phoneNumber = locals.adminToCheck[index];

        adminsToReject.add(phoneNumber);
      });

      conn.req.body.data.forEach((object, index) => {
        const phoneNumber = object.Admin;

        if (!phoneNumber) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason =
            `Invalid value '${phoneNumber || 'empty'}' for Admin phone number`;
        }

        if (adminsToReject.has(phoneNumber)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason =
            `${phoneNumber} is already an Admin`;
        }
      });

      return Promise.resolve();
    });
};

const fetchValidTypes = (conn, locals) => {
  if (conn.req.body.template === 'office') {
    return Promise.resolve();
  }

  const promises = [];
  const nonExistingValuesSet = new Set();
  const queryMap = new Map();

  locals
    .verifyValidTypes
    .forEach((item, index) => {
      const {
        value,
        type,
      } = item;

      queryMap.set(index, value);

      const promise = rootCollections
        .activities
        .where('office', '==', conn.req.body.office)
        .where('template', '==', type)
        .where(`attachment.Name.value`, '==', value)
        .where('status', '==', 'CONFIRMED')
        .limit(1)
        .get();

      promises.push(promise);
    });

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        // doc should exist
        if (!snapShot.empty) {
          /** Doc exists, so creation is allowed */
          return;
        }

        const nonExistingValue = queryMap.get(index);

        nonExistingValuesSet.add(nonExistingValue);
      });

      conn
        .req
        .body
        .data
        .forEach((object, index) => {
          const fields = Object.keys(object);

          fields.forEach((field) => {
            const value = object[field];

            if (nonExistingValuesSet.has(value)) {
              conn.req.body.data[index].rejected = true;
              conn.req.body.data[index].reason =
                `${field} ${value} doesn't exist`;
            }
          });
        });

      return Promise.resolve();
    });
};

const validateDataArray = (conn, locals) => {
  const scheduleFields = locals.templateDoc.get('schedule');
  const venueFields = getVenueFieldsSet(locals.templateDoc);
  const attachmentFieldsSet = new Set(
    Object.keys(locals.templateDoc.get('attachment'))
  );
  const scheduleFieldsSet = new Set(scheduleFields);
  const allFieldsArray = [
    ...attachmentFieldsSet,
    ...scheduleFields,
    ...venueFields,
  ];

  /**
   * Set for managing uniques from the request body.
   * If any duplicate is found rejecting all data.
   */
  const duplicatesSet = new Set();
  const subscriptionsMap = new Map();
  const namesToCheck = [];
  const employeesToCheck = [];
  const adminsSet = new Set();
  const adminToCheck = [];
  const verifyValidTypes = new Map();
  const subscriptionsToCheck = [];
  const assigneesFromAttachment = new Map();
  const officeContacts = new Map();
  const uniqueMap = new Map();

  conn.req.body.data.forEach((dataObject, index) => {
    const uniqueValue = (() => {
      if (conn.req.body.template === 'employee') {
        return dataObject['Employee Contact'];
      }

      if (conn.req.body.template === 'admin') {
        return dataObject.Admin;
      }

      /**
       * For template subscription, the combination of Subscriber
       * and Template is unique
       */
      if (conn.req.body.template === 'subscription') {
        return `${dataObject.Subscriber}-${dataObject.Template}`;
      }

      return dataObject.Name || dataObject.Number;
    })();

    if (uniqueValue) {
      const indexSet = uniqueMap.get(uniqueValue) || new Set();
      indexSet.add(index);
      uniqueMap.set(uniqueValue, indexSet);
    }

    const objectProperties = Object.keys(dataObject);
    /**
     * TODO: This is O(n * m * q) loop most probably. Don't have
     * much time to fully optimize this properly.
     * Will do it later...
     */
    allFieldsArray.forEach(field => {
      /**
       * Convert fields with type 'number' to an actual number
       * if value has been provided
       */
      if (attachmentFieldsSet.has(field) &&
        locals.templateDoc.get('attachment')[field].type === 'number' &&
        conn.req.body.data[index][field]) {
        conn.req.body.data[index][field] = Number(
          conn.req.body.data[index][field]
        );
      }

      if (!objectProperties.includes(field)) {
        conn.req.body.data[index][field] = '';

        return;
      }

      if (locals.templateDoc.get('venue').length > 0) {
        const msg = `All location fields are required`;
        const allVenueFields = [
          conn.req.body.data[index].latitude,
          conn.req.body.data[index].longitude,
          conn.req.body.data[index].address,
          conn.req.body.data[index].location
        ];

        if ((conn.req.body.data[index].latitude
          || conn.req.body.data[index].longitude
          || conn.req.body.data[index].address
          || conn.req.body.data[index].location)
          && allVenueFields.filter(Boolean).length !== allVenueFields.length) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = msg + '...';
        }

        if (conn.req.body.data[index].latitude &&
          conn.req.body.data[index].longitude &&
          !isValidGeopoint({
            latitude: conn.req.body.data[index].latitude,
            longitude: conn.req.body.data[index].longitude,
          }, false)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = msg;
        }
      }

      if (locals.templateDoc.get('attachment').hasOwnProperty('Name') &&
        !conn.req.body.data[index].rejected &&
        !isNonEmptyString(conn.req.body.data[index].Name)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Missing the field 'Name'`;
      }

      if (locals.templateDoc.get('attachment').hasOwnProperty('Number') &&
        !conn.req.body.data[index].rejected &&
        typeof conn.req.body.data[index].Number !== 'number') {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Missing the field 'Number'`;
      }
    });

    if (conn.req.body.template !==
      templateNamesObject.OFFICE) {
      const firstContact = locals.officeDoc.get('attachment.First Contact.value');
      const secondContact = locals.officeDoc.get('attachment.Second Contact.value');

      if (firstContact) {
        conn.req.body.data[index].share.push(firstContact);
      }

      if (secondContact) {
        conn.req.body.data[index].share.push(secondContact);
      }
    }

    if (conn.req.body.template === templateNamesObject.RECIPIENT) {
      const templateName = conn.req.body.data[index].Name;

      const validReports = new Set(['footprints', 'payroll']);

      if (!validReports.has(templateName)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `${templateName} is not a valid report`;
      }
    }

    if (conn.req.body.template ===
      templateNamesObject.OFFICE) {
      const firstContact = conn.req.body.data[index]['First Contact'];
      const secondContact = conn.req.body.data[index]['Second Contact'];
      const timezone = conn.req.body.data[index].Timezone;

      if (firstContact ===
        secondContact) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason =
          `Both contacts cannot be the same or empty`;
      }

      if (!firstContact &&
        !secondContact) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `At least one contact is required`;
      }

      if (!timezone ||
        !timezonesSet.has(timezone)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Invalid/Missing timezone`;
      }

      const contacts = [];

      if (firstContact) contacts.push(firstContact);
      if (secondContact) contacts.push(secondContact);

      officeContacts.set(index, contacts);
    }

    if (conn.req.body.template ===
      templateNamesObject.SUBSCRIPTION) {
      const phoneNumber = conn.req.body.data[index].Subscriber;
      const template = conn.req.body.data[index].Template;

      if (!phoneNumber) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Invalid Subscriber`;
      }

      if (!template) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Invalid template`;
      }

      /** Subscription of template office and subscription
       * is not allowed for everyone
       */
      if (template === 'office' ||
        template === templateNamesObject.SUBSCRIPTION) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason =
          `Subscription of template: '${template}' is not allowed`;
      }

      if (!locals.templateNamesSet.has(template)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason =
          `Template: '${template} does not exist'`;
      }

      if (subscriptionsMap.has(phoneNumber)) {
        const set = subscriptionsMap.get(phoneNumber);

        set.add(template);

        subscriptionsMap.set(phoneNumber, set);
      } else {
        subscriptionsMap.set(phoneNumber, new Set().add(template));
      }

      subscriptionsToCheck
        .push({
          phoneNumber: conn.req.body.data[index].Subscriber,
          template: conn.req.body.data[index].Template,
        });
    }

    if (conn.req.body.template ===
      templateNamesObject.ADMIN) {
      const phoneNumber = conn.req.body.data[index].Admin;

      adminsSet.add(phoneNumber);
      adminToCheck.push(phoneNumber);
    }

    if (conn.req.body.template ===
      templateNamesObject.EMPLOYEE) {
      const firstSupervisor = conn.req.body.data[index]['First Supervisor'];
      const secondSupervisor = conn.req.body.data[index]['Second Supervisor'];
      const thirdSupervisor = conn.req.body.data[index]['Third Supervisor'];

      if (!firstSupervisor &&
        !secondSupervisor &&
        !thirdSupervisor) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Please add at least one supervisor`;
      }
    }

    objectProperties.forEach(property => {
      const value = dataObject[property];

      if (value &&
        scheduleFieldsSet.has(property) &&
        !isValidDate(value)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `The field ${property}` +
          ` should be a valid unix timestamp`;

        return;
      }

      if (attachmentFieldsSet.has(property)) {
        const type = locals.templateDoc.get('attachment')[property].type;

        if (!validTypes.has(type) && value) {
          // Used for querying activities which should exist on the
          // basis of name
          verifyValidTypes.set(index, {
            value,
            type,
            field: property
          });
        }

        if (conn.req.body.template === templateNamesObject.EMPLOYEE &&
          property === 'Employee Contact' &&
          !isE164PhoneNumber(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Employee ${property}` +
            ` should be a valid phone number`;

          return;
        }

        if (value &&
          type === 'phoneNumber') {
          if (assigneesFromAttachment.has(index)) {
            const set = assigneesFromAttachment.get(index);

            set.add(value);

            assigneesFromAttachment.set(index, set);
          } else {
            assigneesFromAttachment.set(index, new Set().add(value));
          }
        }

        if (value &&
          type === 'number'
          /** Handled stringified numbers */
          &&
          typeof Number(value) !== 'number') {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'string' &&
          typeof value !== 'string') {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (property === 'Number' &&
          !isNonEmptyString(value) &&
          typeof value !== 'number') {
          duplicatesSet.add(value);

          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (property === 'Name' &&
          !isNonEmptyString(value)) {
          duplicatesSet.add(value);

          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        /**
         * All fields past this check should only be checked if
         * the value is non-empty string because they are not
         * required.
         */
        if (!isNonEmptyString(value)) return;

        if (type === 'email' &&
          !isValidEmail(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'weekday' &&
          !weekdays.has(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'phoneNumber' &&
          !isE164PhoneNumber(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'HH:MM' &&
          !isHHMMFormat(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'base64' &&
          typeof value !== 'string') {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }
      }
    });

    if (locals.templateDoc.get('attachment').hasOwnProperty('Name')) {
      namesToCheck
        .push(conn.req.body.data[index].Name);
    }

    if (conn.req.body.template ===
      templateNamesObject.EMPLOYEE) {
      employeesToCheck.push({
        name: conn.req.body.data[index].Name,
        phoneNumber: conn.req.body.data[index]['Employee Contact'],
      });
    }
  });


  uniqueMap.forEach(setOfIndexes => {
    if (setOfIndexes.size === 1) return;

    setOfIndexes.forEach(index => {
      conn.req.body.data[index].rejected = true;
      conn.req.body.data[index].reason = `Duplicates`;
      conn.req.body.data[index].duplicatesAt = Array.from(setOfIndexes);
    });
  });

  conn.req.body.data.forEach((_, index) => {
    if (!assigneesFromAttachment.has(index) &&
      conn.req.body.data[index].share.length === 0
      /**
       * If the object has already been rejected for some reason,
       * it's assigneesFromAttachment map will most probably be empty.
       * In that case, the rejection message will show 'No assignees found'
       * even if the rejection was because of some other issue in
       * the object.
       */
      &&
      !conn.req.body.data[index].rejected &&
      conn.req.body.template !== 'customer' &&
      conn.req.body.template !== 'branch'
      /**
       * Templates like `leave-type`, `expense-type` and `customer-type`
       * are auto assigned to their respective recipients via
       * `activityOnWrite` on creation of subscription of leave, expense
       * and customer activities.
       */
      &&
      !conn.req.body.template.endsWith('-type')) {
      conn.req.body.data[index].rejected = true;
      conn.req.body.data[index].reason = `No assignees found`;
    }
  });

  locals.namesToCheck = namesToCheck;
  locals.employeesToCheck = employeesToCheck;
  locals.verifyValidTypes = verifyValidTypes;
  locals.adminToCheck = adminToCheck;
  locals.subscriptionsToCheck = subscriptionsToCheck;
  locals.assigneesFromAttachment = assigneesFromAttachment;
  locals.officeContacts = officeContacts;
  locals.allFieldsArray = allFieldsArray;

  /** Only support can use `trailRun` */
  const trialRun = conn.requester.isSupportRequest &&
    conn.req.query.trialRun === 'true';

  return fetchValidTypes(conn, locals)
    .then(() => handleAdmins(conn, locals))
    .then(() => handleSubscriptions(conn, locals))
    .then(() => handleUniqueness(conn, locals))
    .then(() => fetchDataForCanEditRule(conn, locals))
    .then(() => handleEmployees(conn, locals))
    .then(() => createObjects(conn, locals, trialRun))
    .then(responseObject => sendJSON(conn, responseObject));
};

const getBranchActivity = async address => {
  const activityObject = {
    address,
    venueDescriptor: 'Branch Office',
    location: '',
    latitude: '',
    longitude: '',
    Name: '',
    'First Contact': '',
    'Second Contact': '',
    'Branch Code': '',
    'Weekday Start Time': '',
    'Weekday End Time': '',
    'Saturday Start Time': '',
    'Saturday End Time': '',
    'Weekly Off': '',
  };

  Array.from(Array(15)).forEach((_, index) => {
    activityObject[`Holiday ${index + 1}`] = '';
  });

  try {
    const placesApiResponse = await googleMapsClient
      .places({
        query: address,
      })
      .asPromise();

    let success = true;

    const firstResult = placesApiResponse
      .json
      .results[0];
    success = Boolean(firstResult);

    if (!success) {
      return Object.assign({}, { address, failed: !success });
    }

    activityObject
      .latitude = firstResult.geometry.location.lat;
    activityObject
      .longitude = firstResult.geometry.location.lng;
    activityObject
      .placeId = firstResult['place_id'];

    const placeApiResult = await googleMapsClient
      .place({
        placeid: firstResult['place_id'],
      })
      .asPromise();

    const name = getBranchName(placeApiResult.json.result.address_components);
    activityObject.Name = name;
    activityObject.location = name;
    activityObject['First Contact'] = (() => {
      const internationalPhoneNumber = placeApiResult
        .json
        .result['international_phone_number'];

      if (!internationalPhoneNumber) return '';

      /** If the phoneNumber has spaces in between characters */
      return internationalPhoneNumber
        .split(' ')
        .join('');
    })();

    activityObject['Weekday Start Time'] = (() => {
      const openingHours = placeApiResult.json.result['opening_hours'];

      if (!openingHours) return '';

      const periods = openingHours.periods;

      const relevantObject = periods.filter(item => {
        return item.close && item.close.day === 1;
      });

      if (!relevantObject[0]) return '';

      return relevantObject[0].open.time;
    })();

    activityObject['Weekday End Time'] = (() => {
      const openingHours = placeApiResult.json.result['opening_hours'];

      if (!openingHours) return '';

      const periods = openingHours.periods;

      const relevantObject = periods.filter(item => {
        return item.close && item.close.day === 1;
      });

      if (!relevantObject[0]) return '';

      return relevantObject[0].close.time;
    })();

    activityObject['Saturday Start Time'] = (() => {
      const openingHours = placeApiResult.json.result['opening_hours'];

      if (!openingHours) return '';

      const periods = openingHours.periods;

      const relevantObject = periods.filter(item => {
        return item.open && item.open.day === 6;
      });

      if (!relevantObject[0]) return '';

      return relevantObject[0].open.time;
    })();

    activityObject['Saturday End Time'] = (() => {
      const openingHours = placeApiResult.json.result['opening_hours'];

      if (!openingHours) return '';

      const periods = openingHours.periods;

      const relevantObject = periods.filter(item => {
        return item.open && item.open.day === 6;
      });

      if (!relevantObject[0]) return '';

      return relevantObject[0].close.time;
    })();

    activityObject['Weekly Off'] = (() => {
      const openingHours = placeApiResult.json.result['opening_hours'];

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

    return activityObject;
  } catch (error) {
    console.error(error);
  }
};

const handleBranch = async conn => {
  if (conn.req.body.template !== 'branch') {
    return Promise.resolve();
  }

  const promises = [];
  const addressMap = new Map();

  conn.req.body.data.forEach((item, index) => {
    addressMap.set(item.address, index);

    if (!isNonEmptyString(item.address)) {
      conn.req.body.data[index].rejected = true;
      conn.req.body.data[index].reason = 'address is required';

      return;
    }

    promises.push(getBranchActivity(item.address));
  });

  try {
    const branches = await Promise.all(promises);

    branches.forEach(branch => {
      const { address } = branch;
      const index = addressMap.get(address);

      conn.req.body.data[index] = branch;
      conn.req.body.data[index].share = conn.req.body.data[index].share || [];
    });

    return Promise.resolve();
  } catch (error) {
    console.error(error);
  }
};

const handleCustomer = async conn => {
  if (conn.req.body.template !== 'customer') {
    return Promise.resolve();
  }

  const placesApiPromises = [];
  const rejectedIndexes = new Set();

  conn.req.body.data.forEach((item, index) => {
    if (!isNonEmptyString(item.address)) {
      conn.req.body.data[index].rejected = true;
      conn.req.body.data[index].reason = 'address is required';

      rejectedIndexes.add(index);

      return;
    }

    placesApiPromises.push(addressToCustomer({
      location: item.location,
      address: item.address,
    }));
  });

  try {
    const customers = await Promise.all(placesApiPromises);

    customers.forEach((customer, index) => {
      if (!customers.success) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = 'Not a known location';
      }

      conn.req.body.data[index] = customer;
      conn.req.body.data[index].share = conn.req.body.data[index].share || [];
    });

    return Promise.resolve();
  } catch (error) {
    console.error(error);
  }
};


module.exports = conn => {
  /**
   * Request body
   * office: string
   * timestamp: number
   * template: string
   * encoded: csvString
   * location: `object(latitude, longitude)`
   */
  if (!conn.requester.isSupportRequest) {
    if (!conn.requester.customClaims.admin ||
      !conn.requester.customClaims.admin.includes(conn.req.body.office)) {
      return sendResponse(
        conn,
        code.unauthorized,
        `You are not allowed to access this resource`
      );
    }
  }

  const result = handleValidation(conn.req.body);

  if (!result.success) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  const promises = [
    rootCollections
      .offices
      /** Office field can be skipped while creating `offices` in bulk */
      .where('office', '==', conn.req.body.office || '')
      .limit(1)
      .get(),
    rootCollections
      .activityTemplates
      .where('name', '==', conn.req.body.template)
      .limit(1)
      .get(),
  ];

  if (conn.req.body.template ===
    templateNamesObject.SUBSCRIPTION) {
    const promise = rootCollections
      .activityTemplates
      .get();

    promises.push(promise);
  }

  return Promise
    .all(promises)
    .then(result => {
      const [
        officeDocsQuery,
        templateDocsQuery,
        templatesCollectionQuery,
      ] = result;

      if (conn.req.body.template !== templateNamesObject.OFFICE &&
        officeDocsQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Office ${conn.req.body.office} doesn't exist`
        );
      }

      if (templateDocsQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Template ${conn.req.body.template} doesn't exist`
        );
      }

      const locals = {
        officeDoc: officeDocsQuery.docs[0],
        templateDoc: templateDocsQuery.docs[0],
        adminsSet: new Set(),
        employeesSet: new Set(),
      };

      const attachmentFieldsSet = new Set(
        Object.keys(locals.templateDoc.get('attachment'))
      );

      if (conn.req.body.template ===
        templateNamesObject.SUBSCRIPTION) {
        const templateNamesSet = new Set();

        templatesCollectionQuery
          .forEach(doc => templateNamesSet.add(doc.get('name')));

        locals
          .templateNamesSet = templateNamesSet;
      }

      conn.req.body.data.forEach((object, index) => {
        /**
         * Ignoring objects where all fields have empty
         * strings as the value.
         */
        if (isEmptyObject(object)) {
          delete conn.req.body.data[index];

          return;
        }

        if (!Array.isArray(object.share)) {
          conn.req.body.data[index].share = [];
        }

        const venueDescriptor = locals.templateDoc.get('venue')[0];

        if (venueDescriptor &&
          conn.req.body.data[index].venueDescriptor !== venueDescriptor) {
          conn.req.body.data[index].venueDescriptor = venueDescriptor;
        }

        attachmentFieldsSet.forEach(fieldName => {
          if (conn.req.body.data[index].hasOwnProperty(fieldName)) return;

          conn.req.body.data[index][fieldName] = '';
        });
      });

      locals
        .isSupportRequest = conn.requester.isSupportRequest;
      locals
        .isAdminRequest = !conn.requester.isSupportRequest
        && conn.requester.customClaims.admin
        && conn.requester.customClaims.admin.length > 0;

      return handleCustomer(conn, locals)
        .then(() => handleBranch(conn, locals))
        .then(() => validateDataArray(conn, locals));
    })
    .catch(error => handleError(conn, error));
};
