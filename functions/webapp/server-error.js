'use strict';

const {
  code,
} = require('../admin/responses');

module.exports = (conn, error) => {
  console.error(error);

  return conn
    .res
    .status(code.internalServerError)
    .send('Something went wrong');
};
