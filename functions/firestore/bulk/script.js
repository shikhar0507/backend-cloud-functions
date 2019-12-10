'use strict';

const {
  rootCollections,
} = require('../../admin/admin');
const env = require('../../admin/env');
const {
  handleError,
  isValidDate,
  sendResponse,
  isValidGeopoint,
  isNonEmptyString,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(env.sgMailApiKey);
const storage = require('firebase-admin').storage();
const fs = require('fs');

const handleValidation = body => {
  const result = {
    success: true,
    message: null
  };

  const messageString = field =>
    `Invalid/Missing field '${field}' found in the request body`;

  /** Field 'office' can be skipped. */
  if (body.template !== 'office' &&
    !isNonEmptyString(body.office)) {
    return {
      success: false,
      message: messageString('office'),
    };
  }

  if (!isNonEmptyString(body.template) ||
    !body.hasOwnProperty('template')) {
    return {
      success: false,
      message: messageString('template'),
    };
  }

  if (!isValidDate(body.timestamp) ||
    !body.hasOwnProperty('timestamp')) {
    return {
      success: false,
      message: messageString('timestamp'),
    };
  }

  if (!isValidGeopoint(body.geopoint, false) ||
    !body.hasOwnProperty('geopoint')) {
    return {
      success: false,
      message: messageString('geopoint'),
    };
  }

  return result;
};


module.exports = async conn => {
  /**
   * Request body
   * office: string
   * timestamp: number
   * template: string
   * encoded: csvString
   * location: `object(latitude, longitude)`
   */
  if (!conn.requester.isSupportRequest) {
    if (!conn.requester.customClaims.admin ||
      !conn.requester.customClaims.admin.includes(conn.req.body.office)) {
      return sendResponse(
        conn,
        code.unauthorized,
        `You are not allowed to access this resource`
      );
    }
  }

  const result = handleValidation(conn.req.body);

  if (!result.success) {
    return sendResponse(
      conn,
      code.badRequest,
      result.message
    );
  }

  const promises = [
    rootCollections
    .offices
    /** Office field can be skipped while creating `offices` in bulk */
    .where('office', '==', conn.req.body.office || '')
    .limit(1)
    .get(),
    rootCollections
    .activityTemplates
    .where('name', '==', conn.req.body.template)
    .limit(1)
    .get(),
  ];

  try {
    const [
      officeDocsQuery,
      templateDocsQuery,
    ] = await Promise
      .all(promises);

    if (conn.req.body.template !== 'office' &&
      officeDocsQuery.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `Office ${conn.req.body.office} doesn't exist`
      );
    }

    if (templateDocsQuery.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `Template ${conn.req.body.template} doesn't exist`
      );
    }

    const locals = {
      officeDoc: officeDocsQuery.docs[0],
      templateDoc: templateDocsQuery.docs[0],
      adminsSet: new Set(),
      employeesSet: new Set(),
    };

    const fileName = `${conn.req.body.template}.xlsx`;
    const filePath = `/tmp/${fileName}`;

    const buff = Buffer.from(conn.req.body.data, 'binary');

    fs
      .writeFileSync(filePath, buff);

    const template = locals.templateDoc.get('name');
    const officeId = (() => {
      if (template === 'office') {
        return template;
      }

      return locals.officeDoc.id;
    })();
    const ts = new Date().toISOString();
    const bucketName = env.bulkStorageBucketName;
    const bucket = storage.bucket(bucketName);
    const destination = `${officeId}/${template}/` +
      `${ts}__${fileName}`;

    await bucket
      .upload(filePath, {
        destination,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        metadata: {
          cacheControl: 31536000, // 1 year
          metadata: {
            phoneNumber: conn.requester.phoneNumber,
            uid: conn.requester.uid,
            email: conn.requester.email,
            emailVerified: conn.requester.emailVerified,
            displayName: conn.requester.displayName,
            photoURL: conn.requester.photoURL,
            timestamp: Date.now(),
            trialRun: conn.req.query.trailRun === 'true',
            isAdminRequest: !conn.requester.isSupportRequest,
            isSupportRequest: conn.requester.isSupportRequest,
            latitude: `${conn.req.body.geopoint.latitude}`,
            longitude: `${conn.req.body.geopoint.longitude}`,
          },
        },
      });

    return sendResponse(conn, code.ok);
  } catch (error) {
    return handleError(conn, error);
  }
};
