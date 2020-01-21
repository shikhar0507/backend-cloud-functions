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

const {rootCollections} = require('../admin/admin');

module.exports = (req, requester) => {
  console.log('requester', requester.customClaims.admin);
  if (
    requester.isAdmin &&
    !requester.customClaims.admin.includes(req.query.office)
  ) {
    return {};
  }

  // TODO: Handle normal users who are not admins
  // For viewing their own activities like enquiries etc
  if (!requester.isAdmin && !requester.isSupport) {
    return {};
  }

  const assigneePromises = [];
  const json = {};
  let failed = false;

  let query = rootCollections.activities.where(
    'office',
    '==',
    req.query.office,
  );

  if (req.query.query) {
    query = query.where(
      `attachment.${req.query.attachmentField}.value`,
      '==',
      req.query.query,
    );
  }

  if (req.query.template) {
    query = query.where('template', '==', req.query.template);
  }

  if (!req.query.query && !req.query.template) {
    return {};
  }

  return query
    .limit(50)
    .get()
    .then(docs => {
      failed = docs.empty;

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

      docs.forEach(doc => {
        assigneePromises.push(doc.ref.collection('Assignees').get());

        json[doc.id] = {
          assignees: [],
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

      return Promise.all(assigneePromises);
    })
    .then(snapShots => {
      if (failed) {
        return json;
      }

      snapShots.forEach(snapShot => {
        if (snapShot.empty) return;

        const firstDoc = snapShot.docs[0];
        const activityId = firstDoc.ref.path.split('/')[1];

        json[activityId].assignees = snapShot.docs.map(doc => doc.id);
      });

      return json;
    });
};
