const {
  rootCollections,
} = require('../../admin/admin');

const {
  activityTemplates,
} = rootCollections;

const {
  sendJSON,
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  code,
} = require('../../admin/responses');


const app = (conn) => {
  if (!conn.req.query.name) {
    sendResponse(
      conn,
      code.badRequest,
      'No argument found in the query string. Please add one.'
    );
    return;
  }

  activityTemplates.where('name', '==', conn.req.query.name).limit(1).get()
    .then((snapShot) => {
      if (snapShot.empty) {
        sendResponse(
          conn,
          code.notFound,
          `No template found with the name: ${conn.req.query.name}`
        );
        return;
      }

      sendJSON(conn, snapShot.docs[0].data());
      return;
    }).catch((error) => handleError(conn, error));
};


module.exports = app;
