'use strict';

// TODO: Check this out: https://oembed.com/

const {
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');
const helpers = require('./helpers');
const handlebars = require('handlebars');
const url = require('url');
const env = require('../admin/env');

const headPartial = require('./views/partials/head.hbs')();
const headerPartial = require('./views/partials/header.hbs')();
const persistentBarPartial = require('./views/partials/persistent-bar.hbs')();
const footerPartial = require('./views/partials/footer.hbs')();
handlebars.registerPartial('persistentBarPartial', persistentBarPartial);
handlebars.registerPartial('headPartial', headPartial);
handlebars.registerPartial('headerPartial', headerPartial);
handlebars.registerPartial('footerPartial', footerPartial);

const getEmployeesRange = (employeesData) => {
  const employeesList = Object.keys(employeesData);
  const officeSize = employeesList.length;

  if (officeSize >= 0 && officeSize <= 10) {
    return `1-10`;
  }

  if (officeSize > 10 && officeSize <= 100) {
    return `10-100`;
  }

  if (officeSize > 500 && officeSize <= 1000) {
    return `500+`;
  }

  return `1000+`;
};

const getSlugFromUrl = (requestUrl) => {
  const parsed = url.parse(requestUrl);
  const officeName = parsed.pathname;

  return officeName.split('/')[1];
};

const handleOfficePage = (conn, locals) => {
  const source = require('./views/office.hbs')();
  const template = handlebars.compile(source, { strict: true });

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

  const html = template({
    aboutOffice,
    officeEmployeeSize: locals.officeEmployeeSize,
    officeName: locals.officeDoc.get('office'),
    pageTitle: `About ${locals.officeDoc.get('office')}`,
    pageDescription: pageDescription,
    mainImageUrl: '/img/logo-main.jpg',
    cannonicalUrl: `https://growthfile.com/${locals.slug}`,
    mapsApiKey: env.mapsApiKey,
    branchObjectsArray: locals.branchObjectsArray,
    productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
    // videoId: locals.officeDoc.get('attachment.Video ID.value'),
    // displayVideo: Boolean(locals.officeDoc.get('attachment.Video ID.value')),
    videoId: 'Sx9SJBoUAT4',
    displayVideo: true,
    slug: locals.slug,
  });

  return conn.res.send(html);
};


const fetchOfficeData = (conn, locals) => {
  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'branch')
        .limit(10)
        .get(),
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'product')
        .limit(10)
        .get(),
    ])
    .then((result) => {
      if (!result) {
        return Promise.resolve();
      }

      const [branchQuery, productQuery] = result;

      locals.branchDocs = branchQuery.docs;
      locals.productDocs = productQuery.docs;

      locals
        .branchObjectsArray = branchQuery.docs.map((doc) => {
          return {
            name: doc.get('attachment.Name.value'),
            address: doc.get('venue')[0].address,
            latitude: doc.get('venue')[0].geopoint._latitude,
            longitude: doc.get('venue')[0].geopoint._longitude,
            weeklyOff: doc.get('attachment.Weekly Off.value'),
          };
        });

      locals
        .productObjectsArray = productQuery.docs.map((doc) => {
          const name = doc.get('attachment.Name.value');

          const imageUrl = (() => {
            if (doc.get('attachment.Image Url.value')) {
              return doc.get('attachment.Image Url.value');
            }

            return 'img/product-placeholder.png';
          })();

          return {
            name,
            productDetails: JSON.stringify({
              name,
              imageUrl,
              productType: doc.get('attachment.Product Type.value'),
              brand: doc.get('attachment.Brand.value'),
              model: doc.get('attachment.Model.value'),
              size: doc.get('attachment.Size.value'),
            }),
          };
        });

      const employeesData = locals.officeDoc.get('employeesData');
      locals.officeEmployeeSize = getEmployeesRange(employeesData);

      // return helpers.officePage(conn, locals);
      return handleOfficePage(conn, locals);
    })
    .catch((error) => helpers.errorPage(conn, error));
};

const handleJoinPage = (conn) => {
  const source = require('./views/join.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Join Growthfile',
    showLoginButton: true,
    showPersistentBar: false,
  });

  return conn.res.send(html);
};

const handleHomePage = (conn) => {
  const source = require('./views/index.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Growthfile Home',
    pageDescription: 'One app for employees of all offices',
    showLoginButton: true,
    showPersistentBar: true,
  });

  return conn.res.send(html);
};

const handleDownloadPage = (conn) => {
  const source = require('./views/download.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Download Growthfile App',
    pageDescription: `Download growthfile app for your android and iOS devices.`,
    showLoginButton: true,
    showPersistentBar: true,
  });

  return conn.res.send(html);
};


const app = (req, res) => {
  if (req.method !== 'GET') {
    return res
      .status(code.methodNotAllowed)
      .json({
        success: false,
        errors: [{
          message: `Method not allowed. Use 'GET'`,
        }],
      });
  }

  // https://firebase.google.com/docs/hosting/full-config#glob_pattern_matching
  const slug = getSlugFromUrl(req.url);
  const conn = { req, res };
  const locals = { slug };

  console.log('slug:', slug);

  conn.res.setHeader('Content-Type', 'text/html');

  if (slug === '/' || slug === '') {
    return handleHomePage(conn);
  }

  if (slug === 'join') {
    return handleJoinPage(conn);
    // return helpers.joinPage(conn);
  }

  if (slug === 'download') {
    // return helpers.downloadAppPage(conn);
    return handleDownloadPage(conn);
  }


  /**
   * const context = variables object
   * source = html
   * template = handlebars.compile(source, handlebarsOptions) // {strict: true}
   * result = template(context);
   * return result;
   */
  return rootCollections
    .offices
    .where('slug', '==', slug)
    .limit(1)
    .get()
    .then((docs) => {
      if (docs.empty) {
        return helpers.pageNotFound(conn);
      }

      locals.officeDoc = docs.docs[0];

      return fetchOfficeData(conn, locals);
    })
    .catch((error) => helpers.errorPage(conn, error));
};

module.exports = app;
