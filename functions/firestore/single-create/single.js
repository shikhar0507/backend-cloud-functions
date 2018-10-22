'use strict';

const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
  hasAdminClaims,
  hasSupportClaims,
} = require('../../admin/utils');
const {
  httpsActions,
} = require('../../admin/constants');
const {
  code,
} = require('../../admin/responses');
const {
  isValidRequestBody,
  validateSchedules,
  validateVenues,
} = require('../../firestore/activity/helper');

const validateAttachment = (options) => {
  const {
    requestBody,
    templateAttachment,
    officeId,
    template,
  } = options;

  const messageObject = {
    isValid: true,
    message: null,
    phoneNumbers: new Set(),
  };

  if (!requestBody.attachment) {
    return {
      isValid: false,
      message: `Expected the body type of 'attachment' to be of type`
        + ` 'Object' Found ${typeof requestBody.attachment}.`,
    };
  }

  if (Array.isArray(requestBody.attachment)) {
    return {
      isValid: false,
      message: `Expected the body type of 'attachment' to be of type`
        + ` 'Object' Found ${typeof requestBody.attachment}.`,
    };
  }

  const fields = Object.toString();

  return messageObject;
};


module.exports = (conn) => {
  if (conn.req.method !== 'PUT') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'PUT'`
    );

    return;
  }

  const result =
    isValidRequestBody(conn.req.body, httpsActions.create);

  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  /** Only `support` can create an office */
  if (conn.req.body.template === 'office'
    && !hasSupportClaims(conn.requester.customClaims)) {
    sendResponse(conn, code.forbidden, `You cannot access this resource`);

    return;
  }

  /**
   * Only support and admin can use this endpoint. But only support
   * can use the template `office`.
   */
  if (conn.req.body.template !== 'office'
    && !hasAdminClaims(conn.requester.customClaims)) {
    sendResponse(conn, code.forbidden, `You cannot access this resource`);

    return;
  }

  if (!new Set()
    .add('admin')
    .add('office')
    .add('product')
    .add('recipient')
    .has(conn.req.body.template)) {
    sendResponse(
      conn,
      code.forbidden,
      `${conn.req.body.template} is not supported.`
    );

    return;
  }

  const batch = db.batch();

  Promise
    .all([
      rootCollections
        .offices
        .where('template', '==', 'office')
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        officeDocQuery,
        templateDocQuery,
      ] = result;

      if (templateDocQuery.empty) {
        sendResponse(
          conn,
          code.badRequest,
          `Template '${conn.req.body.template}' not found`
        );

        return;
      }

      if (templateDocQuery
        .docs[0]
        .get('canEditRule') !== 'ADMIN') {
        sendResponse(
          conn,
          code.forbidden,
          `The template '${conn.req.body.template}' is not supported.`
        );

        return;
      }

      if (conn.req.body.template === 'office'
        && !officeDocQuery.empty) {
        sendResponse(
          conn,
          code.conflict,
          `An office with the name: ${conn.req.body.office} already exists`
        );

        return;
      }

      if (officeDocQuery.docs[0].get('status') === 'CANCELLED') {
        sendResponse(
          conn,
          code.forbidden,
          `The office status is CANCELLED. Cannot create an activity`
        );

        return;
      }

      const locals = {
        batch: db.batch(),
        officeDoc: officeDocQuery.docs[0],
        templateDoc: templateDocQuery.docs[0],
        /** The field `share` is an array of phoneNumbers */
        allAssignees: new Set(conn.req.body.share),
      };

      const scheduleValid =
        validateSchedules(
          conn.req.body,
          templateDocQuery.docs[0].get('schedule')
        );

      if (!scheduleValid.isValid) {
        sendResponse(
          conn,
          code.badRequest,
          scheduleValid.message
        );

        return;
      }

      const venueValid =
        validateVenues(
          conn.req.body,
          templateDocQuery.docs[0].get('venue')
        );

      if (!venueValid.isValid) {
        sendResponse(conn, code.badRequest, venueValid.message);

        return;
      }

      const attachmentValid = validateAttachment({
        requestBody: conn.req.body,
        templateAttachment: templateDocQuery.docs[0].get('attachment'),
        officeId: officeDocQuery.docs[0].id,
        template: conn.req.body.template,
      });

      if (!attachmentValid.isValid) {
        sendResponse(conn, code.badRequest, attachmentValid.message);

        return;
      }

      attachmentValid
        .phoneNumbers
        .forEach((phoneNumber) => locals.allAssignees.add(phoneNumber));


      if (locals.allAssignees.size === 0) {
        sendResponse(
          conn,
          code.conflict,
          `Cannot create an activity with no assignees.`
        );

        return;
      }






      return batch.commit();
    })
    .catch((error) => handleError(conn, error));
};
