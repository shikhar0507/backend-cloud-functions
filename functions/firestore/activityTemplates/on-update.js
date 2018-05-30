const {
  getGeopointObject,
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
  isValidLocation,
  isValidPhoneNumber,
} = require('../activity/helper');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');


const app = (conn) => {
  sendResponse(
    conn,
    code.created,
    'Template updated successfully.'
  );
};

module.exports = app;
