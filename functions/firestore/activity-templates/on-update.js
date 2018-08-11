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

const {
  validTypes,
  canEditRules,
  templateFields,
  activityStatuses,
} = require('../../admin/attachment-types');


const validateRequestBody = (conn, locals) => {
  const fields = Object.keys(conn.req.body);

  for (const field of fields) {
    if (!templateFields.has(field)) {
      locals.objects.message.message = `Unknown field: '${field}' found`
        + ` in the request body.`;
      locals.objects.message.isValid = false;
      break;
    }

    const value = conn.req.body[field];

    if (field === 'statusOnCreate') {
      if (!activityStatuses.has(value)) {
        locals.objects.message.message = `'${value}' is not a valid value`
          + ` for the field 'statusOnCreate'. Allowed values:`
          + ` ${[...activityStatuses.keys(),]}.`;
        locals.objects.message.isValid = false;
        break;
      }

      locals.objects.updatedFields[field] = value;
    }

    if (field === 'canEditRule') {
      if (!canEditRules.has(value)) {
        locals.objects.message.message = `'${value}' is not a valid value`
          + ` for the field 'canEditRule'. Allowed values:`
          + ` ${[...canEditRules.keys(),]}.`;
        locals.objects.message.isValid = false;
        break;
      }

      locals.objects.updatedFields[field] = value;
    }

    if (field === 'venue') {
      if (!Array.isArray(value)) {
        locals.objects.message.message = `The 'venue' field should be an 'array'.`;
        locals.objects.message.isValid = false;
        break;
      }
    }

    if (field === 'schedule') {
      if (!Array.isArray(value)) {
        locals.objects.message.message = `The 'schedule' field should be an 'array'.`;
        locals.objects.message.isValid = false;
        break;
      }
    }

    if (field === 'comment') {
      if (!isNonEmptyString(value)) {
        locals.objects.message.message = `The 'schedule' field should be an 'array'.`;
        locals.objects.message.isValid = false;
        break;
      }

      locals.objects.updatedFields[field] = value;
    }
  }

  if (!locals.objects.message.isValid) {
    sendResponse(conn, code.badRequest, locals.objects.message.message);

    return;
  }

  if (conn.req.body.hasOwnProperty('schedule')) {
    let valid = true;

    conn.req.body.schedule.forEach((name) => {
      if (!isNonEmptyString(name)) {
        valid = false;
      }
    });

    if (!valid) {
      sendResponse(
        conn,
        code.badRequest,
        `The value of the 'schedule' can either be an empty array, or an array`
        + ` of non-empty strings.`
      );

      return;
    }
  }

  if (conn.req.body.hasOwnProperty('venue')) {
    let valid = true;

    conn.req.body.venue.forEach((descriptor) => {
      if (!isNonEmptyString(descriptor)) {
        valid = false;
      }
    });

    if (!valid) {
      sendResponse(
        conn,
        code.badRequest,
        `The value of the field 'venue' can either be an empty array,`
        + ` or an array of non-empty strings.`
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
        `Expected the value of the 'attachment' field to`
        + ` be of type Object. Found: '${typeof attachment}'.`
      );

      return;
    }

    const message = {
      isValid: true,
      message: null,
    };

    const fields = Object.keys(conn.req.body.attachment);

    for (const field of fields) {
      const item = conn.req.body.attachment[field];

      if (!item.hasOwnProperty('value')) {
        message.isValid = false;
        message.message = `In attachment, the object '${field}' is`
          + ` missing the field 'value'.`;
        break;
      }

      if (!item.hasOwnProperty('type')) {
        message.isValid = false;
        message.message = `In attachment, the object '${field}' is`
          + ` missing the field 'type'.`;
        break;
      }

      const value = item.value;
      const type = item.type;

      if (!validTypes.has(type)) {
        message.isValid = false;
        message.message = `In attachment, the 'type' in the object '${field}'`
          + ` has an invalid type. Allowed values: ${[...validTypes.keys(),]}`;
        break;
      }

      if (value !== '') {
        message.isValid = false;
        message.message = `The value in all objects in attachment`
          + ` should be an empty string.`;
        break;
      }
    }

    if (!message.isValid) {
      sendResponse(conn, code.badRequest, message.message);

      return;
    }

    locals.objects.updatedFields.attachment = conn.req.body.attachment;
  }

  rootCollections
    .activityTemplates
    .doc(locals.static.templateId)
    .set(locals.objects.updatedFields, { merge: true, })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  console.warn('\n'.repeat(10));
  if (!conn.req.body.hasOwnProperty('name')) {
    sendResponse(
      conn,
      code.badRequest,
      `The 'name' field is missing from the request body.`
    );

    return;
  }

  rootCollections
    .activityTemplates
    .where('name', '==', conn.req.body.name)
    .limit(1)
    .get()
    .then((snapShot) => {
      if (snapShot.empty) {
        sendResponse(
          conn,
          code.notFound,
          `No template found with the name: '${conn.req.query.name}'.`
        );

        return;
      }

      const locals = {
        objects: {
          updatedFields: {},
          message: {
            isValid: true,
            message: null,
          },
        },
        static: {
          templateId: snapShot.docs[0].id,
        },
      };

      validateRequestBody(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};
