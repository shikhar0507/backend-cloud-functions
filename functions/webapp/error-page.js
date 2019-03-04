'use strict';

const {
  code,
} = require('../admin/responses');

const handlebars = require('handlebars');


module.exports = (conn, error) => {
  console.error(error);
  const source = `<h1>Something crashed</h1>`;
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.status(code.internalServerError).send(result);
};
