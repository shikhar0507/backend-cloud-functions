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
  createUserInAuth({
    phoneNumber: conn.req.body.phoneNumber,
    displayName: conn.req.body.displayName,
    photoURL: conn.req.body.photoURL,
    email: conn.req.body.email,
  }).then((userRecord) => {
    console.log(userRecord);
    sendResponse(conn, 201, 'CREATED');
    return;
  }).catch((error) => {
    sendResponse(conn, 400, 'BAD REQUEST');
  });
};


module.exports = app;
