'use strict';

const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  isValidDate,
  isNonEmptyString,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const momentTz = require('moment-timezone');

const validateRequestBody = (requestBody) => {
  const result = { isValid: true, message: null };

  if (!isValidDate(requestBody.startTime) || !isValidDate(requestBody.endTime)) {
    result.isValid = false;
    result.message = `Fields 'startTime' and 'endTime' should be valid unix timestamps`;
  }

  if (!isNonEmptyString(requestBody.office)) {
    result.isValid = false;
    result.message = `Field: 'office' should be a non-empty string`;
  }

  const names = new Set(['footprints', 'payroll', 'expense claim',])

  if (!names.has(requestBody.report)) {
    result.isValid = false;
    result.message = `Report: '${requestBody.report}' is not a valid report name`;
  }

  if (!isNonEmptyString(requestBody.report)) {
    result.isValid = false;
    result.message = `Field: 'report' should be a non-empty string`;
  }

  return result;
};


module.exports = (conn) => {
  /**
   * If is admin, the user can only trigger reports for the offices for which
   * they are an admin of.
   */
  if (conn.requester.customClaims.admin
    && !conn.requester.customClaims.admin.includes(conn.req.body.office)) {
    return sendResponse(conn, code.forbidden, 'Operation not allowed');
  }

  if (conn.req.body.startTime && !conn.req.body.endTime) {
    conn.req.body.endTime = conn.req.body.startTime;
  }

  const result = validateRequestBody(conn.req.body);

  if (!result.isValid) {
    return sendResponse(conn, code.badRequest, result.message);
  }

  const batch = db.batch();

  return Promise
    .all([
      // rootCollections
      //   .updates
      //   .where('phoneNumber', '==', conn.requester.phoneNumber)
      //   .limit(1)
      //   .get(),
      rootCollections
        .offices
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections
        .recipients
        .where('report', '==', conn.req.body.report)
        .where('office', '==', conn.req.body.office)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        // updatesDocQuery,
        officeDocQuery,
        recipientDocsQuery,
      ] = result;

      if (officeDocQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Office: '${conn.req.body.office}' not found`
        );
      }

      if (recipientDocsQuery.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `No recipient found for ${conn.req.body.office} for the report: ${conn.req.body.report}`
        );
      }

      const timezone = officeDocQuery.docs[0].get('attachment.Timezone.value');
      const startDay = momentTz().tz(timezone).startOf('day');
      const endDay = momentTz().tz(timezone).endOf('day');
      const numberOfDays = Math.abs(endDay.diff(startDay, 'day'));

      const timestampsArray = [
        startDay.valueOf(),
      ];

      for (let iter = 0; iter < numberOfDays; iter++) {
        const newMoment = startDay.clone().add(1, 'day');

        timestampsArray.push(newMoment.valueOf());
      }

      timestampsArray.forEach((timestamp) => {
        batch.set(recipientDocsQuery.docs[0].ref, {
          timestamp,
        }, {
            merge: true,
          });
      });

      return Promise
        .all([
          batch
            .commit(),
          sendResponse(conn, code.ok),
        ]);
    })
    .catch((error) => handleError(conn, error));
};
