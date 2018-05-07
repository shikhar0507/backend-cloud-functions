const {
  users,
} = require('../../admin/admin');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  getUserByPhoneNumber,
} = users;

const app = (conn) => {
  const promises = [];

  if (Array.isArray(conn.req.query.q)) {
    conn.req.query.q.forEach((val) => {
      promises.push(getUserByPhoneNumber(val));
    });
  } else {
    promises.push(conn.req.query.q);
  }

  Promise.all(promises).then((userRecords) => {
    sendResponse(conn, 200, userRecords);
    return;
  }).catch((error) => {
    console.log(error);
    handleError(conn, error);
  });
};

module.exports = app;
