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
const { code } = require('../../admin/responses');
const {
  canEditRules,
  templateFields,
  activityStatuses,
  reportingActions,
} = require('../../admin/constants');
const {
  isNonEmptyString,
} = require('../../admin/utils');


const validateTemplate = (body) => {
  const message = {
    message: null,
    isValid: true,
  };

  const fields = Object.keys(body);

  for (const field of fields) {
    if (!templateFields.has(field)) {
      message.message = `The field '${field}' is not allowed.`
        + ` Use only: ${[...templateFields.keys()]}.`;
      message.isValid = false;
      break;
    }

    const value = body[field];

    if (['name', 'statusOnCreate', 'canEditRule', 'comment']
      .indexOf(field) > -1
      && !isNonEmptyString(value)) {
      message.message = `The field '${field}' should have a non-empty`
        + ` string as its value.`;
      message.isValid = false;
      break;
    }

    if (!body.hasOwnProperty('name')) {
      message.message = `The 'name' field is missing from`
        + ` the request body.`;
      message.isValid = false;
      break;
    }

    if (body.name && body.name.toLowerCase() !== body.name) {
      message.message = `The value of the field 'name' should be`
        + ` non-empty string with all lowercase alphabetic characters.`;
      message.isValid = false;
      break;
    }

    if (!body.hasOwnProperty('comment')) {
      message.message = `The 'comment' field is missing from`
        + ` the request body.`;
      message.isValid = false;
      break;
    }

    if (!body.hasOwnProperty('canEditRule')) {
      message.message = `The 'canEditRule' field is missing from`
        + ` the request body.`;
      message.isValid = false;
      break;
    }

    if (!body.hasOwnProperty('statusOnCreate')) {
      message.message = `The 'statusOnCreate' field is missing from`
        + ` the request body.`;
      message.isValid = false;
      break;
    }

    if (!body.hasOwnProperty('hidden')) {
      message.message = `The 'hidden' field is missing from the request body`;
      message.isValid = false;
      break;
    }

    /** IndexedDB can't create indexes on boolean values. */
    if ([0, 1].indexOf(body.hidden) === -1) {
      message.message = `The value of the field 'hidden' can only be 0 or 1`;
      message.isValid = false;
      break;
    }

    if (!body.hasOwnProperty('schedule')) {
      message.message = `The 'schedule' field is missing from`
        + ` the request body.`;
      message.isValid = false;
      break;
    }

    if (!body.hasOwnProperty('venue')) {
      message.message = `The 'venue' field is missing from`
        + ` the request body.`;
      message.isValid = false;
      break;
    }

    if (field === 'statusOnCreate') {
      if (!activityStatuses.has(value)) {
        message.message = `The value in the field 'statusOnCreate': '${value}'`
          + ` is not a valid activity status. Use one of the following:`
          /** Map to string conversion */
          + ` ${[...activityStatuses.keys()]}`;
        message.isValid = false;
        break;
      }
    }

    if (field === 'canEditRule') {
      if (!canEditRules.has(value)) {
        message.message = `The value in the field 'canEditRule': '${value}'`
          + ` is not a valid 'canEditRule'. Use one of the following:`
          + ` ${[...canEditRules.keys()]}`;
        message.isValid = false;
        break;
      }
    }

    if (field === 'venue') {
      const invalidVenueMessage = `The value of the field 'venue'`
        + ` can either be an empty array, or an array of non-empty strings.`;

      if (!Array.isArray(value)) {
        message.message = invalidVenueMessage;
        message.isValid = false;
        break;
      }

      let valid = true;

      value.forEach((descriptor) => {
        if (isNonEmptyString(descriptor)) return;

        valid = false;
      });

      if (!valid) {
        message.message = invalidVenueMessage;
        message.isValid = false;
        break;
      }
    }

    if (field === 'schedule') {
      const invalidScheduleMessage = `The value of the field 'schedule'`
        + ` can either be an empty array, or an array of non-empty strings.`;

      if (!Array.isArray(value)) {
        message.message = invalidScheduleMessage;
        message.isValid = false;
        break;
      }

      let valid = true;

      value.forEach((name) => {
        if (isNonEmptyString(name)) return;

        valid = false;
      });

      if (!valid) {
        message.message = invalidScheduleMessage;
        message.isValid = false;
        break;
      }
    }
  }

  return message;
};

const createDocs = (conn, locals) => {
  const templateBody = conn.req.body;
  templateBody.timestamp = Date.now();
  const { messageBody, subject, action } = locals;

  return Promise
    .all([
      locals
        .templateDocRef
        .set(templateBody),
      rootCollections
        .instant
        .doc()
        .set({ messageBody, subject, action }),
    ])
    .then(() => ({
      success: true,
      code: code.ok,
      message: `Template: '${conn.req.body.name}' created successfully`,
    }));
};


/**
 * Validates the request body for the fields such as name, defaultTitle,
 * comment, schedule, venue and the attachment.
 *
 * @param {Object} conn Express Request and Response Objects.
 * @returns {void}
 */
module.exports = (conn) => {
  const result = validateTemplate(conn.req.body);

  if (!result.isValid) {
    return {
      success: false,
      code: code.badRequest,
      message: result.message,
    };
  }

  if (!conn.req.body.hasOwnProperty('attachment')) {
    return {
      message: `The 'attachment' field is missing from the request body.`,
      success: false,
      code: code.badRequest,
    };
  }

  const attachment = conn.req.body.attachment;

  if (Object.prototype.toString.call(attachment) !== '[object Object]') {
    return {
      code: code.badRequest,
      message: `Expected the value of the 'attachment' field to`
        + ` be of type Object. Found: '${typeof attachment}'.`,
      success: false,
    };
  }

  const messageObject = {
    isValid: true,
    message: null,
  };

  if (attachment.hasOwnProperty('Name')
    && attachment.hasOwnProperty('Number')) {
    return {
      success: false,
      code: code.badRequest,
      message: `The fields 'Name' and 'Number cannot exist`
        + ` simultaneously in attachment object.'`
    };
  }

  const attachmentFields = Object.keys(attachment);

  for (const field of attachmentFields) {
    const item = attachment[field];

    if (!item.hasOwnProperty('type')) {
      messageObject.message = `In attachment, the object '${field}'`
        + ` is missing the field 'type'.`;
      messageObject.isValid = false;
      break;
    }

    if (!item.hasOwnProperty('value')) {
      messageObject.message = `In attachment, the object '${field}'`
        + ` is missing the field 'value'.`;
      messageObject.isValid = false;
      break;
    }

    const value = item.value;

    if (value !== '') {
      messageObject.message = `All objects in the 'attachment' should`
        + ` have value equal to an empty string.`;
      messageObject.isValid = false;
      break;
    }
  }

  if (!messageObject.isValid) {
    return {
      success: false,
      message: messageObject.message,
      code: code.badRequest,
    };
  }

  return rootCollections
    .activityTemplates
    .where('name', '==', conn.req.body.name)
    .limit(1)
    .get()
    .then((snapShot) => {
      if (!snapShot.empty) {
        return {
          success: false,
          message: `A template with the name: '${conn.req.body.name}' already exists.`,
          code: code.conflict,
        };
      }

      const templateDocRef = rootCollections.activityTemplates.doc();
      const subject = `A new template has been created`
        + ` (${process.env.GCLOUD_PROJECT})`;
      const messageBody = `
        <p>
          The template manager: <strong>${conn.requester.phoneNumber}</strong>
          just created a new template: ${conn.req.body.name} in the
          Growthfile DB.
        </p>
        <p>
          <strong>Template Manager Name: </strong> ${conn.requester.displayName || ''}
          <br>
          <strong>Template Id</strong>: ${templateDocRef.id}
          <br>
          <strong>Template Name</strong>: ${conn.req.body.name}
        </p>

        <hr>

        <pre>${JSON.stringify(conn.req.body, ' ', 2)}</pre>
        `;

      const locals = {
        messageBody,
        subject,
        templateDocRef,
        action: reportingActions.usedCustomClaims,
      };

      return createDocs(conn, locals);
    });
};
