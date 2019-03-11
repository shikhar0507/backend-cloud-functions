'use strict';

const env = require('../admin/env');
const {
  code,
} = require('../admin/responses');
const handlebars = require('handlebars');
const templates = require('../webapp/templates');


const officePage = (conn, locals) => {
  const context = {
    officeName: locals.officeDoc.get('office'),
    pageTitle: `About ${locals.officeDoc.get('office')}`,
    aboutOffice: locals.officeDoc.get('attachment.Description.value'),
    pageDescription: locals.officeDoc.get('attachment.Description.value'),
    mainImageUrl: '',
    cannonicalUrl: `https://growthfile.com/${locals.slug}`,
    videoId: locals.officeDoc.get('attachment.Video Id.value'),
    mapsApiKey: env.mapsApiKey,
    branchObjectsArray: locals.branchObjectsArray,
    productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
    slug: locals.slug,
  };

  const source = templates.officeSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.send(result);
};


const errorPage = (conn, error) => {
  console.error(error);

  const source = `<h1>Something crashed</h1>`;
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.status(code.internalServerError).send(result);
};

const homePage = (conn) => {
  const context = {
    pageTitle: 'Growthfile Home',
    pageDescription: 'One app for employees of all businesses',
    mainImageUrl: '/img/logo-main.jpg',
    cannonicalUrl: 'https://growthfile.com',
  };
  const source = templates.homeSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.send(result);
};

const downloadAppPage = (conn, locals) => {
  const context = {};

  const source = templates.downloadPageSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.send(result);
};

const pageNotFound = (conn, locals) => {
  const context = {};

  const source = templates.pageNotFoundSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.status(code.notFound).send(result);
};


module.exports = {
  officePage,
  errorPage,
  homePage,
  pageNotFound,
  downloadAppPage,
};
