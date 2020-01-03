'use strict';

const {
  rootCollections,
  db,
  // auth,
} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  isNonEmptyString,
  hasAdminClaims,
  isE164PhoneNumber,
} = require('../../admin/utils');
const {code} = require('../../admin/responses');
const {httpsActions} = require('../../admin/constants');
const momentTz = require('moment-timezone');

const validateRequest = body => {
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
    messageObject.message =
      `The field 'oldPhoneNumber' should be` + ` a valid E.164 phone number`;

    return messageObject;
  }

  if (!isE164PhoneNumber(body.newPhoneNumber)) {
    messageObject.isValid = false;
    messageObject.message =
      `The field 'newPhoneNumber' should be` + ` a valid E.164 phone number`;

    return messageObject;
  }

  return messageObject;
};

module.exports = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use POST`,
    );
  }

  if (
    !conn.requester.isSupportRequest &&
    !hasAdminClaims(conn.requester.customClaims)
  ) {
    return sendResponse(
      conn,
      code.unauthorized,
      `You cannot access this resource`,
    );
  }

  const validationResult = validateRequest(conn.req.body);

  if (!validationResult.isValid) {
    return sendResponse(conn, code.badRequest, validationResult.message);
  }

  if (conn.requester.phoneNumber === conn.req.body.oldPhoneNumber) {
    return sendResponse(
      conn,
      code.forbidden,
      `You cannot change your own phone number`,
    );
  }

  if (conn.req.body.oldPhoneNumber === conn.req.body.newPhoneNumber) {
    return sendResponse(
      conn,
      code.badRequest,
      'Old and the new phone number cannot be the same.',
    );
  }

  const baseQuery = rootCollections.activities
    .where('office', '==', conn.req.body.office)
    .where('status', '==', 'CONFIRMED')
    .where('template', '==', 'employee');

  try {
    const [oldEmployeeQueryResult, newEmployeeQueryResult] = await Promise.all([
      baseQuery
        .where(
          'attachment.Phone Number.value',
          '==',
          conn.req.body.oldPhoneNumber,
        )
        .limit(1)
        .get(),
      baseQuery
        .where(
          'attachment.Phone Number.value',
          '==',
          conn.req.body.newPhoneNumber,
        )
        .limit(1)
        .get(),
    ]);

    if (oldEmployeeQueryResult.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `${conn.req.body.oldPhoneNumber} is not an employee`,
      );
    }

    if (!newEmployeeQueryResult.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `${conn.req.body.oldPhoneNumber} is already an employee`,
      );
    }

    const [employeeActivity] = oldEmployeeQueryResult.docs;
    const batch = db.batch();
    const officeId = employeeActivity.get('officeId');
    const addendumDocRef = rootCollections.offices
      .doc(officeId)
      .collection('Addendum')
      .doc();

    batch.set(
      employeeActivity.ref,
      {
        addendumDocRef,
        timestamp: Date.now(),
        attachment: {
          'Phone Number': {
            value: conn.req.body.newPhoneNumber,
          },
        },
      },
      {
        merge: true,
      },
    );

    const timezone = employeeActivity.get('timezone') || 'Asia/Kolkata';
    const momentToday = momentTz().tz(timezone);

    batch.set(addendumDocRef, {
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

    await batch.commit();

    return sendResponse(
      conn,
      code.accepted,
      'Phone number change is in progress',
    );
  } catch (error) {
    return handleError(conn, error);
  }
};
