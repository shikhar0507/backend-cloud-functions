'use strict';

const {
  db,
  rootCollections,
  fieldPath,
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

  return messageObject;
};


module.exports = (conn) => {
  /**
   * Unlike the client-side APIs, this one simply replaces
   * or creates the documents.
   */
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
      `Template: '${conn.req.body.template}' is not supported`
    );

    return;
  }

  const locals = {
    batch: db.batch(),
  };

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


      return;
    })
    .catch((error) => handleError(conn, error));
};
