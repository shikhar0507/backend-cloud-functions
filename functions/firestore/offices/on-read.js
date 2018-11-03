'use strict';

const {
  sendJSON,
  handleError,
  convertToDates,
  sendResponse,
  isValidDate,
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
    // schedule: convertToDates(doc.get('schedule')),
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
    .get()
    .then((docs) => {
      docs.forEach((doc) =>
        locals.jsonObject.templates.push(getTemplateObject(doc)));

      sendJSON(conn, locals.jsonObject);

      return;
    })
    .catch((error) => handleError(conn, error));


const fetchActivities = (conn, locals, promise) =>
  promise
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

  // if (!isValidDate(conn.req.query.from)) {
  //   sendResponse(
  //     conn,
  //     code.badRequest,
  //     `The value in the 'from' query parameter is not a valid unix timestamp`
  //   );

  //   return;
  // }

  if (!conn.req.query.office) {
    sendResponse(
      conn,
      code.badRequest,
      `Invalid query param: ${conn.req.body.office}`
    );

    return;
  }

  const locals = {
    jsonObject: {
      from: conn.req.query.from,
      upto: conn.req.query.from,
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

      const doc = snapShot.docs[0];

      if (doc.get('status') === 'CANCELLED') {
        sendResponse(conn, code.conflict, `This office has been deleted`);

        return;
      }

      fetchActivities(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};
