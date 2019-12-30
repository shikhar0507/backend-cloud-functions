'use strict';

// const { rootCollections } = require('../admin/admin');
// const { sendJSON } = require('../admin/utils');
// const { code } = require('../admin/responses');
// const env = require('../admin/env');

module.exports = async conn => {
  if (conn.req.method === 'GET') {
    return conn.req.query['hub.challenge'];
  }

  return '';
};
