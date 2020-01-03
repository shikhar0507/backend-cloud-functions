'use strict';

const {rootCollections, db} = require('../../admin/admin');
const {
  sendResponse,
  isE164PhoneNumber,
  handleError,
  isNonEmptyString,
  hasAdminClaims,
} = require('../../admin/utils');
const {code} = require('../../admin/responses');

const validator = body => {
  if (!body.hasOwnProperty('office')) {
    return {
      isValid: false,
      message: `Field 'office' is missing`,
    };
  }

  if (!isNonEmptyString(body.office)) {
    return {
      isValid: false,
      message: `Office should be a non-empty string`,
    };
  }

  if (!body.hasOwnProperty('phoneNumber')) {
    return {
      isValid: false,
      message: `Field phoneNumber is missing.`,
    };
  }

  if (!isE164PhoneNumber(body.phoneNumber)) {
    return {
      isValid: false,
      message: `Invalid phone number`,
    };
  }

  return {
    isValid: true,
    message: null,
  };
};

const cancelEmployee = (conn, officeDoc) => {
  return Promise.all([
    officeDoc.ref
      .collection('Activities')
      .where('template', '==', 'employee')
      .where('office', '==', conn.req.body.office)
      .where('attachment.Phone Number.value', '==', conn.req.body.phoneNumber)
      .limit(1)
      .get(),
    rootCollections.updates
      .where('phoneNumber', '==', conn.req.body.phoneNumber)
      .limit(1)
      .get(),
  ])
    .then(result => {
      const [employeeActivityQuery, updatesDocQuery] = result;

      if (employeeActivityQuery.empty) {
        sendResponse(
          conn,
          code.badRequest,
          `No employee found with the phone number: ${conn.req.body.phoneNumber}`,
        );
      }

      const activityId = employeeActivityQuery.docs[0].id;
      const oldStatus = employeeActivityQuery.docs[0].get('status');

      if (oldStatus === 'CANCELLED') {
        return sendResponse(
          conn,
          code.badRequest,
          `Employee: ${conn.req.body.phoneNumber} is already cancelled`,
        );
      }

      const batch = db.batch();

      batch.set(
        rootCollections.activities.doc(activityId),
        {
          addendumDocRef: null,
          timestamp: Date.now(),
          status: 'CANCELLED',
        },
        {
          merge: true,
        },
      );

      if (!updatesDocQuery.empty) {
        const doc = updatesDocQuery.docs[0];
        const removeFromOffice = doc.get('removeFromOffice') || [];
        removeFromOffice.push(conn.req.body.office);

        batch.set(
          doc.ref,
          {
            removeFromOffice: Array.from(new Set(removeFromOffice)),
          },
          {
            merge: true,
          },
        );
      }

      return Promise.all([
        batch.commit(),
        sendResponse(
          conn,
          code.ok,
          `${conn.req.body.phoneNumber} has been CANCELLED`,
        ),
      ]);
    })
    .catch(error => handleError(conn, error));
};

module.exports = conn => {
  if (conn.req.method !== 'PATCH') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} not allowed. Use 'POST'`,
    );
  }

  if (!conn.requester.isSupportRequest) {
    if (!hasAdminClaims(conn.requester.customClaims)) {
      return sendResponse(
        conn,
        code.forbidden,
        `You are not allowed to access this resource`,
      );
    }
  }

  // Cancel employee
  const result = validator(conn.req.body);

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  return rootCollections.offices
    .where('office', '==', conn.req.body.office)
    .limit(1)
    .get()
    .then(docs => {
      if (docs.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Office ${conn.req.body.office} doesn't exist`,
        );
      }

      return cancelEmployee(conn, docs.docs[0]);
    })
    .catch(error => handleError(conn, error));
};
