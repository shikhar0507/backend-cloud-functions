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

// https://firebase.google.com/docs/reference/node/firebase.User
const app = (conn) => {
  // sample data
  /** {
    "phoneNumber": "+919999434325",
    "displayName": "Vikas Bhatt",
    "photoURL": "https://google.com/photo.png",
    "email": "vikas@gmail.com"
  } **/
  createUserInAuth({
    phoneNumber: conn.req.body.phoneNumber,
    displayName: conn.req.body.displayName,
    photoURL: conn.req.body.photoURL,
    // email: conn.req.body.email || null,
  }).then((userRecord) => {
    console.log(userRecord);
    sendResponse(conn, 201, 'CREATED');
    return;
  }).catch((error) => {
    if (error.code === 'auth/phone-number-already-exists') {
      sendResponse(conn, 200, error.message);
      return;
    } else if (error.code === 'auth/invalid-email') {
      sendResponse(conn, 200, error.message);
      return;
    }
    console.log(error);
    sendResponse(conn, 400, 'BAD REQUEST');
  });
};


module.exports = app;
