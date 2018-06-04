const {
  rootCollections,
} = require('../../admin/admin');

const {
  activityTemplates,
} = rootCollections;

const {
  code,
} = require('../../admin/responses');

const {
  isValidString,
} = require('../activity/helper');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  validateSchedule,
  validateVenue,
  validateAttachment,
} = require('./helpers');


const updateTemplate = (conn, templateData) => {
  activityTemplates.doc(conn.data.docId).set(templateData, {
    /** The request body can contain a partial update, so merging
     * is a safe way to handle this document.
     */
    merge: true,
  }).then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


const createTemplateDocument = (conn) => {
  /** TODO: Verify if updating the name of the template is allowed?? */
  const templateData = {};

  if (typeof conn.req.body.comment === 'string') {
    templateData.comment = conn.req.body.comment;
  }

  if (typeof conn.req.body.defaultTitle === 'string') {
    templateData.defaultTitle = conn.req.body.defaultTitle;
  }

  if (validateSchedule(conn.req.body.schedule)) {
    templateData.schedule = conn.req.body.schedule;
  }

  if (validateVenue(conn.req.body.venue)) {
    templateData.venue = conn.req.body.venue;
  }

  if (validateAttachment(conn.req.body.attachment)) {
    templateData.attachment = conn.req.body.attachment;
  }

  updateTemplate(conn, templateData);
};

const checkTemplateExists = (conn) => {
  activityTemplates.where('name', '==', conn.req.body.name).limit(1)
    .get().then((snapShot) => {
      if (snapShot.empty) {
        sendResponse(
          conn,
          code.conflict,
          `Template with the name: ${conn.req.body.name} does not exist.`
        );
        return;
      }

      conn.data = {};
      conn.data.docId = snapShot.docs[0].id;
      createTemplateDocument(conn);
      return;
    }).catch((error) => handleError(conn, error));
};

const app = (conn) => {
  /** We query the template by name, so name is a required
   * field in the request body.
   */
  // if (!isValidString(conn.req.body.name)) {
  if (typeof conn.req.body.name !== 'string') {
    sendResponse(
      conn,
      code.badRequest,
      'The "name" in the request body is missing/invalid.'
    );
    return;
  }

  if (conn.req.body.name === 'plan') {
    sendResponse(
      conn,
      code.unauthorized,
      'You cannot update the template "plan".'
    );
    return;
  }

  checkTemplateExists(conn);
};

module.exports = app;
