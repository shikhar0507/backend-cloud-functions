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

    if (!Array.isArray(item.share)) {
      return {
        success: false,
        message: `The field 'share' should be an array`,
      };
    }

    for (let index = 0; index < item.share.length; index++) {
      const phoneNumber = item.share[index];

      if (isE164PhoneNumber(phoneNumber)) continue;

      return {
        success: false,
        message: `${phoneNumber} is not a valid phone number`,
      };
    }

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


const commitData = (conn, batchesArray, batchFactories, responseObject) => {
  // For a single batch, no need to create batch factories
  if (batchesArray.length === 1) {
    return batchesArray[0]
      .commit()
      .catch((error) => handleError(conn, error));
  }

  return executeSequentially(batchFactories)
    .catch((error) => handleError(conn, error));
};


const createObjects = (conn, locals) => {
  let totalDocsCreated = 0;
  let currentBatchIndex = 0;
  let batchDocsCount = 0;
  const employeesData = {};
  const batchFactories = [];
  const batchesArray = [];
  const timestamp = Date.now();
  const isEmployeeTemplate = conn.req.body.template === 'employee';
  const attachmentFieldsSet = new Set(Object.keys(locals.templateDoc.get('attachment')));
  const scheduleFieldsSet = new Set(locals.templateDoc.get('schedule'));
  const venueFieldsSet = new Set(locals.templateDoc.get('venue'));

  conn.req.body.data.forEach((item, index) => {
    if (item.rejected) {

      return;
    }

    if (conn.req.body.template === 'employee'
      && locals.phoneNumbersToRejectSet.has(item['Employee Contact'])) {
      conn.req.body[index].rejected = true;
      conn.req.body[index].reason = `Phone number already in use`;

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

    console.log('attachmentFieldsSet', attachmentFieldsSet);

    objectFields.forEach((field) => {
      const value = item[field];
      const isFromAttachment = attachmentFieldsSet.has(field);
      const isFromSchedule = scheduleFieldsSet.has(field);
      const isFromVenue = venueFieldsSet.has(field);

      console.log('field', field);

      // if (isEmployeeTemplate
      //   && field === 'Employee Contact') {
      //   batchDocsCount++;
      //   totalDocsCreated++;

      //   // const phoneNumber = activityObject.attachment[field].value;

      //   employeesData[value] = getEmployeeDataObject(
      //     activityObject,
      //     value,
      //   );

      //   batch.set(locals.officeDoc.ref, {
      //     employeesData,
      //   }, {
      //       merge: true,
      //     });
      // }

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
    });

    if (isEmployeeTemplate) {
      const phoneNumber = activityObject.attachment['Employee Contact'].value;

      employeesData[phoneNumber] = getEmployeeDataObject(
        activityObject,
        phoneNumber,
      );

      batchDocsCount++;
      totalDocsCreated++;

      batch.set(locals.officeDoc.ref, {
        employeesData,
      }, {
          merge: true,
        });
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
      isSupportRequest: conn.requester.isSupportRequest,
      geopointAccuracy: conn.req.body.geopoint.accuracy || null,
      provider: conn.req.body.geopoint.provider || null,
      isAdminRequest: true,
    };

    locals
      .assigneesFromAttachment
      .get(index)
      .forEach((phoneNumber) => {
        conn.req.body.data[index].share.push(phoneNumber);
      });

    conn
      .req
      .body
      .data[index]
      .share.forEach((phoneNumber) => {
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
    batchDocsCount += conn.req.body.data[index].share.length;
    totalDocsCreated += conn.req.body.data[index].share.length;
  });

  console.log({
    totalDocsCreated,
    numberOfBatches: batchFactories.length,
  });

  const responseObject = { data: conn.req.body.data, totalDocsCreated };

  return commitData(conn, batchesArray, batchFactories, responseObject)

    // return Promise
    //   .resolve()
    .then(() => sendJSON(conn, responseObject))
    .catch((error) => handleError(conn, error));
};


const fetchDataForCanEditRule = (conn, locals) => {
  const rule = locals.templateDoc.get('canEditRule');

  if (rule !== 'ADMIN' && rule !== 'EMPLOYEE') {
    return Promise.resolve();
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

      return Promise.resolve();
    })
    .catch((error) => handleError(conn, error));
};

const handleEmployees = (conn, locals) => {
  const promises = [];

  locals
    .employeesToCheck
    .forEach((item) => {
      const promise = rootCollections
        .offices
        .doc(locals.officeDoc.id)
        .collection('Activities')
        .where('template', '==', 'employee')
        .where('attachment.Employee Contact.value', '==', item.phoneNumber)
        .where('attachment.Name.value', '==', item.name)
        // The `statusOnCreate` is most probably `CONFIRMED` in most cases.
        .where('status', '==', locals.templateDoc.get('statusOnCreate'))
        .limit(1)
        .get();

      promises.push(promise);
    });

  locals.phoneNumbersToRejectSet = new Set();

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('attachment.Name.value');

        locals
          .phoneNumbersToRejectSet
          .add(phoneNumber);
      });

      return Promise.resolve();
    })
    .catch((error) => handleError(conn, error));
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
    // return fetchDataForCanEditRule(conn, locals);
    return Promise.resolve();
  }

  const promises = [];
  let index = 0;
  const indexMap = new Map();
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
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        // Empty means that the person with the name/number doesn't exist.
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const nameOrNumber =
          doc.get('attachment.Name.value') || doc.get('attachment.Number.value');
        const index = indexMap.get(nameOrNumber);

        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `${param}`
          + ` '${conn.req.body.data[index].Name || conn.req.body.data[index].Number}'`
          + ` is already in use`;
      });

      return Promise.resolve();
    })
    .catch((error) => handleError(conn, error));
};

const handleSubscriptions = (conn, locals) => {
  if (conn.req.body.template !== 'subscription') {
    // return handleUniqueness(conn, locals);
    return Promise.resolve();
  }

  const promises = [];

  locals.subscriptionsToCheck.forEach((item) => {
    const {
      phoneNumber,
      template,
    } = item;

    const promise = locals
      .officeDoc
      .ref
      .collection('Activities')
      .where('isCancelled', '==', false)
      .where('template', '==', 'subscription')
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
        conn.req.body.data[index].reason = `${phoneNumber} already has ${template}`;
      });

      // return handleUniqueness(conn, locals);
      return Promise.resolve();
    })
    .catch((error) => handleError(conn, error));
};

const handleAdmins = (conn, locals) => {
  const promises = [];

  if (conn.req.body.template !== 'admin') {
    return Promise.resolve();
  }

  locals.adminToCheck.forEach((phoneNumber) => {
    promises.push(
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'admin')
        .where('attachment.Admin.value', '==', phoneNumber)
        .where('isCancelled', '==', false)
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
          conn.req.body.data[index].reason = `${phoneNumber} is already an Admin`;
        }
      });

      return Promise.resolve();
    })
    .catch((error) => handleError(conn, error));
};

const fetchValidTypes = (conn, locals) => {
  const promises = [];
  const nonExistingValuesSet = new Set();
  const queryMap = new Map();

  locals.verifyValidTypes.forEach((item, index) => {
    // console.log('value', value);
    const {
      value,
      type,
      field,
    } = item;

    queryMap.set(index, value);

    const promise = locals.officeDoc.ref.collection('Activities')
      .where('template', '==', type)
      .where(field, '==', value)
      .where('isCancelled', '==', false)
      .limit(1)
      .get();

    promises.push(promise);
  });

  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot, index) => {
        // doc should exist
        if (!snapShot.empty) return;

        // nonExistingValuesSet.add
        const nonExistingValue = queryMap.get(index);

        nonExistingValuesSet.add(nonExistingValue);
      });

      conn.req.body.data.forEach((object, index) => {
        const fields = Object.keys(object);

        fields.forEach((field) => {
          const value = object[field];

          if (!value) return;

          // console.log(value);
          if (nonExistingValuesSet.has(value)) {
            console.log(value);
            conn.req.body.data[index].rejected = true;
            conn.req.body.data[index].reason = `${field} ${value} doesn't exist`;
          }
        });
      });

      return Promise.resolve();
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
  const allFieldsArray = [
    ...attachmentFieldsSet,
    ...scheduleFields,
    ...venueFields,
  ];
  const allFieldsSet = new Set(allFieldsArray).add('share');
  let toRejectAll = false;
  let duplicateRowIndex = 0;
  /** 
   * Set for managing uniques from the request body.
   * If any duplicate is found rejecting all data.
   */
  const duplicatesSet = new Set();
  const subscriptionsMap = new Map();
  const namesToCheck = [];
  const employeesToCheck = [];
  const checkName = locals.templateDoc.get('attachment').hasOwnProperty('Name');
  const checkNumber = locals.templateDoc.get('attachment').hasOwnProperty('Number');
  const missingFieldsMap = new Map();
  const adminsSet = new Set();
  const adminToCheck = [];
  const verifyValidTypes = new Map();
  const subscriptionsToCheck = [];
  const namesSet = new Set();
  const numbersSet = new Set();
  const assigneesFromAttachment = new Map();

  conn.req.body.data.forEach((dataObject, index) => {
    let fieldsMissingInCurrentObject = false;

    const objectProperties = Object.keys(dataObject);
    /** TODO: This is O(n * m * q) loop most probably. Don't have
     * much time to fully optimize this properly.
     * Will do it later...
      */
    allFieldsArray.forEach((field) => {
      if (objectProperties.includes(field)) {
        return;
      }

      fieldsMissingInCurrentObject = true;

      if (missingFieldsMap.has(index)) {
        const fieldsSet = missingFieldsMap.get(index);

        fieldsSet.add(field);

        missingFieldsMap.set(index, fieldsSet);
      } else {
        missingFieldsMap.set(index, new Set().add(field));
      }
    });

    if (fieldsMissingInCurrentObject) {
      conn.req.body.data[index].rejected = true;
      conn.req.body.data[index].reason =
        `Missing fields: ${[...missingFieldsMap.get(index)]}`;

      return;
    }

    if (checkName || checkNumber) {
      const value = conn.req.body.data[index].Name || conn.req.body.data[index].Number;

      if (namesSet.has(value)) {
        toRejectAll = true;
      } else {
        namesSet.add(value);
      }
    }

    if (conn.req.body.template === 'subscription') {
      const phoneNumber = conn.req.body.data[index].Subscriber;
      const template = conn.req.body.data[index].Template;

      if (subscriptionsMap.has(phoneNumber)) {
        const set = subscriptionsMap.get(phoneNumber);

        if (set.has(template)) {
          toRejectAll = true;
        }

        set.add(template);

        subscriptionsMap.set(phoneNumber, set);
      } else {
        subscriptionsMap.set(phoneNumber, new Set().add(template));
      }

      subscriptionsToCheck.push({
        phoneNumber: conn.req.body.data[index].Subscriber,
        template: conn.req.body.data[index].Template,
      });
    }

    if (conn.req.body.template === 'admin') {
      const phoneNumber = conn.req.body.data[index].Admin;

      // Duplication
      if (adminsSet.has(phoneNumber)) {
        toRejectAll = true;
      } else {
        adminsSet.add(phoneNumber);
      }

      adminToCheck.push(phoneNumber);
    }

    if (conn.req.body.template === 'employee') {
      const firstSupervisor = conn.req.body.data[index]['First Supervisor'];
      const secondSupervisor = conn.req.body.data[index]['Second Supervisor'];

      if (!firstSupervisor && !secondSupervisor) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Please add at least one supervisor`;
      }
    }

    objectProperties.forEach((property) => {
      const value = dataObject[property];

      if (duplicatesSet.has(value)) {
        duplicateRowIndex = index + 1;
        toRejectAll = true;
      }

      if (!allFieldsSet.has(property)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Invalid property: '${property}'`;

        return;
      }

      if (value
        && scheduleFieldsSet.has(property)
        && !isValidDate(value)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `The field ${property}`
          + ` should be a valid unix timestamp`;

        return;
      }

      if (attachmentFieldsSet.has(property)) {
        const type = locals.templateDoc.get('attachment')[property].type;

        if (!validTypes.has(type) && value) {
          // Used for querying activities which should exist on the
          // basis of name
          verifyValidTypes.set(index, { value, type, field: property });
        }

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

        if (value && type === 'phoneNumber') {
          if (assigneesFromAttachment.has(index)) {
            const set = assigneesFromAttachment.get(index);

            set.add(value);

            assigneesFromAttachment.set(index, set);
          } else {
            assigneesFromAttachment.set(index, new Set().add(value));
          }
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
          duplicatesSet.add(value);

          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        if (property === 'Name'
          && !isNonEmptyString(value)) {
          duplicatesSet.add(value);

          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Invalid ${property} '${value}'`;

          return;
        }

        /** 
         * All fields past this check should only be checked if 
         * the value is non-empty string
         */
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

    if (checkName) {
      namesToCheck.push(conn.req.body.data[index].Name);
    }

    if (conn.req.body.template === 'employee') {
      employeesToCheck.push({
        name: conn.req.body.data[index].Name,
        phoneNumber: conn.req.body.data[index]['Employee Contact'],
      });
    }
  });

  locals.namesToCheck = namesToCheck;
  locals.employeesToCheck = employeesToCheck;
  locals.verifyValidTypes = verifyValidTypes;
  locals.adminToCheck = adminToCheck;
  locals.subscriptionsToCheck = subscriptionsToCheck;
  locals.assigneesFromAttachment = assigneesFromAttachment;

  if (toRejectAll) {
    return sendResponse(
      conn,
      code.badRequest,
      `Duplication found at row: ${duplicateRowIndex}. 0 docs created.`
    );
  }

  return fetchValidTypes(conn, locals)
    .then(() => handleAdmins(conn, locals))
    .then(() => handleSubscriptions(conn, locals))
    .then(() => handleUniqueness(conn, locals))
    .then(() => fetchDataForCanEditRule(conn, locals))
    .then(() => handleEmployees(conn, locals))
    .then(() => createObjects(conn, locals))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  /**
   * Request body
   * office: string
   * timestamp: number
   * template: string
   * encoded: csvString
   * location: `object(latitude, longitude)`
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