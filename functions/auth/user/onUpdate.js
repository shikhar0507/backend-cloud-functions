const {
  users,
} = require('../../admin/admin');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  updateUserInAuth,
} = users;

const updateUserProfile = (conn) => {
  updateUserInAuth({
    photoURL: conn.req.body.photoURL,
    displayName: conn.req.body.displayName,
    email: conn.req.body.email,
    phoneNumber: conn.req.body.phoneNumber,
  }).then((response) => {
    if (response === null) {
      sendResponse(conn, 400, 'BAD REQUEST');
      return;
    }
    sendResponse(conn, 202, 'ACCEPTED');
    return;
  }).catch((error) => {
    console.log(error);
    handleError(conn, error);
  });
};

const app = (conn) => {
  if (conn.req.body) {
    updateUserProfile(conn);
  }
};

module.exports = {
  app,
};
