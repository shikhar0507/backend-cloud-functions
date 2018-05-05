const {
  users,
} = require('../../admin/admin');

const {
  createUserInAuth,
} = users;

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const app = (conn) => {
  const {
    phoneNumber,
    displayName,
    photoURL,
    email,
  } = conn.req.body;

  createUserInAuth({
    phoneNumber,
    displayName,
    photoURL,
    email,
  }).then((response) => {
    if (response === null) {
      sendResponse(conn, 400, 'BAD REQUEST');
      return;
    }
    sendResponse(conn, 201, 'CREATED');
    return;
  }).catch((error) => {
    sendResponse(conn, 400, 'BAD REQUEST');
  });
};

module.exports = {
  app,
};
