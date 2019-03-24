'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');


module.exports = (conn) => {
  const activityDoc = {};
  const addendumDoc = {};
  const assignees = [];

  return Promise
    .all([
      rootCollections
        .offices
        .where('attachment.Name.value', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections
        .activityTemplates
        .where('name', '==', 'enquiry')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        officeQuery,
        enquiryTemplateQuery,
      ] = result;

      const locals = {
        batch: db.batch(),
      };

      return;
    })
    .catch((error) => handleError(conn, error));
};
