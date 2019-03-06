'use strict';

const {
  code,
} = require('../admin/responses');
const handlebars = require('handlebars');
const templates = require('../webapp/templates');


module.exports = (conn, locals) => {
  const context = {
    officeName: locals.officeDoc.get('office'),
    pageTitle: `About ${locals.officeDoc.get('office')}`,
    aboutOffice: locals.officeDoc.get('attachment.Description.value'),
    pageDescription: locals.officeDoc.get('attachment.Description.value'),
    mainImageUrl: 'https://webapp-test-123.firebaseapp.com/img/stellar-medical.png',
    cannonicalUrl: `https://growthfile.com/${locals.slug}`,
    videoId: locals.officeDoc.get('attachment.Video Id.value'),
    mapsApiKey: 'AIzaSyCadBqkHUJwdcgKT11rp_XWkbQLFAy80JQ',
    branchObjectsArray: locals.branchObjectsArray,
    productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
    slug: locals.slug,
  };

  const source = templates.officeSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.status(code.ok).send(result);
};
