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


const { rootCollections, } = require('../../admin/admin');

const { code, } = require('../../admin/responses');

const {
  handleError,
  sendResponse,
  isNonEmptyString,
} = require('../../admin/utils');


/**
 * Updates the document in the `ActivityTemplates` collection and
 * sends the response of success to the user.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @param {Object} updatedFields Document with the *valid* fields from the request body.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const updateTemplate = (conn, updatedFields, locals) =>
  rootCollections
    .activityTemplates
    .doc(locals.docId)
    .set(updatedFields, {
      /** The request body can contain a partial update, so merging
       * is a safe way to handle this document.
       */
      merge: true,
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));


/**
 * Creates the `update` object which can be used to modify and update
 * the existing template `doc` in the `ActivityTemplates` collection.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const makeUpdateDoc = (conn, locals) => {
  const updatedFields = {};

  if (isNonEmptyString(conn.req.body.defaultTitle)) {
    updatedFields.defaultTitle = conn.req.body.defaultTitle;
  }

  if (isNonEmptyString(conn.req.body.comment)) {
    updatedFields.comment = conn.req.body.comment;
  }

  if (Array.isArray(conn.req.body.schedule)) {
    updatedFields.schedule = conn.req.body.schedule;
  }

  if (Array.isArray(conn.req.body.venue)) {
    updatedFields.venue = conn.req.body.venue;
  }

  if (conn.req.body.hasOwnProperty('attachment')) {
    if (Object.prototype.toString
      .call(conn.req.body.attachment) === '[object Object]') {
      updatedFields.attachment = conn.req.body.attachment;
    }
  }

  updateTemplate(conn, updatedFields, locals);
};


/**
 * Checks for the existance of the template.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @param {Array} result Contains the object of documents fetched from Firestore.
 * @returns {void}
 */
const handleResult = (conn, result) => {
  const templateDoc = result[0];
  const enumDoc = result[1];

  if (templateDoc.empty) {
    sendResponse(
      conn,
      code.conflict,
      `Template: ${conn.req.body.name} does not exist.`
    );

    return;
  }

  const locals = {};
  /** A reference to this doc is required in the updateTemplate()
   * function.
   */
  locals.docId = templateDoc.docs[0].id;

  if (conn.req.body.hasOwnProperty('statusOnCreate')) {
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
  }

  makeUpdateDoc(conn, locals);
};


/**
 * Fetches the `template` with the `name` from the request body
 * and the `ACTIVITYSTATUS` doc from Enums collection.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
const fetchDocs = (conn) =>
  Promise
    .all([
      rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.name)
        .limit(1)
        .get(),
      rootCollections
        .enums
        .doc('ACTIVITYSTATUS')
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));



/**
 * Validates the `name` field from the request body to see
 * if it is skipped, or is a valid string, and *isn't*
 * `plan` (default template).
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
module.exports = (conn) => {
  if (!conn.req.body.hasOwnProperty('name')) {
    sendResponse(
      conn,
      code.badRequest,
      'The name field is missing from the request body.'
    );

    return;
  }

  if (!isNonEmptyString(conn.req.body.name)) {
    sendResponse(
      conn,
      code.badRequest,
      'The name field needs to be a string.'
    );

    return;
  }

  /** The default template Plan can't be updated. */
  if (conn.req.body.name === 'plan') {
    sendResponse(
      conn,
      code.forbidden,
      'Updating the template Plan is not allowed.'
    );

    return;
  }

  fetchDocs(conn);
};
