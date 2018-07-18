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


const {
  rootCollections,
} = require('../../admin/admin');

const {
  code,
} = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  isNonEmptyString,
} = require('../../admin/utils');

const {
  enums,
  activityTemplates,
} = rootCollections;


/**
 * Adds a new document to the ActivityTemplates collection with
 * the doc-id as the template name.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const createTemplate = (conn) => {
  activityTemplates
    .doc(conn.req.body.name)
    .set({
      name: conn.req.body.name,
      defaultTitle: conn.req.body.defaultTitle,
      comment: conn.req.body.comment,
      statusOnCreate: conn.req.body.statusOnCreate,
      attachment: conn.req.body.attachment || {},
      schedule: conn.req.body.schedule || [],
      venue: conn.req.body.venue || [],
    })
    .then(() => {
      sendResponse(
        conn,
        code.created,
        'The template was created successfully.'
      );

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Validates if the the template already exists with the name sent in
 * the request body. Rejects the request if it does.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @param {Array} result Contains the object of documents fetched from Firestore.
 * @returns {void}
 */
const handleResult = (conn, result) => {
  const templateDoc = result[0];
  const enumDoc = result[1];

  if (!templateDoc.empty) {
    sendResponse(
      conn,
      code.conflict,
      `The ${conn.req.body.name} template already exists.`
      + ` Use the templates update API to make changes.`
    );

    return;
  }

  if (
    enumDoc
      .get('ACTIVITYSTATUS')
      .indexOf(conn.req.body.statusOnCreate) === -1
  ) {
    sendResponse(
      conn,
      code.badRequest,
      'Value of the statusOnCreate field is not valid.'
      + ` Please use one of the following values: ${enumDoc.get('ACTIVITYSTATUS')}.`
    );

    return;
  }

  createTemplate(conn);
};


/**
 * Fetches the `template` with the `name` from the request body
 * and the `ACTIVITYSTATUS` doc from Enums collection.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const fetchDocs = (conn) => {
  Promise
    .all([
      activityTemplates
        .where('name', '==', conn.req.body.name)
        .limit(1)
        .get(),
      enums.doc('ACTIVITYSTATUS').get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
};


/**
 * Validates the request body for the fields such as name, defaultTitle,
 * comment, schedule, venue and the attachment.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const app = (conn) => {
  if (!conn.req.body.hasOwnProperty('name')) {
    sendResponse(
      conn,
      code.badRequest,
      'Missing the name field in the request body.'
    );

    return;
  }

  if (!isNonEmptyString(conn.req.body.name)) {
    sendResponse(
      conn,
      code.badRequest,
      'The name field needs to be a non-empty string.'
    );

    return;
  }

  /** Default template `plan` cannot be modified. */
  if (conn.req.body.name === 'plan') {
    sendResponse(
      conn,
      code.forbidden,
      'You can\'t update the template "plan".'
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('defaultTitle')) {
    sendResponse(
      conn,
      code.badRequest,
      'Can\'t create a template without a defaultTitle.'
    );

    return;
  }

  if (!isNonEmptyString(conn.req.body.defaultTitle)) {
    sendResponse(
      conn,
      code.badRequest,
      'The defaultTitle field needs to be a non-empty string.'
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('comment')) {
    sendResponse(
      conn,
      code.badRequest,
      'Can\'t create a template without a comment.'
    );

    return;
  }

  if (!isNonEmptyString(conn.req.body.comment)) {
    sendResponse(
      conn,
      code.badRequest,
      'The comment field needs to be a non-empty string.'
    );

    return;
  }

  if (!conn.req.body.hasOwnProperty('statusOnCreate')) {
    sendResponse(
      conn,
      code.badRequest,
      'Can\'t create a template without the statusOnCreate field.'
    );

    return;
  }

  if (!isNonEmptyString(conn.req.body.statusOnCreate)) {
    sendResponse(
      conn,
      code.badRequest,
      'The statusOnCreate field needs to be a non-empty string.'
    );

    return;
  }

  if (conn.req.body.hasOwnProperty('schedule')) {
    if (!Array.isArray(conn.req.body.schedule)) {
      sendResponse(
        conn,
        code.badRequest,
        `The schedule needs to be an array of strings.`
      );

      return;
    }
  }

  if (conn.req.body.hasOwnProperty('venue')) {
    if (!Array.isArray(conn.req.body.venue)) {
      sendResponse(
        conn,
        code.badRequest,
        `The venue needs to be an array of strings.`
      );

      return;
    }
  }

  if (conn.req.body.hasOwnProperty('attachment')) {
    if (Object.prototype.toString
      .call(conn.req.body.attachment) !== '[object Object]') {
      sendResponse(
        conn,
        code.badRequest,
        'The attachment needs to be an object.'
      );

      return;
    }
  }

  fetchDocs(conn);
};


module.exports = app;
