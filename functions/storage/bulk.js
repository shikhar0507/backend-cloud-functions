'use strict';

const {
  rootCollections,
  db,
  getGeopointObject,
} = require('../admin/admin');
const admin = require('firebase-admin');
const XLSX = require('xlsx');
const {
  getAuth,
  isValidDate,
  isHHMMFormat,
  isValidEmail,
  isEmptyObject,
  isValidGeopoint,
  adjustedGeopoint,
  isNonEmptyString,
  isE164PhoneNumber,
  addressToCustomer,
  getBranchName,
  getRelevantTime,
  millitaryToHourMinutes,
  getEmployeesMapFromRealtimeDb,
} = require('../admin/utils');
const {
  forSalesReport,
} = require('../firestore/activity/helper');
const {
  weekdays,
  dateFormats,
  validTypes,
  httpsActions,
  timezonesSet,
  reportNames,
} = require('../admin/constants');
const {
  alphabetsArray,
} = require('../firestore/recipients/report-utils');
const env = require('../admin/env');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: env.mapsApiKey,
      Promise: Promise,
    });
const momentTz = require('moment-timezone');
const xlsxPopulate = require('xlsx-populate');

const templateNamesObject = {
  ADMIN: 'admin',
  SUBSCRIPTION: 'subscription',
  EMPLOYEE: 'employee',
  OFFICE: 'office',
  RECIPIENT: 'recipient',
  DUTY: 'duty',
  CUSTOMER: 'customer',
  BRANCH: 'branch',
  KM_ALLOWANCE: 'km allowance',
};

const getOrderedFields = templateDoc => {
  const venue = templateDoc.get('venue');
  const schedule = templateDoc.get('schedule');
  const attachment = Object.keys(templateDoc.get('attachment'));

  return []
    .concat(venue, schedule, attachment)
    .sort();
};


const generateExcel = async locals => {
  const wb = await xlsxPopulate.fromBlankAsync();
  const template = locals.templateDoc.get('name');
  const office = locals.officeDoc.get('office');
  const sheet = wb.addSheet(`${template}`);

  /** Default sheet */
  wb
    .deleteSheet('Sheet1');

  const orderedFields = getOrderedFields(locals.templateDoc);

  orderedFields
    .push('rejected', 'reason');

  sheet.row(0).style('bold', true);

  orderedFields
    .forEach((value, index) => {
      sheet
        .cell(`${alphabetsArray[index]}1`)
        .value(value);
    });

  locals
    .inputObjects
    .forEach((object, outerIndex) => {
      orderedFields
        .forEach((field, innerIndex) => {
          const cell = `${alphabetsArray[innerIndex]}`
            + `${outerIndex + 2}`;
          let value = object[field] || '';

          if (field === 'rejected' && !value) {
            value = 'false';
          }

          sheet
            .cell(cell)
            .value(`${value}`);
        });
    });

  const excelFileBase64 = await wb.outputAsync('base64');
  const storageFilePathParts = locals.object.name.split('/');
  const fileName = storageFilePathParts[storageFilePathParts.length - 1];
  const bucket = admin
    .storage()
    .bucket(locals.object.bucket);
  const filePath = `/tmp/${fileName}`;

  await wb.toFileAsync(filePath);

  await bucket
    .upload(filePath, {
      destination: locals.storageFilePath,
      metadata: {
        cacheControl: 'no-cache',
        metadata: Object.assign({}, locals.metadata, {
          updateEvent: '1',
        }),
      },
    });

  const recipients = [
    locals.officeDoc.get('attachment.First Contact.value'),
    locals.officeDoc.get('attachment.Second Contact.value'),
    locals.phoneNumber,
  ].filter(Boolean);

  const authFetch = [];

  new Set(recipients).forEach(phoneNumber => {
    const p = getAuth(phoneNumber);

    authFetch.push(p);
  });

  const userRecords = await Promise
    .all(authFetch);

  const messageObject = {
    to: [],
    from: {
      name: 'Growthfile',
      email: env.systemEmail,
    },
    // While creating an office, 'office' will be undefined
    subject: `Bulk Creation Results: ${template}-${office || ''}`,
    html: `<p>Please find attached bulk creation results:</p>
    <p>for ${template} by ${locals.phoneNumber} (${locals.displayName})</p>`,
    attachments: [{
      fileName: `Bulk Create Report_`
        + `${locals.officeDoc.get('office') || ''}.xlsx`,
      content: excelFileBase64,
      type: 'text/csv',
      disposition: 'attachment',
    }],
  };

  if (locals.trialRun === 'true') {
    messageObject
      .subject = `[trial run] ${messageObject.subject}`;
  }

  userRecords
    .forEach(userRecord => {
      if (!userRecord.uid
        || !userRecord.email
        || !userRecord.emailVerified
        || userRecord.disabled) {
        return;
      }

      messageObject
        .to
        .push({
          email: userRecord.email,
          name: userRecord.displayName,
        });
    });

  console.log('Mail sent to:', messageObject.to);

  return sgMail
    .sendMultiple(messageObject);
};

const isOnLeave = async params => {
  const {
    startTime,
    endTime,
    timezone,
    officeId,
    phoneNumber,
  } = params;

  const leaveDates = [];
  const allMonthYears = new Set();
  const startTimeMoment = momentTz(startTime)
    .tz(timezone)
    .startOf('day');
  const endTimeMoment = momentTz(endTime)
    .tz(timezone)
    .endOf('day');

  allMonthYears
    .add(startTimeMoment.format(dateFormats.MONTH_YEAR));

  while (startTimeMoment.add(1, 'day').diff(endTimeMoment) <= 0) {
    const formatted = startTimeMoment.format(dateFormats.MONTH_YEAR);

    allMonthYears
      .add(formatted);
  }

  const promises = [];

  allMonthYears
    .forEach(monthYearString => {
      const promise = rootCollections
        .offices
        .doc(officeId)
        .collection('Statuses')
        .doc(monthYearString)
        .collection('Employees')
        .doc(phoneNumber)
        .get();

      promises
        .push(promise);
    });

  const docs = await Promise
    .all(promises);

  docs.forEach(doc => {
    if (!doc.exists) {
      return;
    }

    const statusObject = doc.get('statusObject') || {};
    const month = doc.get('month');
    const year = doc.get('year');

    Object
      .keys(statusObject)
      .forEach(date => {
        const item = statusObject[date];

        if (!item.onLeave) {
          return;
        }

        const dateMoment = momentTz()
          .tz(timezone)
          .date(Number(date))
          .month(month)
          .year(year);
        const start = momentTz(startTime)
          .tz(timezone)
          .startOf('day');
        const end = momentTz(endTime)
          .tz(timezone)
          .endOf('day');
        const isBefore = dateMoment.isSameOrAfter(start);
        const isAfter = dateMoment.isSameOrBefore(end);
        const isBetween = isBefore && isAfter;

        const formatted = dateMoment
          .format(dateFormats.DATE);

        if (!isBetween) {
          return;
        }

        leaveDates
          .push(formatted);
      });
  });

  return { phoneNumber, leaveDates };
};

const getCanEditValue = (locals, phoneNumber, requestersPhoneNumber) => {
  const canEditRule = locals.templateDoc.get('canEditRule');

  if (canEditRule === 'NONE') {
    return false;
  }

  if (canEditRule === 'ADMIN') {
    return locals.adminsSet.has(phoneNumber);
  }

  if (canEditRule === 'EMPLOYEE') {
    return locals.employeesSet.has(phoneNumber);
  }

  if (canEditRule === 'CREATOR') {
    return phoneNumber === requestersPhoneNumber;
  }

  // for `ALL`
  return true;
};


const executeSequentially = batchFactories => {
  let result = Promise.resolve();

  batchFactories
    .forEach((promiseFactory, index) => {
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
  // array will be empty since the threshold of 499 docs is
  // not reached
  if (batchesArray.length === 1) {
    return batchesArray[0].commit();
  }

  return executeSequentially(batchFactories);
};


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


const getActivityName = params => {
  const {
    template,
    subscriber,
    admin,
    name,
    number,
    displayName,
    phoneNumber,
    customerName,
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
  } else if (customerName) {
    /** Duty name -> DUTY: Customer Name */
    result += `${customerName}`;
  } else {
    result += `${displayName || phoneNumber}`;
  }

  if (template === templateNamesObject.RECIPIENT) {
    result += ` report`;
  }

  return result;
};


const createObjects = async (locals, trialRun) => {
  let totalDocsCreated = 0;
  let currentBatchIndex = 0;
  let batchDocsCount = 0;
  const batchFactories = [];
  const batchesArray = [];
  const timestamp = Date.now();
  const isOfficeTemplate = locals.templateDoc.get('name') === templateNamesObject.OFFICE;
  const attachmentFieldsSet = new Set(Object.keys(locals.templateDoc.get('attachment')));
  const scheduleFieldsSet = new Set(locals.templateDoc.get('schedule'));
  const venueFieldsSet = getVenueFieldsSet(locals.templateDoc)
    .add('placeId');

  locals.inputObjects.forEach((item, index) => {
    /**
     * Items are rejected/skipped if a conflict with the state of DB and
     * the request body exists,
     */
    if (item.rejected
      || item.skipped) {

      return;
    }

    const batch = (() => {
      const batchPart = db.batch();

      if (batchesArray.length === 0) {
        batchesArray
          .push(batchPart);
      }

      if (batchDocsCount > 450) {
        // reset count
        batchDocsCount = 0;
        batchesArray.push(batchPart);

        currentBatchIndex++;
        batchFactories
          .push(() => batchPart.commit());
      }

      return batchesArray[currentBatchIndex];
    })();

    const activityRef = rootCollections.activities.doc();
    const officeRef = (() => {
      if (locals.templateDoc.get('name') === templateNamesObject.OFFICE) {
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
      template: locals.templateDoc.get('name'),
      displayName: locals.displayName,
      phoneNumber: locals.phoneNumber,
    };

    if (locals.templateDoc.get('name')
      === templateNamesObject.DUTY) {
      params
        .customerName = item.Location;
    }

    const officeId = (() => {
      if (isOfficeTemplate) {
        return officeRef.id;
      }

      return locals
        .officeDoc
        .id;
    })();
    const office = (() => {
      if (isOfficeTemplate) {
        return item.Name;
      }

      return locals
        .officeDoc
        .get('attachment.Name.value');
    })();
    const timezone = (() => {
      if (locals.templateDoc.get('name')
        === templateNamesObject.OFFICE) {
        return item
          .Timezone;
      }

      return locals
        .officeDoc
        .get('attachment.Timezone.value');
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
        phoneNumber: locals.phoneNumber,
        displayName: locals.displayName,
        photoURL: locals.photoURL,
      },
      hidden: locals.templateDoc.get('hidden'),
      status: locals.templateDoc.get('statusOnCreate'),
      template: locals.templateDoc.get('name'),
      activityName: getActivityName(params),
      createTimestamp: Date.now(),
      forSalesReport: forSalesReport(locals.templateDoc.get('name')),
    };

    /**
     * `Note`: This is nested loop, however, the amount of data is pretty
     * small. This **WILL NOT** matter for a few hundred entries. But, for a
     * large excel file, this needs to be optimimzed.
     */
    if (locals.templateDoc.get('name')
      === templateNamesObject.DUTY) {
      []
        .concat(locals.inputObjects[index].Include)
        .concat(locals.inputObjects[index].Supervisor)
        .forEach(phoneNumber => {
          activityObject
            .checkIns = activityObject.checkIns || {};
          activityObject
            .checkIns[phoneNumber] = [];
        });
    }

    const objectFields = Object.keys(item);
    let scheduleCount = 0;

    objectFields
      .forEach(field => {
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
          const [startTime, endTime] = (value || '').split(',');

          const scheduleObject = {
            name: locals
              .templateDoc
              .get('schedule')[scheduleCount],
            startTime: '',
            endTime: '',
          };

          if (startTime) {
            scheduleObject
              .startTime = momentTz(new Date(startTime))
                .subtract(5.5, 'hours')
                .valueOf();
            scheduleObject
              .endTime = scheduleObject.startTime;
          }

          if (endTime) {
            scheduleObject
              .endTime = momentTz(new Date(endTime || startTime))
                .subtract(5.5, 'hours')
                .valueOf();
          }

          activityObject
            .schedule
            .push(scheduleObject);

          scheduleCount++;

          return;
        }

        if (isFromVenue) {
          activityObject
            .venue[0] = activityObject.venue[0] || {
              venueDescriptor: locals.templateDoc.get('venue')[0],
              geopoint: {},
            };

          if (field === 'placeId') {
            activityObject
              .venue[0]
              .placeId = value;
          }

          if (field === 'location') {
            activityObject
              .venue[0]
              .location = value;
          }

          if (field === 'latitude') {
            activityObject
              .venue[0]
              .geopoint
              .latitude = value;
          }

          if (field === 'longitude') {
            activityObject
              .venue[0]
              .geopoint
              .longitude = value;
          }

          if (field === 'address') {
            activityObject
              .venue[0]
              .address = value;
          }
        }
      });

    if (activityObject.venue[0]
      && activityObject.venue[0].geopoint.latitude
      && activityObject.venue[0].geopoint.longitude) {
      activityObject.venue[0].geopoint = new admin.firestore.GeoPoint(
        activityObject.venue[0].geopoint.latitude,
        activityObject.venue[0].geopoint.longitude
      );

      const adjusted = adjustedGeopoint(
        activityObject
          .venue[0].geopoint
      );

      activityObject
        .adjustedGeopoints = `${adjusted.latitude},${adjusted.longitude}`;
    }

    const relevantTime = getRelevantTime(activityObject.schedule);

    if (activityObject.schedule.length > 0) {
      activityObject
        .relevantTime = relevantTime;
    }

    if (activityObject.attachment.Location
      && activityObject.attachment.Location.value
      && activityObject.relevantTime) {
      activityObject
        .relevantTimeAndVenue = `${activityObject.attachment.Location.value}`
        + ` ${activityObject.relevantTime}`;
    }

    const addendumObject = {
      timestamp,
      activityData: activityObject,
      user: locals.phoneNumber,
      userDisplayName: locals.displayName,
      action: httpsActions.create,
      template: locals.templateDoc.get('name'),
      location: getGeopointObject(locals.geopoint),
      userDeviceTimestamp: locals.userDeviceTimestamp,
      activityId: activityRef.id,
      activityName: activityObject.activityName,
      geopointAccuracy: null,
      provider: null,
      isSupportRequest: locals.isSupportRequest,
      isAdminRequest: locals.isAdminRequest,
    };

    // Not all templates will have type phoneNumber in attachment.
    if (locals.assigneesFromAttachment.has(index)) {
      locals
        .assigneesFromAttachment
        .get(index)
        .forEach(phoneNumber => {
          locals
            .inputObjects[index]
            .share
            .push(phoneNumber);
        });
    }

    locals.inputObjects[index]
      .share
      .forEach(phoneNumber => {
        const ref = activityRef
          .collection('Assignees')
          .doc(phoneNumber.trim());
        const addToInclude = locals.templateDoc.get('name')
          === templateNamesObject.SUBSCRIPTION
          && phoneNumber
          !== activityObject.attachment.Subscriber.value;

        const canEdit = getCanEditValue(
          locals,
          phoneNumber,
          locals.phoneNumber
        );

        batch
          .set(ref, {
            canEdit,
            addToInclude,
          });
      });

    // 1 activity doc, and 2 addendum object
    batch
      .set(activityRef, activityObject);
    batch
      .set(addendumDocRef, addendumObject);

    // One doc for activity
    // Second for addendum
    totalDocsCreated += 2;
    batchDocsCount += 2;
    batchDocsCount += locals.inputObjects[index].share.length;
    totalDocsCreated += locals.inputObjects[index].share.length;
  });

  const responseObject = {
    totalDocsCreated,
    numberOfBatches: batchFactories.length,
    data: locals.inputObjects,
  };

  await generateExcel(locals);

  /** For testing out code */
  if (trialRun === 'true') {
    console.log('skipping create. trial run enabled');

    return responseObject;
  }

  await commitData(batchesArray, batchFactories);

  return responseObject;
};

const fetchDataForCanEditRule = async locals => {
  const rule = locals.templateDoc.get('canEditRule');

  if (rule !== 'ADMIN'
    && rule !== 'EMPLOYEE') {
    return;
  }

  /** Office's canEditRule is `NONE`. No handling required here */
  const docs = await rootCollections
    .activities
    .where('template', '==', rule.toLowerCase())
    .where('status', '==', 'CONFIRMED')
    .where('officeId', '==', locals.officeDoc.id)
    .get();

  const set = new Set();

  docs.forEach(doc => {
    const phoneNumber = doc.get('attachment.Employee Contact.value') ||
      doc.get('attachment.Admin.value');
    set
      .add(phoneNumber);
  });

  return;
};

const handleEmployees = async locals => {
  const promises = [];

  if (locals.templateDoc.get('name')
    !== templateNamesObject.EMPLOYEE) {
    return;
  }

  locals
    .employeesToCheck
    .forEach(item => {
      const promise = rootCollections
        .activities
        .where('officeId', '==', locals.officeDoc.id)
        .where('template', '==', templateNamesObject.EMPLOYEE)
        .where('attachment.Employee Contact.value', '==', item.phoneNumber)
        .where('attachment.Name.value', '==', item.name)
        // The `statusOnCreate` is most probably `CONFIRMED` in most cases.
        .where('status', '==', locals.templateDoc.get('statusOnCreate'))
        .limit(1)
        .get();

      promises
        .push(promise);
    });

  const phoneNumbersToRejectSet = new Set();

  const [
    employeesData,
    snapShots,
  ] = await Promise
    .all([
      getEmployeesMapFromRealtimeDb(locals.officeDoc.id),
      Promise
        .all(promises)
    ]);

  snapShots
    .forEach(snapShot => {
      if (snapShot.empty) {
        return;
      }

      /** Doc exists, employee already exists */
      const doc = snapShot.docs[0];
      const phoneNumber = doc.get('attachment.Employee Contact.value');

      phoneNumbersToRejectSet
        .add(phoneNumber);
    });

  locals.inputObjects.forEach((item, index) => {
    const phoneNumber = item['Employee Contact'];

    if (phoneNumbersToRejectSet.has(phoneNumber)) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Phone number`
        + ` ${phoneNumber} is already an employee`;

      return;
    }

    if (employeesData[phoneNumber]) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Phone number:`
        + ` ${phoneNumber} is already`
        + ` in use by ${employeesData[phoneNumber].Name}`;
    }
  });

  return;
};

const handleUniqueness = async locals => {
  const hasName = locals
    .templateDoc
    .get('attachment')
    .hasOwnProperty('Name');
  const hasNumber = locals
    .templateDoc
    .get('attachment')
    .hasOwnProperty('Number');

  if (!hasName
    && !hasNumber) {
    return;
  }

  const promises = [];
  let index = 0;
  const indexMap = new Map();
  const baseQuery = (() => {
    if (locals.templateDoc.get('name')
      === templateNamesObject.OFFICE) {
      return rootCollections.offices;
    }

    return rootCollections
      .activities
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', locals.templateDoc.get('name'))
      .where('officeId', '==', locals.officeDoc.id);
  })();

  const param = (() => {
    if (hasNumber) {
      return 'Number';
    }

    return 'Name';
  })();

  locals.inputObjects.forEach(item => {
    // Not querying anything for already rejected objects
    if (item.rejected) return;

    indexMap
      .set(item.Name || item.Number, index);

    index++;

    const promise = baseQuery
      .where(`attachment.${param}.value`, '==', item.Name || item.Number)
      .limit(1)
      .get();

    promises
      .push(promise);
  });

  const snapShots = await Promise
    .all(promises);

  snapShots.forEach(snapShot => {
    // Empty means that the entity with the name/number doesn't exist.
    if (snapShot.empty) {
      return;
    }

    const doc = snapShot.docs[0];
    const nameOrNumber = doc.get('attachment.Name.value')
      || doc.get('attachment.Number.value');
    const index_1 = indexMap.get(nameOrNumber);
    const value = locals.inputObjects[index_1].Name
      || locals.inputObjects[index_1].Number;
    locals.inputObjects[index_1].rejected = true;
    locals.inputObjects[index_1].reason =
      `${param} '${value}' is already in use`;

    if (locals.templateDoc.get('office')
      === templateNamesObject.OFFICE) {
      locals.inputObjects[index_1].reason =
        `Office: '${value} already exists'`;
    }
  });

  return;
};

const handleSubscriptions = async locals => {
  if (locals.templateDoc.get('name')
    !== templateNamesObject.SUBSCRIPTION) {
    return;
  }

  const promises = [];

  locals
    .subscriptionsToCheck
    .forEach(item => {
      const { phoneNumber, template } = item;

      const promise = rootCollections
        .activities
        .where('officeId', '==', locals.officeDoc.id)
        .where('template', '==', templateNamesObject.SUBSCRIPTION)
        .where('attachment.Subscriber.value', '==', phoneNumber)
        .where('attachment.Template.value', '==', template)
        .limit(1)
        .get();

      promises
        .push(promise);
    });

  const batch = db.batch();

  const snapShots = await Promise
    .all(promises);

  snapShots
    .forEach((snapShot, index) => {
      if (snapShot.empty) {
        // The user doesn't have the subscription
        // Creation is allowed.
        return;
      }

      const doc = snapShot.docs[0];
      const phoneNumber = doc.get('attachment.Subscriber.value');
      const template = doc.get('attachment.Template.value');
      const status = doc.get('status');

      if (status === 'CONFIRMED') {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason =
          `${phoneNumber} already has subscription of '${template}'`;

        return;
      }

      /**
       * This user has a `CANCELLED` subscription of the
       * template. Instead of creating another subcription
       * with the same template, we are simply `CONFIRMI`-ing
       * the old doc to avoid unnecessary duplicates
       */
      locals.inputObjects[index].skipped = true;

      batch
        .set(doc.ref, {
          addendumDocRef: null,
          status: 'CONFIRMED',
          timestamp: Date.now(),
        }, {
          merge: true,
        });
    });

  if (locals.trialRun === 'true') {
    return;
  }

  return batch
    .commit();
};

const handleAdmins = async locals => {
  const promises = [];

  if (locals.templateDoc.get('admin')
    !== templateNamesObject.ADMIN) {
    return;
  }

  locals
    .adminToCheck
    .forEach((phoneNumber) => {
      const promise = rootCollections
        .activities
        .where('officeId', '==', locals.officeDoc.id)
        .where('template', '==', templateNamesObject.ADMIN)
        .where('attachment.Admin.value', '==', phoneNumber)
        .where('status', '==', 'CONFIRMED')
        .limit(1)
        .get();

      promises
        .push(promise);
    });

  const adminsToReject = new Set();

  const snapShots = await Promise
    .all(promises);
  snapShots.forEach((snapShot, index) => {
    if (snapShot.empty) {
      return;
    }

    const phoneNumber = locals.adminToCheck[index];

    adminsToReject.add(phoneNumber);
  });

  locals.inputObjects.forEach((object, index) => {
    const phoneNumber = object.Admin;

    if (!phoneNumber) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason =
        `Invalid value '${phoneNumber || 'empty'}' for Admin phone number`;
    }

    if (adminsToReject.has(phoneNumber)) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `${phoneNumber} is already an Admin`;
    }
  });

  return;
};

const fetchValidTypes = async locals => {
  if (locals.templateDoc.get('name')
    === templateNamesObject.OFFICE) {
    return;
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
        .where('officeId', '==', locals.officeDoc.id)
        .where('template', '==', type)
        .where(`attachment.Name.value`, '==', value)
        .where('status', '==', 'CONFIRMED')
        .limit(1)
        .get();

      promises
        .push(promise);
    });

  const snapShots = await Promise
    .all(promises);
  snapShots.forEach((snapShot, index) => {
    // doc should exist
    if (!snapShot.empty) {
      /** Doc exists, so creation is allowed */
      return;
    }

    const nonExistingValue = queryMap.get(index);

    nonExistingValuesSet
      .add(nonExistingValue);
  });

  locals.inputObjects
    .forEach((object, index) => {
      const fields = Object.keys(object);
      fields.forEach(field => {
        const value = object[field];

        if (nonExistingValuesSet.has(value)) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason =
            `${field} ${value} doesn't exist`;
        }
      });
    });

  return;
};

const validateDataArray = async locals => {
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

  locals.inputObjects.forEach((dataObject, index) => {
    const uniqueValue = (() => {
      if (locals.templateDoc.get('name')
        === templateNamesObject.EMPLOYEE) {
        return dataObject['Employee Contact'];
      }

      if (locals.templateDoc.get('name')
        === templateNamesObject.ADMIN) {
        return dataObject.Admin;
      }

      /**
       * For template subscription, the combination of Subscriber
       * and Template is unique
       */
      if (locals.templateDoc.get('name')
        === templateNamesObject.SUBSCRIPTION) {
        return `${dataObject.Subscriber}-${dataObject.Template}`;
      }

      return dataObject.Name
        || dataObject.Number;
    })();

    if (uniqueValue) {
      const indexSet = uniqueMap.get(uniqueValue)
        || new Set();
      indexSet
        .add(index);
      uniqueMap
        .set(uniqueValue, indexSet);
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
      if (attachmentFieldsSet.has(field)
        && locals.templateDoc.get('attachment')[field].type === 'number'
        && locals.inputObjects[index][field]) {
        locals.inputObjects[index][field] = Number(
          locals.inputObjects[index][field]
        );
      }

      if (!objectProperties.includes(field)) {
        locals.inputObjects[index][field] = '';

        return;
      }

      if (locals.templateDoc.get('venue').length > 0) {
        const msg = `All location fields are required`;
        const allVenueFields = [
          locals.inputObjects[index].latitude,
          locals.inputObjects[index].longitude,
          locals.inputObjects[index].address,
          locals.inputObjects[index].location
        ];

        if ((locals.inputObjects[index].latitude
          || locals.inputObjects[index].longitude
          || locals.inputObjects[index].address
          || locals.inputObjects[index].location)
          && allVenueFields.filter(Boolean).length !== allVenueFields.length) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = msg;
        }

        if (locals.inputObjects[index].latitude
          && locals.inputObjects[index].longitude
          && !isValidGeopoint({
            latitude: locals.inputObjects[index].latitude,
            longitude: locals.inputObjects[index].longitude,
          }, false)) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = msg;
        }
      }

      if (locals.templateDoc.get('attachment').hasOwnProperty('Name')
        && !locals.inputObjects[index].rejected
        && !isNonEmptyString(locals.inputObjects[index].Name)) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `Missing the field 'Name'`;
      }

      if (locals.templateDoc.get('attachment').hasOwnProperty('Number')
        && !locals.inputObjects[index].rejected
        && typeof locals.inputObjects[index].Number !== 'number') {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `Missing the field 'Number'`;
      }
    });

    if (locals.templateDoc.get('name')
      !== templateNamesObject.OFFICE) {
      const firstContact = locals.officeDoc.get('attachment.First Contact.value');
      const secondContact = locals.officeDoc.get('attachment.Second Contact.value');

      if (firstContact) {
        locals.inputObjects[index].share.push(firstContact);
      }

      if (secondContact) {
        locals.inputObjects[index].share.push(secondContact);
      }
    }

    if (locals.templateDoc.get('name')
      === templateNamesObject.RECIPIENT) {
      const reportName = locals.inputObjects[index].Name;
      const validReports = new Set([
        reportNames.FOOTPRINTS,
        reportNames.PAYROLL,
        reportNames.REIMBURSEMENT,
        reportNames.PAYROLL_MASTER,
      ]);

      if (!validReports.has(reportName)) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `${reportName}`
          + ` is not a valid report.`
          + ` Use ${Array.from(validReports.keys())}`;
      }
    }

    if (locals.templateDoc.get('name')
      === templateNamesObject.OFFICE) {
      const firstContact = locals.inputObjects[index]['First Contact'];
      const secondContact = locals.inputObjects[index]['Second Contact'];
      const timezone = locals.inputObjects[index].Timezone;

      if (firstContact
        === secondContact) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `Both contacts cannot be the same or empty`;
      }

      if (!firstContact
        && !secondContact) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `At least one contact is required`;
      }

      if (!timezone
        || !timezonesSet.has(timezone)) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `Invalid/Missing timezone`;
      }

      const contacts = [];

      if (firstContact) {
        contacts.push(firstContact);
      }

      if (secondContact) {
        contacts.push(secondContact);
      }

      officeContacts.set(index, contacts);
    }

    if (locals.templateDoc.get('name')
      === templateNamesObject.SUBSCRIPTION) {
      const phoneNumber = locals.inputObjects[index].Subscriber;
      const template = locals.inputObjects[index].Template;

      if (!phoneNumber) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `Invalid Subscriber`;
      }

      if (!template) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `Invalid template`;
      }

      /** Subscription of template office and subscription
       * is not allowed for everyone
       */
      if (template === templateNamesObject.OFFICE
        || template === templateNamesObject.SUBSCRIPTION) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason =
          `Subscription of template: '${template}' is not allowed`;
      }

      if (!locals.templateNamesSet.has(template)) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason =
          `Template: '${template} does not exist'`;
      }

      if (subscriptionsMap.has(phoneNumber)) {
        const set = subscriptionsMap.get(phoneNumber);

        set
          .add(template);

        subscriptionsMap
          .set(
            phoneNumber,
            set
          );
      } else {
        subscriptionsMap
          .set(
            phoneNumber,
            new Set().add(template)
          );
      }

      subscriptionsToCheck
        .push({
          phoneNumber: locals.inputObjects[index].Subscriber,
          template: locals.inputObjects[index].Template,
        });
    }

    if (locals.templateDoc.get('name')
      === templateNamesObject.ADMIN) {
      const phoneNumber = locals.inputObjects[index].Admin;

      adminsSet.add(phoneNumber);
      adminToCheck.push(phoneNumber);
    }

    if (locals.templateDoc.get('name')
      === templateNamesObject.EMPLOYEE) {
      const firstSupervisor = locals.inputObjects[index]['First Supervisor'];
      const secondSupervisor = locals.inputObjects[index]['Second Supervisor'];
      const thirdSupervisor = locals.inputObjects[index]['Third Supervisor'];

      if (!firstSupervisor
        && !secondSupervisor
        && !thirdSupervisor) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `Please add at least one supervisor`;
      }

      if (firstSupervisor === secondSupervisor && secondSupervisor === thirdSupervisor) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `Employee supervisors should be distinct`
          + ` phone numbers`;
      }
    }

    objectProperties.forEach(property => {
      const value = dataObject[property];

      if (value
        // Handling duty schedule in a special function
        && locals.templateDoc.get('name') !== templateNamesObject.DUTY
        && scheduleFieldsSet.has(property)
        && !isValidDate(value)) {
        locals.inputObjects[index].rejected = true;
        locals.inputObjects[index].reason = `The field ${property}` +
          ` should be a valid unix timestamp`;

        return;
      }

      if (attachmentFieldsSet.has(property)) {
        const type = locals.templateDoc.get('attachment')[property].type;

        if (!validTypes.has(type)
          && value) {
          // Used for querying activities which should exist on the
          // basis of name
          verifyValidTypes.set(index, {
            value,
            type,
            field: property
          });
        }

        if (locals.templateDoc.get('name')
          === templateNamesObject.EMPLOYEE
          && property === 'Employee Contact'
          && !isE164PhoneNumber(value)) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Employee ${property}` +
            ` should be a valid phone number`;

          return;
        }

        if (value
          && type === 'phoneNumber') {
          if (assigneesFromAttachment.has(index)) {
            const set = assigneesFromAttachment.get(index);

            set
              .add(value);

            assigneesFromAttachment
              .set(index, set);
          } else {
            assigneesFromAttachment
              .set(
                index,
                new Set().add(value)
              );
          }
        }

        if (value
          && type === 'number'
          /** Handled stringified numbers */
          && typeof Number(value) !== 'number') {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'string'
          && typeof value !== 'string'
          && locals.templateDoc.get('name')
          !== templateNamesObject.DUTY) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (property === 'Number'
          && !isNonEmptyString(value)
          && typeof value !== 'number') {
          duplicatesSet
            .add(value);

          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (property === 'Name'
          && !isNonEmptyString(value)) {
          duplicatesSet.add(value);

          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        /**
         * All fields past this check should only be checked if
         * the value is non-empty string because they are not
         * required.
         */
        if (!isNonEmptyString(value)) {
          return;
        }

        if (type === 'email'
          && !isValidEmail(value)) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'weekday'
          && !weekdays.has(value)) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'phoneNumber'
          && !isE164PhoneNumber(value)) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'HH:MM'
          && !isHHMMFormat(value)) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'base64'
          && typeof value !== 'string') {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Invalid ${property} '${value}'`;

          return;
        }
      }
    });

    if (locals.templateDoc.get('attachment').hasOwnProperty('Name')) {
      namesToCheck
        .push(locals.inputObjects[index].Name);
    }

    if (locals.templateDoc.get('name')
      === templateNamesObject.EMPLOYEE) {
      employeesToCheck.push({
        name: locals.inputObjects[index].Name,
        phoneNumber: locals.inputObjects[index]['Employee Contact'],
      });
    }
  });


  uniqueMap
    .forEach(setOfIndexes => {
      if (setOfIndexes.size === 1) {
        return;
      }

      setOfIndexes
        .forEach(index => {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Duplicates`;
          locals.inputObjects[index].duplicatesAt = Array.from(setOfIndexes);
        });
    });

  locals.inputObjects.forEach((_, index) => {
    if (!assigneesFromAttachment.has(index)
      && locals.inputObjects[index].share.length === 0
      /**
       * If the object has already been rejected for some reason,
       * it's assigneesFromAttachment map will most probably be empty.
       * In that case, the rejection message will show 'No assignees found'
       * even if the rejection was because of some other issue in
       * the object.
       */
      && !locals.inputObjects[index].rejected
      && locals.templateDoc.get('name') !== templateNamesObject.CUSTOMER
      && locals.templateDoc.get('name') !== templateNamesObject.BRANCH
      && locals.templateDoc.get('name') !== templateNamesObject.KM_ALLOWANCE
      /**
       * Templates like `leave-type`, `claim-type` and `customer-type`
       * are auto assigned to their respective recipients via
       * `activityOnWrite` on creation of subscription of leave, expense
       * and customer activities.
       */
      && !locals.templateDoc.get('name').endsWith('-type')) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `No assignees found`;
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
  const trialRun = locals.trialRun;

  await fetchValidTypes(locals);
  await handleAdmins(locals);
  await handleSubscriptions(locals);
  await handleUniqueness(locals);
  await fetchDataForCanEditRule(locals);
  await handleEmployees(locals);

  return createObjects(locals, trialRun);
};

const handleCustomer = async locals => {
  if (locals.templateDoc.get('name')
    !== templateNamesObject.CUSTOMER) {
    return;
  }

  const placesApiPromises = [];
  const rejectedIndexes = new Set();

  locals.inputObjects.forEach((item, index) => {
    if (!isNonEmptyString(item.address)) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = 'address is required';

      rejectedIndexes.add(index);

      return;
    }

    placesApiPromises.push(addressToCustomer({
      location: item.location,
      address: item.address,
    }));
  });

  const customers = await Promise.all(placesApiPromises);

  customers.forEach((customer, index) => {
    if (!customer.success) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = 'Not a known location';
    }

    locals.inputObjects[index] = customer;
    locals.inputObjects[index].share = locals.inputObjects[index].share || [];
  });

  return;
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
    return Object
      .assign({}, {
        address,
        failed: !success
      });
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
  activityObject
    .Name = name;
  activityObject
    .location = name;

  activityObject['Weekday Start Time'] = (() => {
    const openingHours = placeApiResult.json.result['opening_hours'];

    if (!openingHours) return '';

    const periods = openingHours.periods;

    const relevantObject = periods.filter(item => {
      return item.close && item.close.day === 1;
    });

    if (!relevantObject[0]) return '';

    return millitaryToHourMinutes(relevantObject[0].open.time);
  })();

  activityObject['Weekday End Time'] = (() => {
    const openingHours = placeApiResult.json.result['opening_hours'];

    if (!openingHours) return '';

    const periods = openingHours.periods;

    const relevantObject = periods.filter(item => {
      return item.close
        && item.close.day === 1;
    });

    if (!relevantObject[0]) return '';

    return millitaryToHourMinutes(relevantObject[0].close.time);
  })();

  activityObject['Saturday Start Time'] = (() => {
    const openingHours = placeApiResult.json.result['opening_hours'];

    if (!openingHours) return '';

    const periods = openingHours.periods;

    const relevantObject = periods.filter(item => {
      return item.open && item.open.day === 6;
    });

    if (!relevantObject[0]) return '';

    return millitaryToHourMinutes(relevantObject[0].open.time);
  })();

  activityObject['Saturday End Time'] = (() => {
    const openingHours = placeApiResult.json.result['opening_hours'];

    if (!openingHours) return '';

    const periods = openingHours.periods;

    const relevantObject = periods.filter(item => {
      return item.open && item.open.day === 6;
    });

    if (!relevantObject[0]) return '';

    return millitaryToHourMinutes(relevantObject[0].close.time);
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
    return parts[0]
      .toLowerCase();
  })();

  return activityObject;
};

const handleBranch = async locals => {
  if (locals.templateDoc.get('name')
    !== templateNamesObject.BRANCH) {
    return;
  }

  const promises = [];
  const addressMap = new Map();

  locals.inputObjects.forEach((item, index) => {
    addressMap.set(item.address, index);

    if (!isNonEmptyString(item.address)) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjectsa[index].reason = 'address is required';

      return;
    }

    promises.push(getBranchActivity(item.address));
  });

  const branches = await Promise.all(promises);

  branches.forEach(branch => {
    const { address } = branch;
    const index = addressMap.get(address);

    locals.inputObjects[index] = branch;
    locals.inputObjects[index].share = locals.inputObjects[index].share || [];
  });

  return;
};

const handleKmAllowance = async locals => {
  if (locals.templateDoc.get('name')
    !== templateNamesObject.KM_ALLOWANCE) {
    return;
  }

  locals.inputObjects.forEach((item, index) => {
    if (item.Local === 'TRUE'
      && item.Travel === 'TRUE') {
      locals
        .inputObjects[
        index
      ].rejected = true;
      locals
        .inputObjects[
        index
      ].reason = `Only one among`
      + ` (Local and Up Country)`
        + ` can be true`;

      return;
    }

    if (item.Local === 'TRUE') {
      locals.inputObjects[index].Local = true;
    }

    if (item.Local === 'FALSE') {
      locals.inputObjects[index].Local = false;
    }

    if (item.Travel === 'TRUE') {
      locals.inputObjects[index].Travel = true;
    }

    if (item.Travel === 'FALSE') {
      locals.inputObjects[index].Travel = false;
    }
  });

  return;
};

const handleDuty = async locals => {
  if (locals.templateDoc.get('name')
    !== templateNamesObject.DUTY) {
    return;
  }

  const schedule = locals.templateDoc.get('schedule')[0];
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const customerPromises = [];
  const dutyTypePromises = [];
  const leavePromises = [];
  const authPromises = [];
  const phoneNumberIndexMap = new Map();
  const includeArrayMap = new Map();
  const statusObjectPromises = [];
  const statusObjectMap = new Map();

  locals.inputObjects.forEach((item, index) => {
    // empty schedule not allowed
    // schedule start time should be of the future
    // schedule cannot be empty
    // location (customer cannot be empty)
    // include can be empty
    const singleSchedule = item[schedule];

    if (typeof singleSchedule !== 'string') {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Schedule`
        + ` '${schedule}' is invalid/missing`
        + ` Use the format `
        + `'${momentTz().format(dateFormats.EXCEL_INPUT)}'`;

      return;
    }

    const scheduleParts = singleSchedule.split(',');
    const startTime = scheduleParts[0].trim();
    // start time is the same as endtime if endtime is not defined
    const endTime = (scheduleParts[1] || scheduleParts[0]).trim();

    const stValid = momentTz(
      startTime,
      dateFormats.EXCEL_INPUT,
      true
    );
    const etValid = momentTz(
      endTime,
      dateFormats.EXCEL_INPUT,
      true
    );

    if (!stValid.isValid() || !etValid.isValid()) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Invalid Duty.`
        + ` Use the format `
        + ` '${momentTz().format(dateFormats.EXCEL_INPUT)}'`;

      return;
    }

    const momentStartTimeFromSchedule = momentTz(
      new Date(startTime).toUTCString()
    );
    const momentEndTimeFromSchedule = momentTz(
      new Date(endTime).toUTCString()
    );
    locals.inputObjects[
      index
    ].formattedStartTime = momentStartTimeFromSchedule;

    locals.inputObjects[
      index
    ].formattedEndTime = momentEndTimeFromSchedule;

    // Duty can't be for the past
    if (momentStartTimeFromSchedule.isBefore(momentTz().tz(timezone))) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Duty start`
        + ` time '${startTime}' is from the past`;

      return;
    }

    if (momentStartTimeFromSchedule.isAfter(momentEndTimeFromSchedule, 'minute')) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Duty end`
        + ` time should be after the duty start time`;

      return;
    }

    if (!isE164PhoneNumber(item.Supervisor)) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Invalid/missing`
        + ` 'Supervisor' phone number`;

      return;
    }

    if (!isNonEmptyString(item.Location)) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Customer`
        + ` cannot be left blank`;

      return;
    }

    const customerPromise = rootCollections
      .activities
      .where('template', '==', 'customer')
      .where('status', '==', 'CONFIRMED')
      .where('officeId', '==', locals.officeDoc.id)
      .where('attachment.Name.value', '==', item.Location)
      .limit(1)
      .get();

    customerPromises
      .push(customerPromise);

    const phoneNumbers = (() => {
      if (Array.isArray(item.Include)) {
        return item.Include;
      }

      return item
        .Include
        .split(',')
        .filter(Boolean)
        .map(phoneNumber => phoneNumber.trim());
    })();

    if (phoneNumbers.length === 0) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `'Include' is empty`;

      return;
    }

    includeArrayMap
      .set(index, phoneNumbers);

    locals.inputObjects[index].Include = phoneNumbers;

    locals.inputObjects[index].Include = [
      ...new Set(phoneNumbers)
    ];

    phoneNumbers
      .push(item.Supervisor.trim());

    if (!locals.isSupportRequest) {
      phoneNumbers
        .push(locals.phoneNumber);
    }

    phoneNumbers
      .forEach(phoneNumber => {
        const authPromise = getAuth(phoneNumber);
        const leavePromise = isOnLeave({
          timezone,
          phoneNumber,
          startTime: momentStartTimeFromSchedule.valueOf(),
          endTime: momentEndTimeFromSchedule.valueOf(),
          officeId: locals.officeDoc.id,
        });

        leavePromises
          .push(leavePromise);

        authPromises
          .push(authPromise);

        const monthYearString = momentStartTimeFromSchedule
          .format(dateFormats.MONTH_YEAR);
        const statusObjectPromise = locals
          .officeDoc
          .ref
          .collection('Statuses')
          .doc(monthYearString)
          .collection('Employees')
          .doc(phoneNumber)
          .get();

        statusObjectPromises
          .push(statusObjectPromise);

        const oldIndexArray = phoneNumberIndexMap
          .get(phoneNumber.trim())
          || new Set().add(index);

        oldIndexArray
          .add(index);

        phoneNumberIndexMap
          .set(
            phoneNumber.trim(),
            oldIndexArray
          );
      });

    if (!isNonEmptyString(item['Duty Type'])) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Missing Duty Type`;

      return;
    }

    const promise = rootCollections
      .activities
      .where('officeId', '==', locals.officeDoc.id)
      .where('attachment.Name.value', '==', item['Duty Type'])
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get();

    dutyTypePromises
      .push(promise);
  });

  const statusObjectSnapshot = await Promise
    .all(statusObjectPromises);

  statusObjectSnapshot
    .forEach(doc => {
      const phoneNumber = doc.get('phoneNumber');

      if (!doc.exists) {
        return;
      }

      const statusObject = doc.get('statusObject') || {};

      statusObjectMap
        .set(
          phoneNumber,
          statusObject
        );
    });

  const dutyTypeSnapshots = await Promise
    .all(dutyTypePromises);
  const rejectedDutyTypes = new Set();

  dutyTypeSnapshots
    .forEach(snapShot => {
      if (!snapShot.empty) return;

      // snapshot is empty, reject items with this duty type
      const filters = snapShot.query._queryOptions.fieldFilters;
      const value = filters[1].value;

      rejectedDutyTypes
        .add(value);
    });

  const customerSnapshots = await Promise
    .all(customerPromises);
  const existingCustomersSet = new Set();

  customerSnapshots
    .forEach(snap => {
      if (snap.empty) {
        return;
      }

      const name = snap
        .docs[0]
        .get('attachment.Name.value');

      existingCustomersSet
        .add(name);
    });

  const leavePromisesResult = await Promise
    .all(leavePromises);

  leavePromisesResult
    .forEach(item => {
      const { leaveDates, phoneNumber } = item;

      const indexes = phoneNumberIndexMap
        .get(phoneNumber) || [];

      if (leaveDates.length === 0) {
        return;
      }

      indexes
        .forEach(index => {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `Duty cannot be assigned to`
            + ` ${phoneNumber}. Employee has applied for a`
            + ` leave on ${leaveDates}`;
        });
    });

  locals.inputObjects.forEach((dutyObject, index) => {
    if (dutyObject.rejected) {
      return;
    }

    if (!existingCustomersSet.has(dutyObject.Location)) {
      locals.inputObjects[index].rejected = true;
      locals.inputObjects[index].reason = `Customer:` +
        ` ${dutyObject.Location} not found`;

      return;
    }
  });

  const userRecords = await Promise
    .all(authPromises);
  const usersWithAuth = new Set();

  userRecords
    .forEach(userRecord => {
      const { uid, phoneNumber } = userRecord;

      if (uid) {
        usersWithAuth.add(phoneNumber);
      }
    });

  locals.inputObjects.forEach((item, index) => {
    if (item.rejected) {
      return;
    }

    const phoneNumbers = includeArrayMap
      .get(index)
      || [];

    phoneNumbers
      .forEach(phoneNumber => {
        if (usersWithAuth.has(phoneNumber)) {
          locals.inputObjects[index].share.push(phoneNumber);

          // FIXME: This could be improved
          locals.inputObjects[index].share = [
            ...new Set(locals.inputObjects[index].share)
          ];

          return;
        }

        const indexSet = phoneNumberIndexMap
          .get(phoneNumber);

        if (indexSet.has(index)) {
          locals.inputObjects[index].rejected = true;
          locals.inputObjects[index].reason = `${phoneNumber}`
            + ` is not an active user`;
        }
      });
  });

  return;
};


module.exports = async (object, context) => {
  try {
    const [
      officeId,
      template,
    ] = object.name.split('/');
    const bucket = admin
      .storage()
      .bucket(object.bucket);

    const [
      buffer
    ] = await bucket.file(object.name).download();
    const [
      metadataResponse
    ] = await bucket.file(object.name).getMetadata();

    if (metadataResponse.metadata.updateEvent === '1') {
      console.log('returning after update');

      return;
    }

    const workbook = XLSX.read(buffer, {
      type: 'buffer'
    });

    const sheet1 = workbook.SheetNames[0];
    const theSheet = workbook.Sheets[sheet1];
    const inputObjects = XLSX
      .utils
      .sheet_to_json(theSheet, {
        blankrows: false, // empty rows are redundant
        defval: '',
        raw: false,
      });

    const promises = [
      rootCollections
        .activityTemplates
        .where('name', '==', template)
        .limit(1)
        .get(),
      rootCollections
        .offices
        /** Office field can be skipped while creating `offices` in bulk */
        .doc(officeId || null)
        .get(),
    ];

    if (template
      === templateNamesObject.SUBSCRIPTION) {
      const promise = rootCollections
        .activityTemplates
        .get();

      promises
        .push(promise);
    }

    const [
      templateDocsQuery,
      officeDoc,
      templatesCollectionQuery,
    ] = await Promise
      .all(promises);

    const locals = {
      inputObjects,
      officeDoc,
      templateDoc: templateDocsQuery.docs[0],
      adminsSet: new Set(),
      employeesSet: new Set(),
    };

    locals.inputObjects.forEach((object, index) => {
      /**
       * Ignoring objects where all fields have empty
       * strings as the value.
       */
      if (isEmptyObject(object)) {
        delete locals.inputObjects[index];

        return;
      }

      if (!Array.isArray(locals.inputObjects[index].share)) {
        locals.inputObjects[index].share = [];
      }

      const venueDescriptor = locals.templateDoc.get('venue')[0];

      if (venueDescriptor
        && locals
          .inputObjects[index].venueDescriptor !== venueDescriptor) {
        locals
          .inputObjects[index].venueDescriptor = venueDescriptor;
      }

      const attachmentFieldsSet = new Set(
        Object.keys(locals.templateDoc.get('attachment'))
      );

      if (template
        === templateNamesObject.SUBSCRIPTION) {
        const templateNamesSet = new Set();

        templatesCollectionQuery
          .forEach(doc => {
            templateNamesSet
              .add(doc.get('name'));
          });

        locals
          .templateNamesSet = templateNamesSet;
      }

      attachmentFieldsSet
        .forEach(fieldName => {
          if (locals.inputObjects[index].hasOwnProperty(fieldName)) {
            if (typeof locals.inputObjects[index][fieldName] === 'string') {
              locals.inputObjects[index][fieldName] =
                // Replacing tab and newline chars from input
                locals.inputObjects[index][fieldName]
                  .replace(/\s\s+/g, ' ')
                  .trim();
            }

            return;
          }

          locals.inputObjects[index][fieldName] = '';
        });
    });

    locals
      .geopoint = {
        latitude: Number(metadataResponse.metadata.latitude),
        longitude: Number(metadataResponse.metadata.longitude),
      };
    locals
      .userDeviceTimestamp = Number(metadataResponse.metadata.timestamp);
    locals
      .phoneNumber = metadataResponse.metadata.phoneNumber;
    locals
      .displayName = metadataResponse.metadata.displayName || '';
    locals
      .photoURL = metadataResponse.metadata.photoURL || '';
    locals
      .isSupportRequest = metadataResponse.metadata.isSupportRequest === 'true';
    locals
      .isAdminRequest = metadataResponse.metadata.isAdminRequest === 'true';
    locals
      .phoneNumber = metadataResponse.metadata.phoneNumber;
    locals
      .trialRun = metadataResponse.metadata.trialRun === 'true';
    locals
      .metadata = metadataResponse.metadata;
    locals
      .storageFilePath = object.name;
    locals
      .object = object;

    await handleCustomer(locals);
    await handleBranch(locals);
    await handleDuty(locals);
    await handleKmAllowance(locals);

    return validateDataArray(locals);
  } catch (error) {
    console.error({
      error,
      context,
    });
  }
};
