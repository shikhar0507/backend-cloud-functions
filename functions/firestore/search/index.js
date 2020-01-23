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

const { rootCollections } = require('../../admin/admin');
const {
  handleError,
  sendResponse,
  sendJSON,
  hasAdminClaims,
  isNonEmptyString,
  getCanEditValue,
} = require('../../admin/utils');
const { code } = require('../../admin/responses');

const getVenuesWithGp = venues => {
  const result = [];

  venues.forEach(venue => {
    venue.geopoint = {
      latitude: venue.geopoint._latitude || venue.geopoint.latitude,
      longitude: venue.geopoint._longitude || venue.geopoint.longitude,
    };

    result.push(venue);
  });

  return result;
};

module.exports = async conn => {
  if (!hasAdminClaims(conn.requester.customClaims)) {
    return sendResponse(
      conn,
      code.forbidden,
      `You cannot access this resource`,
    );
  }

  console.log('in new search');

  conn.requester.customClaims.admin = conn.requester.customClaims.admin || [];

  conn.req.query.office =
    conn.req.query.office || conn.requester.customClaims.admin[0];

  if (!conn.requester.customClaims.admin.includes(conn.req.query.office)) {
    return sendResponse(conn, code.unauthorized, `Invalid office name`);
  }

  if (
    !isNonEmptyString(conn.req.query.template) &&
    !isNonEmptyString(conn.req.query.attachmentName) &&
    !isNonEmptyString(conn.req.query.attachmentField)
  ) {
    return sendResponse(
      conn,
      code.badRequest,
      `Both 'template' and attachmentName cannot be omitted`,
    );
  }

  if (
    !conn.req.query.hasOwnProperty('template') &&
    !isNonEmptyString(conn.req.query.attachmentName) &&
    !isNonEmptyString(conn.req.query.attachmentField)
  ) {
    return sendResponse(
      conn,
      code.badRequest,
      `The fields 'attachmentName' and attachmentField should be` +
        ` present at the same time.`,
    );
  }

  try {
    let baseQuery = rootCollections.activities.where(
      'office',
      '==',
      conn.req.query.office,
    );

    if (isNonEmptyString(conn.req.query.template)) {
      baseQuery = baseQuery.where('template', '==', conn.req.query.template);
    }

    if (isNonEmptyString(conn.req.query.attachmentName)) {
      baseQuery = baseQuery.where(
        `attachment.${conn.req.query.attachmentField}.value`,
        '==',
        conn.req.query.attachmentName,
      );
    }

    if (isNonEmptyString(conn.req.query.startAfter)) {
      baseQuery = baseQuery.startAfter(conn.req.query.startAfter);
    }

    console.log('baseQuery', JSON.stringify(baseQuery, ' ', 2));

    const activities = await baseQuery.get();
    const assigneePromises = [];
    const json = {};

    console.log('activities', activities.size);

    activities.forEach(doc => {
      assigneePromises.push(
        rootCollections.activities
          .doc(doc.id)
          .collection('Assignees')
          .get(),
      );

      json[doc.id] = {
        assignees: [],
        canEdit: getCanEditValue(doc, conn.requester),
        activityId: doc.id,
        activityName: doc.get('activityName'),
        creator: doc.get('creator'),
        hidden: doc.get('hidden'),
        office: doc.get('office'),
        officeId: doc.get('officeId'),
        schedule: doc.get('schedule'),
        venue: getVenuesWithGp(doc.get('venue')),
        status: doc.get('status'),
        template: doc.get('template'),
        attachment: doc.get('attachment'),
      };
    });

    const snapShots = await Promise.all(assigneePromises);

    snapShots.forEach(snapShot => {
      if (snapShot.empty) {
        return;
      }

      const firstDoc = snapShot.docs[0];
      const activityId = firstDoc.ref.path.split('/')[1];

      json[activityId].assignees = snapShot.docs.map(doc => doc.id);
    });

    return sendJSON(conn, json);
  } catch (error) {
    return handleError(conn, error);
  }
};
