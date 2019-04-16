'use strict';

const env = require('../admin/env');
const {
  code,
} = require('../admin/responses');
const handlebars = require('handlebars');
const templates = require('../webapp/templates');
const {
  timezonesSet,
} = require('../admin/constants');


const officePage = (conn, locals) => {
  const description = locals.officeDoc.get('attachment.Description.value') || '';
  const parts = description.split('.');
  let pageDescription = `${parts[0]}.`;

  if (parts[1]) {
    pageDescription += `${parts[1]}`;
  }

  const aboutOffice = (() => {
    if (description) return description;

    return `Description not present.`;
  })();

  const context = {
    aboutOffice,
    officeEmployeeSize: locals.officeEmployeeSize,
    officeName: locals.officeDoc.get('office'),
    pageTitle: `About ${locals.officeDoc.get('office')}`,
    pageDescription: pageDescription,
    mainImageUrl: '/img/logo-main.jpg',
    cannonicalUrl: `https://growthfile.com/${locals.slug}`,
    videoId: locals.officeDoc.get('attachment.Video Id.value'),
    mapsApiKey: env.mapsApiKey,
    branchObjectsArray: locals.branchObjectsArray,
    productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
    displayVideo: Boolean(locals.officeDoc.get('attachment.Video Id.value')),
    slug: locals.slug,
  };

  const source = templates.officeSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  console.log('result', result);

  return conn.res.send(result);
};


const errorPage = (conn, error) => {
  console.error(error);
  const context = {};

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

const downloadAppPage = (conn) => {
  const context = {};
  const source = templates.downloadPageSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.send(result);
};

const pageNotFound = (conn) => {
  const context = {};
  const source = `<h1>Not found<h1>`;
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.status(code.notFound).send(result);
};

const joinPage = (conn) => {
  const context = {
    timezones: Array.from(timezonesSet),
  };
  const source = templates.joinPageSource();
  const template = handlebars.compile(source, { strict: true });
  const result = template(context);

  return conn.res.status(code.ok).send(result);
};


module.exports = {
  joinPage,
  officePage,
  errorPage,
  homePage,
  pageNotFound,
  downloadAppPage,
};
