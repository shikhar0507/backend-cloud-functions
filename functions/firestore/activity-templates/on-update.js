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


const {
  rootCollections,
} = require('../../admin/admin');

const {
  activityTemplates,
} = rootCollections;

const {
  code,
} = require('../../admin/responses');

const {
  isValidString,
} = require('../activity/helper');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  validateSchedule,
  validateVenue,
  validateAttachment,
} = require('./helpers');


const updateTemplate = (conn, templateData) => {
  activityTemplates.doc(conn.data.docId).set(templateData, {
    /** The request body can contain a partial update, so merging
     * is a safe way to handle this document.
     */
    merge: true,
  }).then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


const createTemplateDocument = (conn) => {
  /** TODO: Verify if updating the name of the template is allowed?? */
  const templateData = {};

  if (typeof conn.req.body.comment === 'string') {
    templateData.comment = conn.req.body.comment;
  }

  if (typeof conn.req.body.defaultTitle === 'string') {
    templateData.defaultTitle = conn.req.body.defaultTitle;
  }

  if (validateSchedule(conn.req.body.schedule)) {
    templateData.schedule = conn.req.body.schedule;
  }

  if (validateVenue(conn.req.body.venue)) {
    templateData.venue = conn.req.body.venue;
  }

  if (validateAttachment(conn.req.body.attachment)) {
    templateData.attachment = conn.req.body.attachment;
  }

  updateTemplate(conn, templateData);
};


const checkTemplateExists = (conn) => {
  activityTemplates.where('name', '==', conn.req.body.name).limit(1)
    .get().then((snapShot) => {
      if (snapShot.empty) {
        sendResponse(
          conn,
          code.conflict,
          `Template with the name: ${conn.req.body.name} does not exist.`
        );
        return;
      }

      conn.data = {};
      conn.data.docId = snapShot.docs[0].id;
      createTemplateDocument(conn);
      return;
    }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  /** We query the template by name, so name is a required
   * field in the request body.
   */
  if (typeof conn.req.body.name !== 'string') {
    sendResponse(
      conn,
      code.badRequest,
      'The "name" in the request body is missing/invalid.'
    );
    return;
  }

  if (conn.req.body.name === 'plan') {
    sendResponse(
      conn,
      code.unauthorized,
      'You cannot update the template "plan".'
    );
    return;
  }

  checkTemplateExists(conn);
};


module.exports = app;
