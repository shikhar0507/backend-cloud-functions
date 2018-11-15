'use strict';

const {
  sendJSON,
  handleError,
  sendResponse,
  hasAdminClaims,
  hasSupportClaims,
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
    schedule: doc.get('schedule'),
    status: doc.get('status'),
    template: doc.get('template'),
    timestamp: doc.get('timestamp'),
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
    .where('timestamp', '>', locals.jsonObject.from)
    .get()
    .then((docs) => {
      docs.forEach((doc) =>
        locals.jsonObject.templates.push(getTemplateObject(doc)));

      sendJSON(conn, locals.jsonObject);

      return;
    })
    .catch((error) => handleError(conn, error));


const fetchActivities = (conn, locals) => {
  locals
    .officeRef
    .collection('Activities')
    .where('timestamp', '>', locals.jsonObject.from)
    .get()
    .then((docs) => {
      if (docs.empty) {
        getTemplates(conn, locals);

        return;
      }

      locals
        .jsonObject
        .upto = docs.docs[docs.size - 1].get('timestamp');

      docs.forEach((doc) =>
        locals.jsonObject.activities.push(getActivityObject(doc)));

      getTemplates(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use 'GET' for /read`
    );

    return;
  }

  if (!hasAdminClaims(conn.requester.customClaims)
    && !hasSupportClaims(conn.requester.customClaims)) {
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
      `The request URL is missing the 'from' query parameter`
    );

    return;
  }

  if (!conn.req.query.hasOwnProperty('office')) {
    sendResponse(
      conn,
      code.badRequest,
      `The request URL is missing the 'office' query parameter`
    );

    return;
  }

  const from = Number(conn.req.query.from);

  const locals = {
    jsonObject: {
      from,
      upto: from,
      activities: [],
      templates: [],
    },
  };

  rootCollections
    .offices
    .where('attachment.Name.value', '==', conn.req.query.office)
    .limit(1)
    .get()
    .then((snapShot) => {
      if (snapShot.empty) {
        sendResponse(
          conn,
          code.badRequest,
          `No office found with the name: ${conn.req.query.office}`
        );

        return;
      }

      if (snapShot.docs[0].get('status') === 'CANCELLED') {
        sendResponse(conn, code.conflict, `This office has been deleted`);

        return;
      }

      locals.officeRef = snapShot.docs[0].ref;

      fetchActivities(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};
