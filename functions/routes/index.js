'use strict';

const url = require('url');


module.exports = (req) => {
  const parsedUrl = url.parse(req.url);
  let checkSupport = req.query.support === 'true';
  let checkAdmin = false;
  let checkSuperuser = false;
  let func;

  switch (parsedUrl.pathname.replace(/^\/|\/$/g, '')) {
    case 'read':
      func = require('../firestore/on-read');
      break;
    case 'now':
      func = require('../firestore/now');
      break;
    case 'dm':
      func = require('../firestore/dm');
      break;
    case 'activities/create':
      func = require('../firestore/activity/on-create');
      break;
    case 'activities/update':
      func = require('../firestore/activity/on-update');
      break;
    case 'activities/change-status':
      func = require('../firestore/activity/on-change-status');
      break;
    case 'activities/comment':
      func = require('../firestore/activity/on-comment');
      break;
    case 'activities/share':
      func = require('../firestore/activity/on-share');
      break;
    case 'admin/search':
      checkAdmin = true;
      checkSupport = true;
      func = require('../firestore/offices/search');
      break;
    case 'admin/bulk':
      checkAdmin = true;
      checkSupport = true;
      func = require('../firestore/bulk/script');
      break;
    case 'admin/change-phone-number':
      checkAdmin = true;
      checkSupport = true;
      func = require('../firestore/phone-number-change');
      break;
    case 'remove-employee':
      checkAdmin = true;
      checkSupport = true;
      func = require('../firestore/employee-resign');
      break;
    case 'services/permissions':
      checkSuperuser = true;
      func = require('../services/on-permissions');
      break;
    case 'services/templates/create':
      func = require('../firestore/activity-templates/on-create');
      break;
    case 'services/templates/update':
      func = require('../firestore/activity-templates/on-update');
      break;
    case 'services/templates/read':
      func = require('../firestore/activity-templates/on-read');
      break;
    case 'services/logs':
      func = require('../services/on-logs');
      break;
    case 'services/images':
      func = require('../services/on-images');
      break;
    case 'parseMail':
      func = require('./../firestore/mail-parser');
      break;
    case 'admin/trigger-report':
      func = require('./../firestore/on-demand-reports');
      break;
    case 'admin/now':
      checkAdmin = true;
      checkSupport = true;
      func = require('./../firestore/offices/now');
      break;
    case 'admin/read':
      checkAdmin = true;
      checkSupport = true;
      func = require('./../firestore/offices/on-read');
      break;
    case 'update-auth':
      checkSupport = true;
      func = require('./../services/update-auth');
      break;
    default:
      func = null;
  }

  return {
    func,
    checkAdmin,
    checkSupport,
    checkSuperuser,
  };
};
