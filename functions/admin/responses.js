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


const code = {
  ok: 200,
  created: 201,
  accepted: 202,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  conflict: 409,
  internalServerError: 500,
  notImplemented: 501,
};


const activityNotFoundError = (activityId) =>
  `No activity found with the id: ${activityId}`;

const invalidMethodError = (methodUsed, expectedMethod) =>
  `${methodUsed} is not allowed. Use ${expectedMethod}`;

const invalidTimestampError = (input) =>
  `${input} is not a valid unix timestamp.`;

const templateNotFoundError = (templateName) =>
  `No template found with the name: ${templateName}`;

const officeNotFoundError = (officeName) =>
  `No office found with the name: ${officeName}`;

const subscriptionAlreadyExistsError = (templateName) =>
  `The user already has the subscription to the template: ${templateName}`;

const officeStatusCancelledError = (officeName) =>
  `The office: ${officeName} is inactive. Cannot proceed.`;

const subscriptionStatusCancelledError = (officeName, templateName) =>
  `Your subscription of ${templateName} in the office ${officeName} is`
  + ` inactive. Cannot proceed.`;

const officeAlreadyExistsError = (officeName) =>
  `An office with the name: ${officeName} already exists.`;


const userNotFoundError = (phoneNumber) =>
  `No user found with the phone number ${phoneNumber}.`;

const activityStatusConflictError = (oldStatus) =>
  `The activity status is already ${oldStatus}.`;

const removingPhoneNumberFromAttachmentError = (phoneNumber) =>
  `Cannot remove the phone number: '${phoneNumber}'`
  + `from the activity. Please use the '/update' endpoint`
  + ` to remove/change this number from/in the attachment.`;

const templateCreationSuccessFul = (templateName) =>
  `Template ${templateName} has been created successfully.`;

const unacceptableMethodUsed = (methodUsed) =>
  `${methodUsed} is not allowed for any request. Please use one of the`
  + ` following: GET, POST, PATCH, PUT`;


const getCustomMessages = {
  activityNotFoundError,
  invalidTimestampError,
  templateNotFoundError,
  officeNotFoundError,
  invalidMethodError,
  subscriptionAlreadyExistsError,
  officeStatusCancelledError,
  subscriptionStatusCancelledError,
  officeAlreadyExistsError,
  userNotFoundError,
  activityStatusConflictError,
  removingPhoneNumberFromAttachmentError,
  templateCreationSuccessFul,
  unacceptableMethodUsed,
};

const staticErrorMessages = {
  editPermissionError: `You cannot edit this activity.`,
  missingQueryParamFromError: `The request URL is missing the query`
    + ` param 'from'.`,
  serverCrashedError: `There was an error handling the request. Please try`
    + ` again later.`,
  lastAssigneeRemovalError: `Cannot remove an assignee from an activity with`
    + ` only one assignee.`,
  activityWithoutAssigneesError: `Cannot create an activity without any`
    + ` assignees.`,
  authorizationHeaderMissingError: `The 'Authorization' header is missing from`
    + ` the request headers.`,
  authorizationHeaderNotStringError: `The 'Authorization' header's value should`
    + ` be a string.`,
  authorizationHeaderNotBearerError: `The 'Authorization' header should start`
    + ` with 'Bearer <idToken>'`,
  accountDisabledError: `Your account is disabled. Cannot proceed.`,
  idTokenRecentlyRevokedError: `The idToken in the request headers was revoked`
    + ` recently. Please re-authenticate again.`,
};


module.exports = { code, getCustomMessages, staticErrorMessages, };
