'use strict';

const {
  rootCollections,
  db,
  deleteField,
  fieldPath,
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
    const { value, type } = itemsArray[i];
    if (type !== 'phoneNumber') continue;
    if (value !== phoneNumber) continue;

    fieldName = itemsArray;

    found = true;

    break;
  }

  return {
    found,
    fieldName,
  };
};

const commitBatch = (conn, batch) => {
  // return batch
  //   .commit()
  return Promise
    .resolve()
    .then(() => sendResponse(conn, code.ok, 'Phone Number updated successfully.'))
    .catch((error) => handleError(conn, error));
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

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots
        .forEach(
          (snapShot) => snapShot.forEach((doc) => locals.batch.delete(doc.ref))
        );

      return commitBatch(conn, locals.batch);
    })
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

        payrollObject[conn.req.body.newPhoneNumber] = payrollObject[conn.req.body.oldPhoneNumber];
        payrollObject[conn.req.body.oldPhoneNumber] = deleteField();

        locals.batch.set(initDoc.ref, {
          payrollObject,
        }, {
            merge: true,
          });
      }

      return deleteAddendum(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};


const fetchActivities = (conn, locals) => {
  const runQuery = (query, resolve, reject) => {
    return query
      .get()
      .then((docs) => {
        if (docs.empty) {
          return 0;
        }

        const batch = db.batch();

        docs.forEach((doc) => {
          locals.activityIdsSet.add(doc.id);

          const activityId = doc.id;
          const template = doc.get('template');
          const creator = doc.get('creator');
          const canEditRule = doc.get('canEditRule');
          const rootActivityRef = rootCollections.activities.doc(activityId);
          const attachmentObject = doc.get('attachment');
          const inAttachment =
            numberInAttachment(conn.req.body.oldPhoneNumber, attachmentObject);

          if (inAttachment.found) {
            attachmentObject[inAttachment.fieldName].value = conn.req.body.newPhoneNumber;

            locals.batch.set(rootActivityRef, {
              timestamp: Date.now(),
              addendumDocRef: null,
              attachmentObject: attachmentObject,
            }, {
                merge: true,
              });
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

            if (canEditRule === 'NONE') return false;

            // canEditRule is `ALL`
            return true;
          })();

          batch
            .set(rootActivityRef
              .collection('Assignees')
              .doc(conn.req.body.newPhoneNumber), {
                canEdit,
                addToInclude,
              });

          batch
            .delete(rootActivityRef
              .collection('Assignees')
              .doc(conn.req.body.oldPhoneNumber));

          console.log({ activityId });
        });

        /* eslint-disable */
        // return batch
        //   .commit()
        //   .then(() => docs.docs[docs.size - 1]);
        return Promise
          .resolve()
          .then(() => docs.docs[docs.size - 1]);
        /* eslint-enable */
      })
      .then((lastDoc) => {
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

  const query = rootCollections
    .profiles
    .doc(conn.req.body.oldPhoneNumber)
    .collection('Activities')
    .where('office', '==', conn.req.body.office)
    .orderBy(fieldPath)
    .limit(200);

  return new Promise((resolve, reject) => runQuery(query, resolve, reject))
    .then(() => updatePayroll(conn, locals))
    .catch((error) => handleError(conn, error));
};


const checkForAdmin = (conn, locals) => {
  return rootCollections
    .offices
    .doc(locals.officeDoc.id)
    .collection('Activities')
    .where('attachment.Admin.value', '==', conn.req.body.newPhoneNumber)
    .limit(1)
    .get()
    .then((docs) => {
      // Not empty means the person is an admin
      locals.newPhoneNumberIsAdmin = !docs.empty;

      return fetchActivities(conn, locals);
    })
    .catch(console.error);
};


const checkForEmployee = (conn, locals) => {
  const activitiesRef = rootCollections
    .offices
    .doc(locals.officeDoc.id)
    .collection('Activities');

  Promise
    .all([
      activitiesRef
        .where('isCancelled', '==', false)
        .where('attachment.Employee Contact.value', '==', conn.req.body.oldPhoneNumber)
        .limit(1)
        .get(),
      activitiesRef
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
    ])
    .then((result) => {
      const [
        oldPhoneNumberQuery,
        newPhoneNumberQuery,
        oldUserProfile,
        newUserProfile,
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

      return checkForAdmin(conn, locals);
    })
    .catch((error) => handleError(conn, error));
};


const validateRequest = (body) => {
  const messageObject = {
    isValid: true,
    message: null,
  };

  if (!body.hasOwnProperty('oldPhoneNumber')) {
    messageObject.isValid = false;
    messageObject.message = `Request body is missing the field: 'oldPhoneNumber'`;

    return messageObject;
  }

  if (!body.hasOwnProperty('newPhoneNumber')) {
    messageObject.isValid = false;
    messageObject.message = `Request body is missing the field: 'newPhoneNumber'`;

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
    messageObject.message = `The field 'oldPhoneNumber' should be a valid E.164 phone number`;

    return messageObject;
  }

  if (!isE164PhoneNumber(body.newPhoneNumber)) {
    messageObject.isValid = false;
    messageObject.message = `The field 'newPhoneNumber' should be a valid E.164 phone number`;

    return messageObject;
  }

  return messageObject;
};


module.exports = (conn) => {
  if (conn.req.method !== 'PUT') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use PUT`
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
