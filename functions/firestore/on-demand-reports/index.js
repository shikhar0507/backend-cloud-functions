'use strict';

const {db, rootCollections} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  isValidDate,
  isNonEmptyString,
} = require('../../admin/utils');
const {code} = require('../../admin/responses');
const momentTz = require('moment-timezone');

const validateRequestBody = requestBody => {
  const result = {
    isValid: true,
    message: null,
  };

  if (
    !isValidDate(requestBody.startTime) ||
    !isValidDate(requestBody.endTime)
  ) {
    result.isValid = false;
    result.message = `Fields 'startTime' and 'endTime' should be valid unix timestamps`;
  }

  if (!isNonEmptyString(requestBody.office)) {
    result.isValid = false;
    result.message = `Field: 'office' should be a non-empty string`;
  }

  // const names = new Set(['footprints', 'payroll', 'payroll master']);

  // if (!names.has(requestBody.report)) {
  //   result.isValid = false;
  //   result.message = `Report: '${requestBody.report}' is not a valid report name`;
  // }

  if (!isNonEmptyString(requestBody.report)) {
    result.isValid = false;
    result.message = `Field: 'report' should be a non-empty string`;
  }

  return result;
};

module.exports = async conn => {
  try {
    if (
      conn.requester.customClaims.admin &&
      !conn.requester.customClaims.admin.includes(conn.req.body.office)
    ) {
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
    const [officeDocQuery, recipientDocsQuery] = await Promise.all([
      rootCollections.offices
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections.recipients
        .where('report', '==', conn.req.body.report)
        .where('office', '==', conn.req.body.office)
        .limit(1)
        .get(),
    ]);

    const [officeDoc] = officeDocQuery.docs;
    const [recipientDoc] = recipientDocsQuery.docs;
    const {
      attachment: {
        Timezone: {value: timezone},
      },
    } = officeDoc.data();

    if (!officeDoc) {
      return sendResponse(
        conn,
        code.badRequest,
        `Office: '${conn.req.body.office}' not found`,
      );
    }

    if (!recipientDoc) {
      return sendResponse(
        conn,
        code.badRequest,
        `No recipient found for ${conn.req.body.office}` +
          ` for the report: ${conn.req.body.report}`,
      );
    }

    batch.set(
      recipientDoc.ref,
      {
        timestamp: momentTz(conn.req.body.startTime)
          .tz(timezone)
          .valueOf(),
      },
      {
        merge: true,
      },
    );

    await batch.commit();

    return sendResponse(conn, code.ok);
  } catch (error) {
    return handleError(conn, error);
  }
};
