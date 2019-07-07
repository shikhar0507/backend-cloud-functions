'use strict';

const {
  rootCollections,
} = require('../admin/admin');

module.exports = (req, requester) => {
  console.log('requester', requester.customClaims.admin);
  if (requester.isAdmin
    && !requester.customClaims.admin.includes(req.query.office)) {
    return ({});
  }

  // TODO: Handle normal users who are not admins
  // For viewing their own activities like enquiries etc
  if (!requester.isAdmin
    && !requester.isSupport) {
    return ({});
  }

  const assigneePromises = [];
  const json = {};
  let failed = false;

  return rootCollections
    .activities
    .where('office', '==', req.query.office)
    .where('template', '==', req.query.template)
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
