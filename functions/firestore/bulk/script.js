'use strict';

const {
  getGeopointObject,
  rootCollections,
  db,
} = require('../../admin/admin');
const {
  hasAdminClaims,
  sendResponse,
  handleError,
  sendJSON,
  isNonEmptyString,
  isValidEmail,
  isValidGeopoint,
  isHHMMFormat,
  isValidDate,
  isE164PhoneNumber,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const {
  weekdays,
  validTypes,
  httpsActions,
} = require('../../admin/constants');


const handleValidation = (body) => {
  const result = { success: true, message: null };

  const messageString = (field) =>
    `Invalid/Missing field '${field}' from the request body`;

  if (!isNonEmptyString(body.office)
    || !body.hasOwnProperty('office')) {
    return {
      success: false,
      message: messageString('office'),
    };
  }

  if (!isNonEmptyString(body.template)
    || !body.hasOwnProperty('template')) {
    return {
      success: false,
      message: messageString('template'),
    };
  }

  if (!isValidDate(body.timestamp)
    || !body.hasOwnProperty('timestamp')) {
    return {
      success: false,
      message: messageString('timestamp'),
    };
  }

  if (!isValidGeopoint(body.geopoint)
    || !body.hasOwnProperty('geopoint')) {
    return {
      success: false,
      message: messageString('geopoint'),
    };
  }

  if (!Array.isArray(body.data)
    || !body.hasOwnProperty('data')) {
    return {
      success: false,
      message: messageString('data'),
    };
  }

  for (let iter = 0; iter < body.data.length; iter++) {
    const item = body.data[iter];

    if (typeof item === 'object') {
      continue;
    }

    return {
      success: false,
      message: `In field 'data', object at position: ${iter} is invalid`,
    };
  }

  return result;
};

const getActivityName = (params) => {
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
  } else if (template === 'admin') {
    result += `${admin}`;
  } else if (template === 'subscription') {
    result += `${subscriber}`;
  } else {
    result += `${displayName || phoneNumber}`;
  }

  if (template === 'recipient') {
    result += ` report`;
  }

  return result;
};

const executeSequentially = (batchFactories) => {
  let result = Promise.resolve();

  batchFactories.forEach((promiseFactory, index) => {
    result = result
      .then(promiseFactory)
      .then(() => console.log(`Commited ${index + 1} of ${batchFactories.length}`));
  });

  return result;
};

const commitData = (conn, batchesArray, batchFactories, responseObject) => {
  // For a single batch, no need to create batch factories
  if (batchesArray.length === 1) {
    return batchesArray[0]
      .commit()
      .then(() => sendJSON(conn, responseObject))
      .catch((error) => handleError(conn, error));
  }

  return executeSequentially(batchFactories)
    .then(() => sendJSON(conn, responseObject))
    .catch((error) => handleError(conn, error));
};


const getCanEditValue = (locals, phoneNumber, requestersPhoneNumber) => {
  const rule = locals.templateDoc.get('canEditRule');

  if (rule === 'NONE') return false;
  if (rule === 'ADMIN') return locals.adminsSet.has(phoneNumber);
  if (rule === 'EMPLOYEE') return locals.employeesSet.has(phoneNumber);
  if (rule === 'CREATOR') return phoneNumber === requestersPhoneNumber;

  // for `ALL`
  return true;
};

const getEmployeeDataObject = (activityObject, phoneNumber) => {
  return {
    Name: activityObject.attachment.Name.value,
    Designation: activityObject.attachment.Designation.value,
    Department: activityObject.attachment.Department.value,
    'Employee Contact': phoneNumber,
    'Employee Code': activityObject.attachment['Employee Code'].value,
    'Base Location': activityObject.attachment['Base Location'].value,
    'First Supervisor': activityObject.attachment['First Supervisor'].value,
    'Second Supervisor': activityObject.attachment['Second Supervisor'].value,
    'Daily Start Time': activityObject.attachment['Daily Start Time'].value,
    'Daily End Time': activityObject.attachment['Daily End Time'].value,
    'Weekly Off': activityObject.attachment['Weekly Off'].value,
  };
};


const createObjects = (conn, locals) => {
  let totalDocsCreated = 0;
  const employeesData = {};
  let currentBatchIndex = 0;
  let batchDocsCount = 0;
  const batchFactories = [];
  const batchesArray = [];
  const timestamp = Date.now();
  const isEmployeeTemplate = conn.req.body.template === 'employee';
  const attachmentFieldsSet = new Set(Object.keys(locals.templateDoc.get('attachment')));
  const scheduleFieldsSet = new Set(locals.templateDoc.get('schedule'));
  const venueFieldsSet = new Set(locals.templateDoc.get('venue'));

  conn.req.body.data.forEach((item) => {
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

    const officeRef = locals.officeDoc.ref;
    const activityRef = rootCollections.activities.doc();
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

    const activityObject = {
      timestamp,
      addendumDocRef,
      schedule: [],
      venue: [],
      attachment: {},
      canEditRule: locals.templateDoc.get('canEditRule'),
      timezone: locals.officeDoc.get('attachment.Timezone.value'),
      creator: conn.requester.phoneNumber,
      hidden: locals.templateDoc.get('hidden'),
      office: locals.officeDoc.get('attachment.Name.value'),
      officeId: locals.officeDoc.id,
      status: locals.templateDoc.get('statusOnCreate'),
      template: locals.templateDoc.get('name'),
      activityName: getActivityName(params),
    };

    const objectFields = Object.keys(item);
    let scheduleCount = 0;

    objectFields.forEach((field) => {
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

      // TODO: Find how to handle schedule?
      if (isFromVenue) {
        activityObject.venue.push({
          venueDescriptor: field,
          location: '',
          address: '',
          geopoint: {
            latitude: '',
            longitude: '',
          },
        });
      }

      if (isEmployeeTemplate) {
        batchDocsCount++;
        totalDocsCreated++;

        const phoneNumber = activityObject.attachment['Employee Contact'].value;

        employeesData[phoneNumber] = getEmployeeDataObject(
          activityObject,
          phoneNumber
        );

        batch.set(locals.officeDoc.ref, {
          employeesData,
        }, {
            merge: true,
          });
      }
    });

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
      isSupportRequest: conn.requester.isSupportRequest,
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      provider: conn.req.body.geopoint.provider || null,
      isAdminRequest: true,
    };

    conn.req.body.share.forEach((phoneNumber) => {
      const ref = activityRef.collection('Assignees').doc(phoneNumber.trim());
      const addToInclude = conn.req.body.template === 'subscription'
        && phoneNumber !== activityObject.attachment.Subscriber.value;

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
    batchDocsCount += conn.req.body.share.length;
    totalDocsCreated += conn.req.body.share.length;
  });

  console.log({
    totalDocsCreated,
    numberOfBatches: batchFactories.length,
  });

  const responseObject = { data: conn.req.body.data, totalDocsCreated };

  // return commitData(conn, batchesArray, batchFactories, responseObject);
  return sendJSON(conn, responseObject);
};


const fetchDataForCanEditRule = (conn, locals) => {
  const rule = locals.templateDoc.get('canEditRule');

  if (rule !== 'ADMIN' && rule !== 'EMPLOYEE') {
    return createObjects(conn, locals);
  }

  return locals
    .officeDoc
    .ref
    .collection('Activities')
    .where('template', '==', rule.toLowerCase())
    .where('isCancelled', '==', false)
    .get()
    .then((docs) => {
      const set = new Set();

      docs.forEach((doc) => {
        const phoneNumber =
          doc.get('attachment.Employee Contact.value')
          || doc.get('attachment.Admin.value');

        set.add(phoneNumber);
      });

      return createObjects(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};


const handleUniqueness = (conn, locals) => {
  const hasName = locals.templateDoc.get('attachment').hasOwnProperty('Name');
  const hasNumber = locals.templateDoc.get('attachment').hasOwnProperty('Number');

  if (!hasName && !hasNumber) {
    return sendJSON(conn, conn.req.body.data);
  }

  const promises = [];
  let index = 0;
  const baseQuery = locals
    .officeDoc
    .ref
    .collection('Activities')
    .where('isCancelled', '==', false)
    .where('template', '==', conn.req.body.template);

  const param = (() => {
    if (hasNumber) {
      return 'Number';
    }

    return 'Name';
  })();

  conn.req.body.data.forEach((item) => {
    if (item.rejected) return;

    index++;

    const promise = baseQuery
      .where(`attachment.${param}.value`, '==', item.Name)
      .limit(1)
      .get();

    promises.push(promise);
  });

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        // Empty means that the person with the name doesn't exist. Allow creation
        if (snapShot.empty) return;

        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason =
          `${param}`
          + ` '${conn.req.body.data[index].Name || conn.req.body.data[index].Number}'`
          + ` is already in use`;
      });

      return fetchDataForCanEditRule(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};


const validateDataArray = (conn, locals) => {
  const employeesData = locals.officeDoc.get('employeesData') || {};
  locals.rejectionObjects = [];
  locals.successObjects = [];
  const scheduleFields = locals.templateDoc.get('schedule');
  const venueFields = locals.templateDoc.get('venue');
  const attachmentFieldsSet = new Set(Object.keys(locals.templateDoc.get('attachment')));
  const scheduleFieldsSet = new Set(scheduleFields);
  const allFieldsSet = new Set(
    [...attachmentFieldsSet],
    ...[...scheduleFields,
    ...venueFields]
  );

  // locals.allFieldsSet = allFieldsSet;

  let duplicateRowIndex;
  /** 
   * Set for managing uniques from the request body.
   * If any duplicate is found rejecting all data.
   */
  const uniques = new Set();
  let toRejectAll = false;

  const checkName = locals.templateDoc.get('attachment').hasOwnProperty('Name');
  const checkNumber = locals.templateDoc.get('attachment.').hasOwnProperty('Number');

  conn.req.body.data.forEach((dataObject, index) => {
    const objectProperties = Object.keys(dataObject);

    objectProperties.forEach((property) => {
      const value = dataObject[property];

      if (uniques.has(value)) {
        duplicateRowIndex = index + 1;
        toRejectAll = true;
      }

      if (checkName && !dataObject.hasOwnProperty('Name')) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Field 'Name' is missing`;

        return;
      }

      if (checkNumber && !dataObject.hasOwnProperty('Number')) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Field 'Number' is missing`;

        return;
      }

      if (!allFieldsSet.has(property)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Invalid property: '${property}'`;

        return;
      }

      if (scheduleFieldsSet.has(property)
        && !isValidDate(value)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `The field ${property}`
          + ` should be a valid unix timestamp`;

        return;
      }

      if (attachmentFieldsSet.has(property)) {
        const type = locals.templateDoc.get('attachment')[property].type;

        if (conn.req.body.template === 'employee'
          && property === 'Employee Contact'
          && employeesData.hasOwnProperty(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Phone number: ${value}`
            + ` already in use by someone else`;

          return;
        }

        if (conn.req.body.template === 'employee'
          && property === 'Employee Contact'
          && !isE164PhoneNumber(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Employee ${property}`
            + ` should be a valid phone number`;

          return;
        }

        if (type === 'number'
          && typeof value !== 'number') {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'string'
          && typeof value !== 'string') {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (property === 'Number'
          && !isNonEmptyString(value)
          && typeof value !== 'number') {
          uniques.add(value);

          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (property === 'Name'
          && !isNonEmptyString(value)) {
          uniques.add(value);

          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        console.log({
          value,
          isNonEmptyString: isNonEmptyString(value),
        });

        /** All fields past this check should only be checked if the value is non-empty string */
        if (!isNonEmptyString(value)) return;

        if (type === 'email'
          && !isValidEmail(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'weekday'
          && !weekdays.has(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'phoneNumber'
          && !isE164PhoneNumber(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'HH:MM'
          && !isHHMMFormat(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (type === 'base64'
          && typeof value !== 'string') {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }
      }
    });
  });

  if (toRejectAll) {
    return sendResponse(
      conn,
      code.badRequest,
      `Duplication found at index row: ${duplicateRowIndex}. 0 docs created.`
    );
  }

  // return handleUniqueness(conn, locals);

  return sendJSON(conn, conn.req.body.data);
};


module.exports = (conn) => {
  /**
   * Request body
   * office: string
   * timestamp: number
   * template: string
   * encoded: csvString
   * location: object(latitude, longitude)
   */
  if (!conn.requester.isSupportRequest) {
    const isAdmin = conn.requester.customClaims.admin
      && conn.requester.customClaims.admin.includes(conn.req.body.office);
    const canAccess = hasAdminClaims(conn.requester.customClaims);

    if (!isAdmin || !canAccess) {
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

  return Promise
    .all([
      rootCollections
        .offices
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        officeDocsQuery,
        templateDocsQuery,
      ] = result;

      if (officeDocsQuery.empty) {
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

      return validateDataArray(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};
