const admin = require('../../admin/admin');
const utils = require('../../admin/utils');

const users = admin.users;
const rootCollections = admin.rootCollections;

const sendResponse = utils.sendResponse;
const handleError = utils.handleError;

const getUserByPhoneNumber = users.getUserByPhoneNumber;

const app = (conn) => {
  // http://localhost:5000/contactform-1b262/us-central1/app/services/contact?phoneNumber=%2B918178135274
  getUserByPhoneNumber(conn.req.query.phoneNumber).then((userRecord) => {
    sendResponse(conn, 200, userRecord);
    return;
  }).catch((error) => {
    if (error.code === 'auth/user-not-found') {
      sendResponse(conn, 404, 'NOT FOUND');
      return;
    } else if (error.code === 'auth/invalid-phone-number') {
      sendResponse(conn, 400, 'BAD REQUEST');
    } else {
      handleError(conn, error);
    }
  });
};

module.exports = app;
