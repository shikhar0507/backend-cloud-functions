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


const getActivityObject = (doc) => {
  return {
    activityId: doc.id,
    activityName: doc.get('activityName'),
    adminsCanEdit: doc.get('adminsCanEdit'),
    attachment: doc.get('attachment'),
    canEditRule: doc.get('canEditRule'),
    creator: doc.get('creator'),
    hidden: doc.get('hidden'),
    office: doc.get('office'),
    officeId: doc.get('officeId'),
    schedule: convertToDates(doc.get('schedule')),
    status: doc.get('status'),
    template: doc.get('template'),
    timestamp: doc.get('timestamp').toDate(),
    venue: doc.get('venue'),
  };
};


const getTemplateObject = (doc) => {
  return {
    name: doc.get('name'),
    description: doc.get('comment'),
  };
};


const getTemplates = (conn, locals) =>
  rootCollections
    .activityTemplates
    .get()
    .then((docs) => {
      docs
        .forEach((doc) => locals
          .jsonObject
          .templates.push(getTemplateObject(doc)));

      sendJSON(conn, locals.jsonObject);

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

          officeActivitiesSnapshot
            .forEach((doc) => {
              locals.jsonObject.activities.push(getActivityObject(doc));
            });

          if (!lastDoc) return;

          const timestamp = lastDoc.get('timestamp').toDate();

          furthestTimestamps.push(timestamp.getTime());
        });

      /**
       * Handles the case when the `furthestTimestamps` array is empty. Not adding
       * this check makes the upto field equal to `null`.
      */
      if (furthestTimestamps.length > 0) {
        locals.jsonObject.upto = new Date(Math.max(...furthestTimestamps));
      }

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
      'You are not allowed to access this resource'
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
      activities: [],
      templates: [],
    },
    activitiesToFetch: [],
  };

  const promises = [];
  const officeNamesArray = conn.requester.customClaims.admin;

  officeNamesArray
    .forEach((name) => promises
      .push(rootCollections
        .offices
        .where('attachment.Name.value', '==', name)
        .limit(1)
        .get()));

  Promise
    .all(promises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        const doc = snapShot.docs[0];
        const officeId = doc.id;
        const status = doc.get('status');

        if (status === 'CANCELLED') return;

        const promise = rootCollections
          .offices
          .doc(officeId)
          .collection('Activities')
          .where('timestamp', '>', from)
          .where('canEditRule', '==', 'ADMIN')
          .get();

        locals.
          activitiesToFetch
          .push(promise);
      });

      getActivities(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};
