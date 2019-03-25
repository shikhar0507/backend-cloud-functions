'use strict';

const {
  rootCollections,
  db,
  deleteField,
  fieldPath,
  auth,
  users,
} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  isNonEmptyString,
  hasAdminClaims,
  isE164PhoneNumber,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const {
  reportNames,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');


const numberInAttachment = (phoneNumber, attachmentObject) => {
  const itemsArray = Object.keys(attachmentObject);
  let found = false;
  let fieldName;

  for (let i = 0; i < itemsArray.length; i++) {
    const intermediateFieldName = itemsArray[i];
    const { value, type } = attachmentObject[intermediateFieldName];

    if (type !== 'phoneNumber') continue;
    if (value !== phoneNumber) continue;

    fieldName = intermediateFieldName;
    found = true;

    break;
  }

  return {
    found,
    fieldName,
  };
};


const validateRequest = (body) => {
  const messageObject = {
    isValid: true,
    message: null,
  };

  if (!body.hasOwnProperty('oldPhoneNumber')) {
    messageObject.isValid = false;
    messageObject.message =
      `Request body is missing the field: 'oldPhoneNumber'`;

    return messageObject;
  }

  if (!body.hasOwnProperty('newPhoneNumber')) {
    messageObject.isValid = false;
    messageObject.message =
      `Request body is missing the field: 'newPhoneNumber'`;

    return messageObject;
  }

  if (!body.hasOwnProperty('office')) {
    messageObject.isValid = false;
    messageObject.message = `Request body is missing the field: 'office'`;

    return messageObject;
  }

  if (!isNonEmptyString(body.office)) {
    messageObject.isValid = false;
    messageObject.message = `The field 'office' should be a non-empty string`;

    return messageObject;
  }

  if (!isE164PhoneNumber(body.oldPhoneNumber)) {
    messageObject.isValid = false;
    messageObject.message = `The field 'oldPhoneNumber' should be`
      + ` a valid E.164 phone number`;

    return messageObject;
  }

  if (!isE164PhoneNumber(body.newPhoneNumber)) {
    messageObject.isValid = false;
    messageObject.message =
      `The field 'newPhoneNumber' should be`
      + ` a valid E.164 phone number`;

    return messageObject;
  }

  return messageObject;
};


const commitBatch = (conn, batch) => {
  return batch
    .commit()
    .then(() => sendResponse(conn, code.ok, 'Phone Number updated successfully.'))
    .catch((error) => handleError(conn, error));
};

const deleteAuth = (oldPhoneNumber) => {
  return users
    .getUserByPhoneNumber(oldPhoneNumber)
    .then((result) => result[oldPhoneNumber])
    .then((userRecord) => {
      if (!userRecord || !userRecord.uid) {
        return Promise.resolve();
      }

      return auth.deleteUser(userRecord.uid);
    });
};


const deleteAddendum = (conn, locals) => {
  const promises = [];

  locals
    .activityIdsSet
    .forEach((id) => {
      const promise = rootCollections
        .updates
        .where('activityId', '==', id)
        .where('user', '==', conn.req.body.oldPhoneNumber)
        .get();

      promises.push(promise);
    });

  // TODO: Handle > 500 docs here.
  return Promise
    .all(promises)
    .then((snapShots) => {
      snapShots
        .forEach(
          (snapShot) => snapShot.forEach((doc) => locals.batch.delete(doc.ref))
        );

      if (locals.toDeleteAuth) {
        return deleteAuth(conn.req.body.oldPhoneNumber);
      }

      return null;
    })
    .then(() => commitBatch(conn, locals.batch))
    .catch((error) => handleError(conn, error));
};


const updatePayroll = (conn, locals) => {
  return rootCollections
    .inits
    .where('office', '==', conn.req.body.office)
    .where('report', '==', reportNames.PAYROLL)
    .where('month', '==', locals.momentObject.month())
    .where('year', '==', locals.momentObject.year())
    .limit(1)
    .get()
    .then((snapShot) => {
      if (!snapShot.empty) {
        const initDoc = snapShot.docs[0];
        const payrollObject = initDoc.get('payrollObject');

        // The phone number may not necessarily be in the payroll object
        // because this object is generated a day after employee creation.
        if (payrollObject[conn.req.body.oldPhoneNumber]) {
          payrollObject[
            conn.req.body.newPhoneNumber
          ] = payrollObject[conn.req.body.oldPhoneNumber];

          payrollObject[conn.req.body.oldPhoneNumber] = deleteField();

          locals.batch.set(initDoc.ref, {
            payrollObject,
          }, {
              merge: true,
            });
        }
      }

      return deleteAddendum(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};


const updateActivities = (conn, locals) => {
  let iterations = 0;

  const runQuery = (query, resolve, reject) => {
    return query
      .get()
      .then((docs) => {
        if (docs.empty) {
          return [0];
        }

        const batch = db.batch();

        docs.forEach((doc) => {
          const activityId = doc.id;
          const rootActivityRef = rootCollections.activities.doc(activityId);
          const template = doc.get('template');
          const creator = doc.get('creator');
          const canEditRule = doc.get('canEditRule');
          const attachmentObject = doc.get('attachment');
          const phoneNumberInAttachment = numberInAttachment(
            conn.req.body.oldPhoneNumber,
            attachmentObject
          );

          locals.activityIdsSet.add(activityId);

          if (phoneNumberInAttachment.found) {
            const { fieldName } = phoneNumberInAttachment;

            console.log({ fieldName });

            attachmentObject[
              fieldName
            ].value = conn.req.body.newPhoneNumber;
          }

          const addToInclude = template !== 'subscription';
          const canEdit = (() => {
            if (canEditRule === 'CREATOR') {
              return creator === conn.req.body.newPhoneNumber;
            }

            if (canEditRule === 'ADMIN') {
              return locals.newPhoneNumberIsAdmin;
            }

            if (canEditRule === 'EMPLOYEE') {
              // If the new phone number is already an employee,
              // code the request will be rejected in the previous step.
              return false;
            }

            if (canEditRule === 'NONE') {
              return false;
            }

            // canEditRule is `ALL`
            return true;
          })();

          // Add new assignee
          batch
            .set(rootActivityRef
              .collection('Assignees')
              .doc(conn.req.body.newPhoneNumber), {
                canEdit,
                addToInclude,
              }, {
                merge: true,
              });

          // Remove old assignee
          batch
            .delete(rootActivityRef
              .collection('Assignees')
              .doc(conn.req.body.oldPhoneNumber));

          const newCreator = (() => {
            if (creator === conn.req.body.oldPhoneNumber) {
              return conn.req.body.newPhoneNumber;
            }

            return creator;
          })();

          // Update the main activity in root `Activities` collection
          locals.batch.set(rootActivityRef, {
            timestamp: Date.now(),
            addendumDocRef: null,
            attachment: attachmentObject,
            creator: newCreator,
          }, {
              merge: true,
            });
        });

        return Promise
          .all([
            Promise
              .resolve(docs.docs[docs.size - 1]),
            batch
              .commit(),
          ]);
      })
      .then((result) => {
        iterations++;

        const [lastDoc] = result;

        if (!lastDoc) return resolve();

        console.log({ lastDocId: lastDoc.id });

        return process
          .nextTick(() => {
            const newQuery = query
              // Using greater than sign because we need
              // to start after the last activity which was
              // processed by this code otherwise some activities
              // might be updated more than once.
              .where(fieldPath, '>', lastDoc.id);

            return runQuery(newQuery, resolve, reject);
          });
      })
      .catch(new Error(reject));
  };

  /**
   * Updating 200 activities at most in a singe loop
   * because firestore's batch only allows 500 docs to be 
   * updated at once.
   */
  const MAX_UPDATES_AT_ONCE = 200;
  const query = rootCollections
    .profiles
    .doc(conn.req.body.oldPhoneNumber)
    .collection('Activities')
    .where('office', '==', conn.req.body.office)
    .orderBy(fieldPath)
    .limit(MAX_UPDATES_AT_ONCE);

  console.log({ iterations });

  return new Promise((resolve, reject) => runQuery(query, resolve, reject))
    .then(() => {
      return console.log(locals.activityIdsSet);
    })
    .then(() => updatePayroll(conn, locals))
    .catch((error) => handleError(conn, error));
};


const checkForAdmin = (conn, locals) => {
  return rootCollections
    .offices
    .doc(locals.officeDoc.id)
    .collection('Activities')
    .where('status', '==', 'CONFIRMED')
    .where('attachment.Admin.value', '==', conn.req.body.newPhoneNumber)
    .limit(1)
    .get()
    .then((docs) => {
      // Not empty means the person is an admin
      locals.newPhoneNumberIsAdmin = !docs.empty;

      return updateActivities(conn, locals);
    })
    .catch(console.error);
};


const checkForEmployee = (conn, locals) => {
  const activitiesRef = rootCollections
    .offices
    .doc(locals.officeDoc.id)
    .collection('Activities');

  return Promise
    .all([
      activitiesRef
        .where('status', '==', 'CONFIRMED')
        .where('attachment.Employee Contact.value', '==', conn.req.body.oldPhoneNumber)
        .limit(1)
        .get(),
      activitiesRef
        .where('status', '==', 'CONFIRMED')
        .where('attachment.Employee Contact.value', '==', conn.req.body.newPhoneNumber)
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .doc(conn.req.body.oldPhoneNumber)
        .get(),
      rootCollections
        .profiles
        .doc(conn.req.body.newPhoneNumber)
        .get(),
      rootCollections
        .updates
        .where('phoneNumber', '==', conn.req.body.oldPhoneNumber)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        oldPhoneNumberQuery,
        newPhoneNumberQuery,
        oldUserProfile,
        newUserProfile,
        oldPhoneNumberUpdatesDocsQuery,
      ] = result;

      if (oldPhoneNumberQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `${conn.req.body.oldPhoneNumber} is not an employee`
        );
      }

      if (!newPhoneNumberQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `${conn.req.body.newPhoneNumber} is already in use by someone else`
        );
      }

      const employeeOf = oldUserProfile.get('employeeOf') || {};

      if (employeeOf[conn.req.body.office]) {
        locals.batch.set(oldUserProfile.ref, {
          employeeOf: {
            [conn.req.body.office]: deleteField(),
          },
        }, {
            merge: true,
          });

        locals.batch.set(newUserProfile.ref, {
          employeeOf: {
            [conn.req.body.office]: locals.officeDoc.id,
          },
        }, {
            merge: true,
          });
      }

      if (!oldPhoneNumberUpdatesDocsQuery.empty) {
        const updatesDoc = oldPhoneNumberUpdatesDocsQuery.docs[0];
        const officeList = Object.keys(employeeOf);

        locals
          .oldPhoneNumberUid = oldPhoneNumberUpdatesDocsQuery.docs[0].id;
        // If person is only in a single office, removing auth.
        locals
          .toDeleteAuth = officeList.length === 1;

        // Will be deleting this person's auth
        if (officeList.length === 1) {
          locals.batch.delete(updatesDoc.ref);
        }
      }

      const officeDocData = locals.officeDoc.data();
      const employeesData = locals.officeDoc.get('employeesData') || {};

      // This check is most probably reduntant
      if (employeesData[conn.req.body.oldPhoneNumber]) {
        const newDataObject = employeesData[conn.req.body.oldPhoneNumber];

        employeesData[
          conn.req.body.newPhoneNumber
        ] = newDataObject;

        if (newDataObject['Employee Contact']
          && newDataObject['Employee Contact'] === conn.req.body.oldPhoneNumber) {
          newDataObject['Employee Contact'] = conn.req.body.newPhoneNumber;
        }

        delete employeesData[conn.req.body.oldPhoneNumber];
      }

      officeDocData.employeesData = employeesData;

      locals.batch.set(locals.officeDoc.ref, officeDocData);

      return checkForAdmin(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};

module.exports = (conn) => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use POST`
    );
  }

  if (!conn.requester.isSupportRequest
    && !hasAdminClaims(conn.requester.customClaims)) {
    return sendResponse(
      conn,
      code.unauthorized,
      'You cannot access this resource'
    );
  }

  if (conn.requester.isSupportRequest) {
    if (!conn.req.body.hasOwnProperty('office')
      || !isNonEmptyString(conn.req.body.office)) {
      return sendResponse(
        conn,
        code.badRequest,
        `Invalid/Missing 'office' name in the request body`
      );
    }
  }

  const validationResult = validateRequest(conn.req.body);

  if (!validationResult.isValid) {
    return sendResponse(conn, code.badRequest, validationResult.message);
  }

  return rootCollections
    .offices
    .where('office', '==', conn.req.body.office)
    .limit(1)
    .get()
    .then((officeDocsQuery) => {
      if (officeDocsQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Office '${conn.req.body.office}' does not exist.`
        );
      }

      const locals = {
        batch: db.batch(),
        activityIdsSet: new Set(),
        officeDoc: officeDocsQuery.docs[0],
        timezone: officeDocsQuery.docs[0].get('attachment.Timezone.value'),
        momentObject: momentTz().tz(officeDocsQuery.docs[0].get('attachment.Timezone.value')),
      };

      return checkForEmployee(conn, locals);
    })
    .catch(console.error);
};
