'use strict';

module.exports = (conn) => {
  const context = {};
  const source = templates.homeSource();
  const template = handlebars.compile(source, handlebarsOptions);
  const result = template(context);

  return conn.res.status(code.ok).send(result);
};
