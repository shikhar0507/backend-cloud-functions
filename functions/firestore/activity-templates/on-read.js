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
  sendJSON,
  handleError,
  sendResponse,
  isNonEmptyString,
} = require('../../admin/utils');


const getDocObject = (doc) => {
  const templateObject = {
    timestamp: doc.get('timestamp').toDate(),
    createTime: doc.createTime,
    updateTime: doc.createTime,
  };

  ['name',
    'venue',
    'hidden',
    'comment',
    'schedule',
    'attachment',
    'canEditRule',
    'statusOnCreate',
  ].forEach((field) => templateObject[field] = doc.get(field));

  return templateObject;
};


/**
 * Fetches all the docs from `/ActivityTemplates` collection and sends
 * the response in a JSON object.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {void}
 */
const fetchAllTemplates = (conn) => {
  const jsonObject = {};

  rootCollections
    .activityTemplates
    .orderBy('timestamp', 'desc')
    .get()
    .then((snapShot) => {
      snapShot.forEach((doc) => jsonObject[doc.id] = getDocObject(doc));

      /** Response ends here... */
      sendJSON(conn, jsonObject);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Fetches the template based on `name` from the query parameter in the
 * request URL.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {void}
 */
const fetchTemplateByName = (conn) => {
  if (!isNonEmptyString(conn.req.query.name)) {
    sendResponse(
      conn,
      code.badRequest,
      'The name should be a non-empty string.'
    );

    return;
  }

  rootCollections
    .activityTemplates
    .where('name', '==', conn.req.query.name)
    .limit(1)
    .get()
    .then((snapShot) => {
      if (snapShot.empty) {
        sendResponse(
          conn,
          code.notFound,
          `No template found with the name: ${conn.req.query.name}`
        );

        return;
      }

      sendJSON(conn, getDocObject(snapShot.docs[0]));

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Checks if the query string is present in the request URL.
 *
 * @param {Object} conn Contains Express Request and Response objects.
 * @returns {void}
 */
module.exports = (conn) => {
  if (conn.req.query.hasOwnProperty('name')) {
    fetchTemplateByName(conn);

    return;
  }

  fetchAllTemplates(conn);
};
