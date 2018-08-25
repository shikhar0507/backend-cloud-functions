'use strict';

const { reportingActions, } = require('../../admin/constants');
const systemReportsHandler = require('./system-reports');

module.exports = (doc) => {
  const action = doc.get('action');

  if (action === reportingActions.usedCustomClaims) {
    return systemReportsHandler(doc);
  }

  return Promise.resolve();
};
