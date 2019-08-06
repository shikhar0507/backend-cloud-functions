'use strict';

const {
  rootCollections,
  // db,
  // auth,
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
  httpsActions,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
// const admin = require('firebase-admin');

// const deleteAuth = async uid => {
//   try {
//     return auth.deleteUser(uid);
//   } catch (error) {
//     console.warn(error);
//     return {};
//   }
// };

// const getAuth = async phoneNumber => {
//   try {
//     return auth.getUserByPhoneNumber(phoneNumber);
//   } catch (error) {
//     console.warn(error);

//     return {
//       phoneNumber: {},
//     };
//   }
// };

// const deleteUpdates = async uid => {
//   if (!uid) return Promise.resolve();

//   const batch = db.batch();

//   batch
//     .delete(rootCollections.updates.doc(uid));

//   const docs = await rootCollections
//     .updates
//     .doc(uid)
//     .collection('Addendum')
//     .get();

//   docs.forEach(doc => {
//     batch.delete(doc.ref);
//   });

//   return Promise
//     .all([
//       batch.commit(),
//       deleteAuth(uid)
//     ]);
// };


const validateRequest = body => {
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


module.exports = async conn => {
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
      `You cannot access this resource`
    );
  }

  const validationResult = validateRequest(conn.req.body);

  if (!validationResult.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      validationResult.message
    );
  }

  if (conn.requester.phoneNumber
    === conn.req.body.oldPhoneNumber) {
    return sendResponse(
      conn,
      code.forbidden,
      `You cannot change your own phone number`
    );
  }

  if (conn.req.body.oldPhoneNumber
    === conn.req.body.newPhoneNumber) {
    return sendResponse(
      conn,
      code.badRequest,
      'Old and the new phone number cannot be the same.'
    );
  }

  const baseQuery = rootCollections
    .activities
    .where('office', '==', conn.req.body.office)
    .where('status', '==', 'CONFIRMED')
    .where('template', '==', 'employee');

  const promises = [
    baseQuery
      .where('attachment.Employee Contact.value', '==', conn.req.body.oldPhoneNumber)
      .limit(1)
      .get(),
    baseQuery
      .where('attachment.Employee Contact.value', '==', conn.req.body.newPhoneNumber)
      .limit(1)
      .get(),
  ];

  try {
    const [
      oldEmployeeQueryResult,
      newEmployeeQueryResult,
    ] = await Promise.all(promises);

    if (oldEmployeeQueryResult.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `${conn.req.body.oldPhoneNumber} is not an employee`
      );
    }

    if (!newEmployeeQueryResult.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `${conn.req.body.oldPhoneNumber} is already an employee`
      );
    }

    const employeeActivity = oldEmployeeQueryResult.docs[0];

    await employeeActivity
      .ref
      .set({
        addendumDocRef: null,
        timestamp: Date.now(),
        attachment: {
          'Employee Contact': {
            value: conn.req.body.newPhoneNumber,
          },
        },
      }, {
          merge: true,
        });

    const timezone = oldEmployeeQueryResult.docs[0].get('timezone');
    const momentToday = momentTz().tz(timezone);
    const officeId = oldEmployeeQueryResult
      .docs[0]
      .get('officeId');

    await rootCollections
      .offices
      .doc(officeId)
      .collection('Addendum')
      .doc()
      .set({
        date: momentToday.date(),
        month: momentToday.month(),
        year: momentToday.year(),
        timestamp: Date.now(),
        user: conn.requester.phoneNumber,
        action: httpsActions.updatePhoneNumber,
        oldPhoneNumber: conn.req.body.oldPhoneNumber,
        newPhoneNumber: conn.req.body.newPhoneNumber,
        isSupportRequest: conn.requester.isSupportRequest || false,
      });

    return sendResponse(
      conn,
      code.ok,
      'Phone number updated successfully'
    );
  } catch (error) {
    return handleError(conn, error);
  }
};
