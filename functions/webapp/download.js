'use strict';

const handlebars = require('handlebars');
const templates = require('../webapp/templates');
const {
  code,
} = require('../admin/responses');

module.exports = (conn, locals) => {
  const context = {};

  const source = templates.downloadPageSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.status(code.ok).send(result);
};
