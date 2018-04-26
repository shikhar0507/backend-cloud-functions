const admin = require('../../admin/admin');
const utils = require('../../admin/utils');
const sendResponse = utils.sendResponse;

const app = (conn) => {
  if (!conn.req.body) {
    sendResponse(conn, 400, 'BAD REQUEST');
    return;
  }
};

module.exports = app;
