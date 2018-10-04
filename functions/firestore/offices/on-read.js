'use strict';

const {
  sendJSON,
  handleError,
  convertToDates,
  sendResponse,
  isValidDate,
  hasAdminClaims,
} = require('../../admin/utils');
const {
  rootCollections,
} = require('../../admin/admin');
const {
  code,
} = require('../../admin/responses');


const getReports = (conn, locals) => {
  // TODO: Implement when the report template are completed.
  sendJSON(conn, locals.jsonObject);
};


const getTemplates = (conn, locals) =>
  rootCollections
    .activityTemplates
    .where('timestamp', '>', locals.jsonObject.from)
    .where('timestamp', '<=', locals.jsonObject.upto)
    .get()
    .then((docs) => {
      docs.forEach((doc) => {
        locals.jsonObject.templates[doc.id] = {
          name: doc.get('name'),
          venue: doc.get('venue'),
          schedule: doc.get('schedule'),
          attachment: doc.get('attachment'),
        };
      });

      getReports(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


const getActivities = (conn, locals) =>
  Promise
    .all(locals.activitiesToFetch)
    .then((allOfficeActivities) => {
      /**
       * For each office, there will be an `activity` with the furthest
       * `timestamp`. We are storing the `timestamp` of that `activity` and
       * comparing those values against each other. The **furthest** among
       *  them will be sent as the `upto` time in the read response.
      */
      const furthestTimestamps = [];

      allOfficeActivities
        .forEach((officeActivitiesSnapshot) => {
          const lastDoc =
            officeActivitiesSnapshot
              .docs[officeActivitiesSnapshot.docs.length - 1];
          const office = lastDoc.get('office');
          const timestamp = lastDoc.get('timestamp').toDate();

          furthestTimestamps.push(timestamp.getTime());

          officeActivitiesSnapshot
            .forEach((doc) => {
              locals.jsonObject.activities[doc.id] = {
                office,
                timestamp,
                venue: doc.get('venue'),
                status: doc.get('status'),
                template: doc.get('template'),
                attachment: doc.get('attachment'),
                schedule: convertToDates(doc.get('schedule')),
              };
            });
        });

      locals.jsonObject.upto = new Date(Math.max(...furthestTimestamps));

      getTemplates(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


module.exports = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'GET' for /read`
    );

    return;
  }

  if (!hasAdminClaims(conn.requester.customClaims)) {
    sendResponse(
      conn,
      code.forbidden,
      'You are not allowed to access this resource.'
    );

    return;
  }

  if (!conn.req.query.hasOwnProperty('from')) {
    sendResponse(
      conn,
      code.badRequest,
      `The request URL is missing the 'from' query parameter.`
    );

    return;
  }

  if (!isValidDate(conn.req.query.from)) {
    sendResponse(
      conn,
      code.badRequest,
      `The value in the 'from' query parameter is not a valid unix timestamp.`
    );

    return;
  }

  const from = new Date(parseInt(conn.req.query.from));

  const locals = {
    jsonObject: {
      from,
      upto: from,
      activities: {},
      templates: {},
      reports: {},
    },
    activitiesToFetch: [],
  };

  const promises = [];
  const officeNames = conn.requester.customClaims.admin;

  officeNames.forEach(
    (name) => promises.push(rootCollections
      .offices
      .where('attachment.Name.value', '==', name)
      .get()
    )
  );

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        if (snapShot.empty) return;

        const doc = snapShot.docs[0];
        const timestamp = doc.get('timestamp').toDate();

        if (timestamp.getTime() < from.getTime()) return;

        const status = doc.get('status');

        if (status === 'CANCELLED') return;

        const officeId = doc.id;

        locals.jsonObject.activities[officeId] = {
          status,
          timestamp,
          venue: doc.get('venue'),
          office: doc.get('office'),
          template: doc.get('template'),
          schedule: convertToDates(doc.get('schedule')),
          attachment: doc.get('attachment'),
        };

        locals.activitiesToFetch
          .push(rootCollections
            .offices
            .doc(officeId)
            .collection('Activities')
            .where('timestamp', '>', from)
            .orderBy('timestamp', 'asc')
            .get()
          );
      });

      getActivities(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};
