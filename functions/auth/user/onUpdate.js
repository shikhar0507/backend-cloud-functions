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
  // TODO: Add check whether the requester's uid and phone combination in
  // Profiles matches.
  // 2. Check whether the mobile is being updated
  //  if mobile is not being updated, update the profile
  // 3. If mobile is being updated
  //    TODO: do something when this happens.
  if (conn.req.body.phoneNumber) {
    updateUserInAuth('jy2aZkvpflRXGwxLKip7opC1HqM2', {
      photoURL: conn.req.body.photoURL,
      displayName: conn.req.body.displayName,
      email: conn.req.body.email,
      phoneNumber: conn.req.body.phoneNumber,
    }).then((userRecord) => {
      console.log('returned', data);
      sendResponse(conn, 202, 'ACCEPTED');
      return;
    }).catch((error) => {
      console.log(error);
      handleError(conn, error);
    });
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

const app = (conn) => {
  if (conn.req.body) {
    updateUserProfile(conn);
  }
};

module.exports = app;
