'use strict';

const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  handleError,
  sendResponse,
  hasAdminClaims,
  hasSupportClaims,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const {
  isValidRequestBody,
} = require('../../firestore/activity/helper');


module.exports = (conn) => {
  const result = isValidRequestBody(conn.req.body, 'create');
  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  if (conn.req.body.template === 'office' && !hasSupportClaims(conn.requester.customClaims)) {
    sendResponse(conn, code.forbidden, `You cannot access this resource`);

    return;
  }

  if (conn.req.body.template !== 'office' && !hasAdminClaims(conn.requester.customClaims)) {
    sendResponse(conn, code.forbidden, `You cannot access this resource`);

    return;
  }

  const batch = db.batch();

  Promise
    .all([
      rootCollections
        .offices
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', conn.req.body.template)
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        officeDocQuery,
        templateDocQuery,
      ] = result;

      if (templateDocQuery.empty) {
        sendResponse(
          conn,
          code.badRequest,
          `Template '${conn.req.body.template}' not found.`
        );

        return;
      }

      // if (officeDocQuery.empty
      //   && conn.req.body.template !== 'office') {
      //     sendResponse(conn, code.conflict, ``)
      // }

      return batch.commit();
    })
    .catch((error) => handleError(conn, error));
};
