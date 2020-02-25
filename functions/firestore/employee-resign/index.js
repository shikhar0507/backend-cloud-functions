/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const { rootCollections, db } = require('../../admin/admin');
const {
  sendResponse,
  isE164PhoneNumber,
  handleError,
  isNonEmptyString,
  hasAdminClaims,
} = require('../../admin/utils');
const { code } = require('../../admin/responses');

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

const cancelEmployee = async (conn, officeDoc) => {
  try {
    const [employeeActivityQuery, updatesDocQuery] = await Promise.all([
      rootCollections.activities
        .where('officeId', '==', officeDoc.id)
        .where('template', '==', 'employee')
        .where('attachment.Phone Number.value', '==', conn.req.body.phoneNumber)
        .limit(1)
        .get(),
      rootCollections.updates
        .where('phoneNumber', '==', conn.req.body.phoneNumber)
        .limit(1)
        .get(),
    ]);

    if (employeeActivityQuery.empty) {
      sendResponse(
        conn,
        code.badRequest,
        `No employee found with the phone number: ${conn.req.body.phoneNumber}`,
      );
    }

    const { id: activityId } = employeeActivityQuery.docs[0];
    const oldStatus = employeeActivityQuery.docs[0].get('status');
    const batch = db.batch();

    if (oldStatus === 'CANCELLED') {
      return sendResponse(
        conn,
        code.badRequest,
        `Employee: ${conn.req.body.phoneNumber} is already cancelled`,
      );
    }

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

    await batch.commit();

    return sendResponse(
      conn,
      code.ok,
      `${conn.req.body.phoneNumber} has been CANCELLED`,
    );
  } catch (error) {
    return handleError(conn, error);
  }
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
