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
    pageDescription: '',
    mainImageUrl: '',
    cannonicalUrl: '',
    videoId: locals.officeDoc.get('attachment.Video Id.value'),
    mapsApiKey: '',
    slug: locals.slug,
    // currentYear: new Date().getFullYear(),
    branchObjectsArray: locals.branchObjectsArray,
    // productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
  };

  const source = templates.officeSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.status(code.ok).send(result);
};
