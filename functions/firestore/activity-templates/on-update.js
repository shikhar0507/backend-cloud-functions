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
  db,
} = require('../../admin/admin');
const { code } = require('../../admin/responses');
const {
  isNonEmptyString,
} = require('../../admin/utils');
const {
  canEditRules,
  templateFields,
  activityStatuses,
  reportingActions,
} = require('../../admin/constants');


const validateAttachment = (attachment) => {
  const messageObject = {
    isValid: true,
    message: null,
  };

  if (Object
    .prototype
    .toString
    .call(attachment)
    !== '[object Object]') {
    messageObject.isValid = false;
    messageObject.message = `The attachment can only be of type 'Object'.`;

    return messageObject;
  }

  if (attachment === null) {
    messageObject.isValid = false;
    messageObject.message = `The attachment cannot be of type 'null'`;

    return messageObject;
  }

  if (attachment.hasOwnProperty('Name')
    && attachment.hasOwnProperty('Number')) {
    messageObject.isValid = false;
    messageObject.message = `The fields 'Name' and`
      + ` 'Number cannot exist simultaneously in attachment object.'`;

    return messageObject;
  }

  const fields = Object.keys(attachment);

  for (const field of fields) {
    const item = attachment[field];

    if (!item.hasOwnProperty('value')) {
      messageObject.isValid = false;
      messageObject.message = `In attachment, the object '${field}' is`
        + ` missing the field 'value'.`;
      break;
    }

    if (!item.hasOwnProperty('type')) {
      messageObject.isValid = false;
      messageObject.message = `In attachment, the object '${field}' is`
        + ` missing the field 'type'.`;
      break;
    }

    const value = item.value;
    const type = item.type;

    if (!isNonEmptyString(type)) {
      messageObject.isValid = false;
      messageObject.message = `The type in all objects in the attachment`
        + ` should be a non-empty string.`;
      break;
    }

    if (value !== '') {
      messageObject.isValid = false;
      messageObject.message = `The value in all objects in the attachment`
        + ` should be an empty string.`;
      break;
    }
  }

  return messageObject;
};


const checkBody = (body) => {
  const messageObject = {
    isValid: true,
    message: null,
  };

  const fields = Object.keys(body);

  for (const field of fields) {
    if (!templateFields.has(field)) {
      messageObject.isValid = false;
      messageObject.message = `The field '${field}' is not allowed.`
        + ` Use ${[...templateFields.keys()]}.`;
      break;
    }

    const value = body[field];

    if (field === 'statusOnCreate' && !activityStatuses.has(value)) {
      messageObject.isValid = false;
      messageObject.message = `${value} is not a valid value for `
        + ` 'statusOnCreate'. Use ${[...activityStatuses.keys()]}`;
      break;
    }

    if (field === 'hidden'
      && !new Set()
        .add(0)
        .add(1)
        .has(value)) {
      messageObject.isValid = false;
      messageObject.message = `The field ${field} can only have the values`
        + ` '0' or '1'`;
      break;
    }

    if (field === 'canEditRule' && !canEditRules.has(value)) {
      messageObject.isValid = false;
      messageObject.message = `${value} is not a valid value for`
        + ` the field 'canEditRule'. Use ${[...canEditRules.keys()]}`;
      break;
    }

    if (new Set()
      .add('venue')
      .add('schedule')
      .has(field)
      && value.length > 0
      && !value.every(isNonEmptyString)) {
      messageObject.isValid = false;
      messageObject.message = `The field ${field} can either be an empty array.`
        + ` Or an array of non-empty strings.`;
      break;
    }
  }

  if (body.hasOwnProperty('attachment')) {
    const attachmentResult = validateAttachment(body.attachment);

    if (!attachmentResult.isValid) {
      messageObject.isValid = false;
      messageObject.message = attachmentResult.message;
    }
  }

  return messageObject;
};


const updateTemplateDoc = (conn, templateDoc) => {
  const batch = db.batch();
  const subject = `Template Updated in the Growthfile DB`;
  const templateObject = templateDoc.data();

  templateObject.timestamp = Date.now();

  /**
   * Replacing the original object with the updated values from
   * the request body since the nested fields in the attachment
   * object are not replaced when the template manager tries to
   * update the attachment object.
   */
  Object
    .keys(conn.req.body)
    .forEach((key) => templateObject[key] = conn.req.body[key]);

  const messageBody = `
  <p>
    The template manager: <strong>${conn.requester.phoneNumber}</strong>
    just updated an existing template: '${conn.req.body.name}' in the
    Growthfile DB.
  <p>
  <p>
    <strong>Template Manager: </strong> ${conn.requester.displayName}
    <br>
    <strong>Template Id</strong>: ${templateDoc.id}
    <br>
    <strong>Template Name</strong>: ${conn.req.body.name}
  </p>

  <hr>

  <h2>Request Body</h2>
  <pre>
  ${JSON.stringify(conn.req.body, ' ', 2)}
  </pre>
  <h2>Template Document</h2>
  <pre>
  ${JSON.stringify(templateObject, ' ', 2)}
  </pre>
  `;

  batch.set(templateDoc.ref, templateObject);

  batch.set(rootCollections
    .instant
    .doc(), {
      messageBody,
      subject,
      action: reportingActions.usedCustomClaims,
      substitutions: {
        templateManagerName: conn.requester.phoneNumber,
        phoneNumber: conn.requester.phoneNumber,
        templateName: templateDoc.get('name'),
        templateId: templateDoc.id,
        time: new Date().toDateString(),
        requestBody: conn.req.body,
      },
    });

  return batch
    .commit()
    .then(() => {
      return {
        success: true,
        code: code.ok,
        message: 'Template Updated successfully',
      };
    })
    .catch((error) => {
      console.error(error);

      return {
        code: code.internalServerError,
        message: 'Something went wrong',
        success: false,
      };
    });
};


module.exports = (conn) => {
  if (!conn.req.body.hasOwnProperty('name')) {
    return {
      success: false,
      message: `The field 'name' is missing from the request body.`,
      code: code.badRequest,
    };
  }

  const result = checkBody(conn.req.body);

  if (!result.isValid) {
    return {
      success: false,
      code: code.badRequest,
      message: result.message,
    };
  }

  return rootCollections
    .activityTemplates
    .where('name', '==', conn.req.body.name)
    .limit(1)
    .get()
    .then((docs) => {
      if (docs.empty) {
        return {
          code: code.conflict,
          message: `No template found with the name: '${conn.req.body.name}'.`,
        };
      }

      const templateDoc = docs.docs[0];

      return updateTemplateDoc(conn, templateDoc);
    })
    .catch((error) => {
      console.error(error);

      return {
        code: code.internalServerError,
        message: 'Something went wrong',
        success: false,
      };
    });
};
