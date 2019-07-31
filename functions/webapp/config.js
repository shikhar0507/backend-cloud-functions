const env = require('../admin/env');

module.exports = conn => {
  return conn
    .res
    .json({
      apiBaseUrl: env.apiBaseUrl,
      getUserBaseUrl: env.getUserBaseUrl,
    });
};
