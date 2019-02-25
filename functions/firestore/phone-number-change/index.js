'use strict';

const {
  rootCollections,
  db,
  deleteField,
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

const commitBatch = (conn, batch) => batch
  .commit()
  .then(() => sendResponse(conn, code.ok, 'Phone Number updated successfully.'))
  .catch((error) => handleError(conn, error));


const deleteAddendum = (conn, locals) => {
  const promises = [];

  locals.activityIdsSet.forEach((id) => {
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
  /**
   * canEditRules
   * ADMIN,
   * EMPLOYEE,
   * CREATOR,
   */

  locals.activityIdsSet = new Set();

  return rootCollections
    .profiles
    .doc(conn.req.body.oldPhoneNumber)
    .collection('Activities')
    .where('office', '==', conn.req.body.office)
    .get()
    .then((snapShot) => {
      snapShot.forEach((doc) => {
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

        locals.batch.set(rootActivityRef.collection('Assignees').doc(conn.req.body.newPhoneNumber), {
          canEdit,
          addToInclude,
        });

        locals.batch.delete(rootActivityRef.collection('Assignees').doc(conn.req.body.oldPhoneNumber));
      });

      return updatePayroll(conn, locals);
    })
    .catch((error) => handleError(conn, error));
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
    ])
    .then((result) => {
      const [
        oldPhoneNumberQuery,
        newPhoneNumberQuery,
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

      return fetchActivities(conn, locals);
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

  if (!body.hasOwnProperty('oldPhoneNumber')) {
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
  /**
   * Flow
   * 
   * if oldPhoneNumber is not an employee
   *   reject
   * if the requester is not an admin of the office
   *   reject
   */

  if (!conn.requester.isSupportRequest
    && !hasAdminClaims(conn.requester.customClaims)) {
    return sendResponse(conn, code.unauthorized, 'You cannot access this resource');
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
        officeDoc: officeDocsQuery.docs[0],
        timezone: officeDocsQuery.docs[0].get('attachment.Timezone.value'),
        momentObject: momentTz().tz(officeDocsQuery.docs[0].get('attachment.Timezone.value')),
      };

      return checkForEmployee(conn, locals);
    })
    .catch(console.error);
};
