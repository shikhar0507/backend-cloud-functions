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
  isNonEmptyString,
  isE164PhoneNumber,
} = require('../../admin/utils');
const {
  alphabetsArray,
} = require('../../firestore/recipients/report-utils');
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
const xlsxPopulate = require('xlsx-populate');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const fs = require('fs');


const templateNamesObject = {
  ADMIN: 'admin',
  SUBSCRIPTION: 'subscription',
  EMPLOYEE: 'employee',
  OFFICE: 'office',
  RECIPIENT: 'recipient',
};

const handleValidation = (body) => {
  const result = { success: true, message: null };

  const messageString = (field) =>
    `Invalid/Missing field '${field}' from the request body`;

  if (body.template !== templateNamesObject.OFFICE
    && !isNonEmptyString(body.office)) {
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

  if (body.data.length === 0) {
    return {
      success: false,
      message: `Data cannot be empty`,
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

const sendXLSXToCreaator = (conn, locals, responseObject) => {
  const fileName = `${conn.req.body.template}--${conn.req.body.office}.xlsx`;
  const filePath = `/tmp/${fileName}`;
  const messageObject = {
    to: {
      name: conn.requester.displayName,
      email: conn.req.body.senderEmail || conn.requester.email,
    },
    from: {
      name: 'Growthfile',
      email: env.systemEmail,
    },
    html: '<h1>Docs created</h1>',
    subject: `Bulk Creation of ${conn.req.body.template} result`,
    attachments: [],
  };

  if (!messageObject.to) {
    return Promise.resolve(responseObject);
  }

  const items = responseObject.data;

  return xlsxPopulate
    .fromBlankAsync()
    .then((workbook) => {
      const resultSheet = workbook.sheet('Sheet1');
      const firstItem = items[0];
      const objectFields = Object.keys(firstItem);

      resultSheet
        .row(1)
        .style('bold', true);

      locals
        .allFieldsArray
        .forEach((value, index) => {
          resultSheet.cell(`${alphabetsArray[index]}1`).value(value);
        });

      items.forEach((item, outerIndex) => {
        // const alphabet =
        objectFields.forEach((field, innerIndex) => {
          if (field === 'share') {
            return;
          }

          const idx = `${alphabetsArray[innerIndex]}${outerIndex + 2}`;
          const val = item[field];

          resultSheet.cell(idx).value(val);
        });
      });

      locals.mySheet = workbook;

      return workbook.toFileAsync(filePath);
    })
    .then(() => {
      messageObject
        .attachments
        .push({
          fileName,
          content: fs.readFileSync(filePath).toString('base64'),
          type: 'text/csv',
          disposition: 'attachment',
        });

      return sgMail.sendMultiple(messageObject);
    })
    .then(() => Promise.resolve(responseObject))
    .catch((error) => {
      console.error(error.toString());
    });
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

const commitData = (conn, batchesArray, batchFactories) => {
  // For a single batch, no need to create batch factories
  if (batchesArray.length === 1) {
    return batchesArray[0]
      .commit()
      .catch((error) => handleError(conn, error));
  }

  return executeSequentially(batchFactories)
    .catch((error) => handleError(conn, error));
};

const createObjects = (conn, locals, trialRun) => {
  let totalDocsCreated = 0;
  let currentBatchIndex = 0;
  let batchDocsCount = 0;
  const employeesData = {};
  const batchFactories = [];
  const batchesArray = [];
  const timestamp = Date.now();
  const childActivitiesBatch = db.batch();
  const isEmployeeTemplate =
    conn.req.body.template === templateNamesObject.EMPLOYEE;
  const isOfficeTemplate =
    conn.req.body.template === templateNamesObject.OFFICE;
  const attachmentFieldsSet = new Set(Object.keys(locals.templateDoc.get('attachment')));
  const scheduleFieldsSet = new Set(locals.templateDoc.get('schedule'));
  const venueFieldsSet = new Set(locals.templateDoc.get('venue'));

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

        activityObject.adjustedGeopoints = [];
      }
    });

    if (isEmployeeTemplate) {
      const phoneNumber = activityObject.attachment['Employee Contact'].value;

      employeesData[phoneNumber] = getEmployeeDataObject(
        activityObject,
        phoneNumber
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
        .forEach((phoneNumber) => {
          conn.req.body.data[index].share.push(phoneNumber);
        });
    }

    conn
      .req
      .body
      .data[index]
      .share
      .forEach((phoneNumber) => {
        const ref = activityRef.collection('Assignees').doc(phoneNumber.trim());
        const addToInclude = conn.req.body.template === templateNamesObject.SUBSCRIPTION
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

    if (isOfficeTemplate) {
      const allPhoneNumbers = locals.officeContacts.get(index) || [];

      allPhoneNumbers.forEach((phoneNumber) => {
        // For each phoneNumber, create subscription and assignee
        const adminActivityRef =
          rootCollections
            .activities
            .doc();
        const subscriptionActivityRef =
          rootCollections
            .activities
            .doc();
        const adminAddendumRef =
          rootCollections
            .offices
            .doc(officeId)
            .collection('Addendum')
            .doc();
        const subscriptionAddendumRef =
          rootCollections
            .offices
            .doc(officeId)
            .collection('Addendum')
            .doc();

        const subscriptionActivityData = {
          office,
          timezone,
          officeId,
          timestamp,
          addendumDocRef,
          schedule: [],
          venue: [],
          attachment: {
            Subscriber: {
              value: phoneNumber,
              type: 'phoneNumber',
            },
            Template: {
              value: templateNamesObject.SUBSCRIPTION,
              type: 'string',
            },
          },
          canEditRule: locals.subscriptionTemplateDoc.get('canEditRule'),
          creator: conn.requester.phoneNumber,
          hidden: locals.subscriptionTemplateDoc.get('hidden'),
          status: locals.subscriptionTemplateDoc.get('statusOnCreate'),
          template: templateNamesObject.SUBSCRIPTION,
          activityName: `SUBSCRIPTION: ${phoneNumber}`,
          createTimestamp: Date.now(),
          forSalesReport: false,
        };
        const subscriptionAddendumData = {
          timestamp,
          activityData: subscriptionActivityData,
          user: conn.requester.phoneNumber,
          userDisplayName: conn.requester.displayName,
          action: httpsActions.create,
          template: templateNamesObject.SUBSCRIPTION,
          location: getGeopointObject(conn.req.body.geopoint),
          userDeviceTimestamp: conn.req.body.timestamp,
          activityId: subscriptionActivityRef.id,
          activityName: subscriptionActivityData.activityName,
          geopointAccuracy: conn.req.body.geopoint.accuracy || null,
          provider: conn.req.body.geopoint.provider || null,
          isSupportRequest: locals.isSupportRequest,
          isAdminRequest: locals.isAdminRequest,
        };
        const adminActivityData = {
          office,
          timezone,
          officeId,
          timestamp,
          addendumDocRef,
          schedule: [],
          venue: [],
          attachment: {
            Admin: {
              value: phoneNumber,
              type: 'phoneNumber',
            },
          },
          canEditRule: locals.adminTemplateDoc.get('canEditRule'),
          creator: conn.requester.phoneNumber,
          hidden: locals.adminTemplateDoc.get('hidden'),
          status: locals.adminTemplateDoc.get('statusOnCreate'),
          template: templateNamesObject.ADMIN,
          activityName: `ADMIN: ${phoneNumber}`,
          createTimestamp: Date.now(),
          forSalesReport: false,
        };
        const adminAddendumData = {
          timestamp,
          activityData: adminActivityData,
          user: conn.requester.phoneNumber,
          userDisplayName: conn.requester.displayName,
          action: httpsActions.create,
          template: templateNamesObject.ADMIN,
          location: getGeopointObject(conn.req.body.geopoint),
          userDeviceTimestamp: conn.req.body.timestamp,
          activityId: adminActivityRef.id,
          activityName: adminActivityData.activityName,
          isSupportRequest: locals.isSupportRequest,
          isAdminRequest: locals.isAdminRequest,
          geopointAccuracy: conn.req.body.geopoint.accuracy || null,
          provider: conn.req.body.geopoint.provider || null,
        };

        childActivitiesBatch
          .set(subscriptionActivityRef, adminActivityData);
        childActivitiesBatch
          .set(subscriptionAddendumRef, subscriptionAddendumData);
        childActivitiesBatch
          .set(adminAddendumRef, adminAddendumData);
        childActivitiesBatch
          .set(adminActivityRef, subscriptionActivityData);

        childActivitiesBatch
          .set(adminActivityRef
            .collection('Assignees')
            .doc(phoneNumber), {
              canEdit: true,
              addToInclude: true,
            });

        childActivitiesBatch
          .set(subscriptionActivityRef
            .collection('Assignees')
            .doc(phoneNumber), {
              canEdit: true,
              addToInclude: false,
            });

        totalDocsCreated += 6;
        batchDocsCount += 6;
        conn
          .req
          .body
          .data[index]
          .share.forEach((number) => {
            totalDocsCreated += 2;
            batchDocsCount += 2;

            childActivitiesBatch
              .set(adminActivityRef
                .collection('Assignees')
                .doc(number), {
                  canEdit: true,
                  addToInclude: true,
                });

            childActivitiesBatch
              .set(subscriptionActivityRef
                .collection('Assignees')
                .doc(number), {
                  canEdit: true,
                  addToInclude: true,
                });
          });
      });
    }

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

  const responseObject = {
    totalDocsCreated,
    numberOfBatches: batchFactories.length,
    data: conn.req.body.data,
  };

  /** For testing out code */
  if (trialRun) {
    return Promise.resolve(responseObject);
  }

  return commitData(conn, batchesArray, batchFactories)
    .then(() => childActivitiesBatch.commit())
    .then(() => responseObject)
    .catch((error) => handleError(conn, error));
};

const fetchDataForCanEditRule = (conn, locals) => {
  const rule = locals.templateDoc.get('canEditRule');

  if (rule !== 'ADMIN' && rule !== 'EMPLOYEE') {
    return Promise.resolve();
  }

  /** Office's canEditRule is `NONE`. No handling required here */
  return locals
    .officeDoc
    .ref
    .collection('Activities')
    .where('template', '==', rule.toLowerCase())
    .where('status', '==', 'CONFIRMED')
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

  if (conn.req.body.template !== templateNamesObject.EMPLOYEE) {
    return Promise.resolve();
  }

  locals
    .employeesToCheck
    .forEach((item) => {
      const promise = rootCollections
        .offices
        .doc(locals.officeDoc.id)
        .collection('Activities')
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
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const phoneNumber = doc.get('attachment.Name.value');

        phoneNumbersToRejectSet.add(phoneNumber);
      });

      conn.req.body.data.forEach((item, index) => {
        const phoneNumber = item['Employee Contact'];

        if (phoneNumbersToRejectSet.has(phoneNumber)) {
          conn.req.body[index].rejected = true;
          conn.req.body[index].reason = `Phone number already in use`;
        }
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
    return Promise.resolve();
  }

  const promises = [];
  let index = 0;
  const indexMap = new Map();
  const baseQuery = (() => {
    if (conn.req.body.template === templateNamesObject.OFFICE) {
      return rootCollections.offices;
    }

    return locals
      .officeDoc
      .ref
      .collection('Activities')
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', conn.req.body.template);
  })();

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
      .where('attachment.Name.value', '==', item.Name || item.Number)
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
        const value =
          conn.req.body.data[index].Name
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
    })
    .catch((error) => handleError(conn, error));
};

const handleSubscriptions = (conn, locals) => {
  if (conn.req.body.template !== templateNamesObject.SUBSCRIPTION) {
    return Promise.resolve();
  }

  const promises = [];

  locals
    .subscriptionsToCheck
    .forEach((item) => {
      const {
        phoneNumber,
        template,
      } = item;

      const promise = locals
        .officeDoc
        .ref
        .collection('Activities')
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
          `${phoneNumber} already has '${template}'`;
      });

      return Promise.resolve();
    })
    .catch((error) => handleError(conn, error));
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
          locals
            .officeDoc
            .ref
            .collection('Activities')
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
    })
    .catch((error) => handleError(conn, error));
};

const fetchValidTypes = (conn, locals) => {
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

      const promise = locals
        .officeDoc
        .ref
        .collection('Activities')
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
    })
    .catch((error) => handleError(conn, error));
};

const fetchTemplates = (conn, locals) => {
  if (conn.req.body.template !== templateNamesObject.OFFICE) {
    return Promise.resolve();
  }

  return Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', templateNamesObject.ADMIN)
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', templateNamesObject.SUBSCRIPTION)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        adminTemplateQuery,
        subscriptionTemplateQuery,
      ] = result;

      locals.subscriptionTemplateDoc = subscriptionTemplateQuery.docs[0];
      locals.adminTemplateDoc = adminTemplateQuery.docs[0];

      return Promise.resolve();
    })
    .catch((error) => handleError(conn, error));
};

const validateDataArray = (conn, locals) => {
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
  const assigneesFromAttachment = new Map();
  const officeContacts = new Map();
  locals.rejectionObjects = [];
  locals.successObjects = [];

  conn.req.body.data.forEach((dataObject, index) => {
    let fieldsMissingInCurrentObject = false;

    const objectProperties = Object.keys(dataObject);
    /**
     * TODO: This is O(n * m * q) loop most probably. Don't have
     * much time to fully optimize this properly.
     * Will do it later...
     */
    allFieldsArray.forEach((field) => {
      if (objectProperties.includes(field)) {
        return;
      }

      if (missingFieldsMap.has(index)) {
        const fieldsSet = missingFieldsMap.get(index);

        fieldsSet.add(field);

        missingFieldsMap.set(index, fieldsSet);
      } else {
        missingFieldsMap.set(index, new Set().add(field));
      }

      fieldsMissingInCurrentObject = true;
    });

    if (conn.req.body.template !== templateNamesObject.OFFICE) {
      const firstContact = locals.officeDoc.get('attachment.First Contact.value');
      const secondContact = locals.officeDoc.get('attachment.Second Contact.value');

      if (firstContact) {
        conn.req.body.data[index].share.push(firstContact);
      }

      if (secondContact) {
        conn.req.body.data[index].share.push(secondContact);
      }
    }

    if (fieldsMissingInCurrentObject) {
      conn.req.body.data[index].rejected = true;
      conn.req.body.data[index].reason =
        `Missing fields: ${[...missingFieldsMap.get(index)]}`;

      /** Setting false for next iteration. */
      fieldsMissingInCurrentObject = false;

      return;
    }

    if (checkName || checkNumber) {
      const value =
        conn.req.body.data[index].Name
        || conn.req.body.data[index].Number;

      if (namesSet.has(value)) {
        duplicateRowIndex = index + 1;

        console.log('duplicate', value);
        toRejectAll = true;
      } else {
        namesSet.add(value);
      }
    }

    if (conn.req.body.template === templateNamesObject.OFFICE) {
      const firstContact = conn.req.body.data[index]['First Contact'];
      const secondContact = conn.req.body.data[index]['Second Contact'];
      const timezone = conn.req.body.data[index].Timezone;

      if (firstContact === secondContact) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason =
          `Both contacts cannot be the same or empty`;
      }

      if (!firstContact && !secondContact) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `At least one contact is required`;
      }

      if (!timezone || !timezonesSet.has(timezone)) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason = `Invalid/Missing timezone`;
      }

      const contacts = [];

      if (firstContact) contacts.push(firstContact);
      if (secondContact) contacts.push(secondContact);

      officeContacts.set(index, contacts);
    }

    if (conn.req.body.template === templateNamesObject.EMPLOYEE
      && locals.officeDoc.get('employeesData')) {
      const phoneNumber = conn.req.body.data['Employee Contact'];
      const alreadyExists = locals.officeDoc.get('employeesData').hasOwnProperty(phoneNumber);

      if (alreadyExists) {
        conn.req.body.data[index].rejected = true;
        conn.req.body.data[index].reason =
          `${phoneNumber} is already an employee`;
      }
    }

    if (conn.req.body.template === templateNamesObject.SUBSCRIPTION) {
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

      /** Subscription of template office and subscription is not allowed for everyone */
      if (template === 'office' || template === templateNamesObject.SUBSCRIPTION) {
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

        if (set.has(template)) {
          duplicateRowIndex = index + 1;
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

    if (conn.req.body.template === templateNamesObject.ADMIN) {
      const phoneNumber = conn.req.body.data[index].Admin;

      // Duplication
      if (adminsSet.has(phoneNumber)) {
        duplicateRowIndex = index + 1;
        toRejectAll = true;
      } else {
        adminsSet.add(phoneNumber);
      }

      adminToCheck.push(phoneNumber);
    }

    if (conn.req.body.template === templateNamesObject.EMPLOYEE) {
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

        if (conn.req.body.template === templateNamesObject.EMPLOYEE
          && property === 'Employee Contact'
          && locals.officeDoc.get('employeesData')
          /** Employee already exists */
          && locals.officeDoc.get('employeesData').hasOwnProperty(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Phone number: ${value}`
            + ` already in use by ${locals.officeDoc.get('employeesData')[value].Name}`;

          return;
        }

        if (conn.req.body.template === templateNamesObject.EMPLOYEE
          && property === 'Employee Contact'
          && !isE164PhoneNumber(value)) {
          conn.req.body.data[index].rejected = true;
          conn.req.body.data[index].reason = `Employee ${property}`
            + ` should be a valid phone number`;

          return;
        }

        if (value
          && type === 'phoneNumber') {
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
         * the value is non-empty string because they are not
         * required.
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

    if (conn.req.body.template === templateNamesObject.EMPLOYEE) {
      employeesToCheck.push({
        name: conn.req.body.data[index].Name,
        phoneNumber: conn.req.body.data[index]['Employee Contact'],
      });
    }
  });

  conn.req.body.data.forEach((_, index) => {
    if (!assigneesFromAttachment.has(index)
      && conn.req.body.data[index].share.length === 0
      /**
       * If the object has already been rejected for some reason,
       * it's assigneesFromAttachment map will most probably be empty.
       * In that case, the rejection message will show 'No assignees found'
       * even if the rejection was because of some other issue in
       * the object.
       */
      && !conn.req.body.data[index].rejected) {
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

  if (toRejectAll) {
    return sendResponse(
      conn,
      code.badRequest,
      `Duplication found at row: ${duplicateRowIndex}. 0 docs created.`
    );
  }

  /** Only support can use `trailRun` */
  const trialRun = conn.requester.isSupportRequest
    && conn.req.query.trialRun === 'true';

  return fetchValidTypes(conn, locals)
    .then(() => fetchTemplates(conn, locals))
    .then(() => handleAdmins(conn, locals))
    .then(() => handleSubscriptions(conn, locals))
    .then(() => handleUniqueness(conn, locals))
    .then(() => fetchDataForCanEditRule(conn, locals))
    .then(() => handleEmployees(conn, locals))
    .then(() => createObjects(conn, locals, trialRun))
    // .then((responseObject) => sendExcelFromResponse(conn, locals, responseObject))
    .then((responseObject) => sendJSON(conn, responseObject))
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
    if (!conn.requester.customClaims.admin
      || !conn.requester.customClaims.admin.includes(conn.req.body.office)) {
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

  if (conn.req.body.template === templateNamesObject.SUBSCRIPTION) {
    const promise = rootCollections
      .activityTemplates
      .get();

    promises.push(promise);
  }

  return Promise
    .all(promises)
    .then((result) => {
      const [
        officeDocsQuery,
        templateDocsQuery,
        templatesCollectionQuery,
      ] = result;

      if (conn.req.body.template !== templateNamesObject.OFFICE
        && officeDocsQuery.empty) {
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

      if (conn.req.body.template === templateNamesObject.SUBSCRIPTION) {
        const templateNamesSet = new Set();

        templatesCollectionQuery
          .forEach((doc) => templateNamesSet.add(doc.get('name')));

        locals.templateNamesSet = templateNamesSet;
      }

      /**
       * Ignoring objects where all fields have empty
       * strings as the value.
       */
      conn.req.body.data.forEach((object, index) => {
        if (!isEmptyObject(object)) {
          return;
        }

        delete conn.req.body.data[index];
      });

      const isSupportRequest = conn.requester.isSupportRequest;
      const isAdminRequest = !isSupportRequest
        && conn.requester.customClaims.admin
        && conn.requester.customClaims.admin.length > 0;

      locals.isSupportRequest = isSupportRequest;
      locals.isAdminRequest = isAdminRequest;

      return validateDataArray(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};
