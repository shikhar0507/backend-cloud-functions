'use strict';

// TODO: Check this out: https://oembed.com/

const {
  auth,
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

/** 
 * Creates a key-value pair using the cookie object
 * Not using Express, so have to resort to this trickery.
 * 
 * @see https://stackoverflow.com/a/3409200/2758318
 * @param {string} cookies Cookie string from the browser.
 * @returns {object} The cookie object.
 */
const parseCookies = (cookies = '') => {
  const cookieObject = {};

  cookies
    .split(';')
    .forEach((cookie) => {
      const parts = cookie.split('=');

      cookieObject[parts.shift().trim()] = decodeURI(parts.join('='));
    });

  return cookieObject;
};

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

const getLoggedInStatus = (idToken) => {
  console.log('idToken:', idToken, '\n'.repeat(10));

  return auth
    .verifyIdToken(idToken, true)
    .then((decodedIdToken) => auth.getUser(decodedIdToken.uid))
    .then((userRecord) => {
      return {
        uid: userRecord.uid,
        isLoggedIn: true,
        email: userRecord.email,
        phoneNumber: userRecord.phoneNumber,
        photoUrl: userRecord.photoUrl,
        emailVerified: userRecord.emailVerified,
        displayName: userRecord.displayName,
        disabled: userRecord.disabled,
      };
    })
    .catch(() => {
      return {
        uid: null,
        isLoggedIn: false,
        phoneNumber: '',
        photoUrl: '',
        emailVerified: false,
        displayName: '',
        email: '',
        disabled: '',
      };
    });
};

const handleOfficePage = (conn, locals, requester) => {
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
    pageDescription,
    userEmail: requester.email || '',
    userDisplayName: requester.displayName || '',
    userPhoneNumber: requester.phoneNumber || '',
    officeEmployeeSize: locals.officeEmployeeSize,
    officeName: locals.officeDoc.get('office'),
    pageTitle: locals.officeDoc.get('office'),
    mainImageUrl: '/img/logo-main.jpg',
    cannonicalUrl: `https://growthfile.com/${locals.slug}`,
    mapsApiKey: env.mapsApiKey,
    branchObjectsArray: locals.branchObjectsArray,
    productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
    videoId: locals.officeDoc.get('attachment.Video ID.value'),
    slug: locals.slug,
    isLoggedIn: locals.isLoggedIn,
    showPersistentBar: true,
    pageIndexable: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
  });

  return Promise.resolve(html);
};

const fetchOfficeData = (conn, locals, requester) => {
  return Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'branch')
        .get(),
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'product')
        .get(),
    ])
    .then((result) => {
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
          return {
            name: doc.get('attachment.Name.value'),
            imageUrl: doc.get('attachment.Image Url.value'),
            productType: doc.get('attachment.Product Type.value'),
            brand: doc.get('attachment.Brand.value'),
            model: doc.get('attachment.Model.value'),
            size: doc.get('attachment.Size.value'),
          };
        });

      const employeesData = locals.officeDoc.get('employeesData');

      locals.officeEmployeeSize = getEmployeesRange(employeesData);

      return handleOfficePage(conn, locals, requester);
    })
    .catch((error) => helpers.errorPage(conn, error));
};


const handleJoinPage = (locals, requester) => {
  const source = require('./views/join.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Join Growthfile',
    isLoggedIn: locals.isLoggedIn,
    showPersistentBar: false,
    pageIndexable: true,
    pageDescription: 'Join Growthfile',
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
  });

  return html;
};

const handleHomePage = (locals, requester) => {
  const source = require('./views/index.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Growthfile Home',
    pageDescription: 'One app for employees of all offices',
    isLoggedIn: locals.isLoggedIn,
    showPersistentBar: true,
    pageIndexable: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
  });

  return html;
};

const handleDownloadPage = (locals, requester) => {
  const source = require('./views/download.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Download Growthfile App for your Android and iOS Phones',
    pageDescription: 'Download growthfile app for your android and iOS devices',
    isLoggedIn: locals.isLoggedIn,
    showPersistentBar: true,
    pageIndexable: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
  });

  return html;
};

const handle404Page = () => '<h1>Page not found</h1>';

const handleServerError = () => '<h1>Something went wrong</h1>';

const getIdToken = (parsedCookies) => {
  if (!parsedCookies.__session) {
    return '';
  }

  return parsedCookies.__session;
};

module.exports = (req, res) => {
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
  const locals = {
    slug,
    isLoggedIn: false,
  };
  conn.res.setHeader('Content-Type', 'text/html');
  let requester = {};
  const parsedCookies = parseCookies(req.headers.cookie);


  console.log('slug', slug);

  const idToken = getIdToken(parsedCookies);
  let html;

  return getLoggedInStatus(idToken)
    .then((result) => {
      const {
        uid,
        email,
        photoUrl,
        disabled,
        isLoggedIn,
        phoneNumber,
        displayName,
        emailVerified,
      } = result;

      console.log('result', result);

      locals.isLoggedIn = uid !== null;

      if (isLoggedIn) {
        requester = {
          uid,
          email,
          photoUrl,
          disabled,
          phoneNumber,
          displayName,
          emailVerified,
        };
      }

      if (slug === '/' || slug === '') {
        html = handleHomePage(locals, requester);
      }

      if (slug === 'join') {
        html = handleJoinPage(locals, requester);
      }

      if (slug === 'download') {
        html = handleDownloadPage(locals, requester);
      }

      if (html) {
        return conn.res.send(html);
      }

      return rootCollections
        .offices
        .where('slug', '==', slug)
        .limit(1)
        .get();
    })

    .then((snapShot) => {
      if (!snapShot || html) {
        return Promise.resolve();
      }

      if (snapShot.empty) {
        html = handle404Page();

        return conn.res.status(code.notFound).send(html);
      }

      locals.officeDoc = snapShot.docs[0];

      return fetchOfficeData(conn, locals, requester);
    })
    .then((officeHtml) => {
      if (html) {
        return Promise.resolve();
      }

      html = officeHtml;

      return conn.res.send(html);
    })
    .catch((error) => {
      console.error('Error', error);
      const html = handleServerError();

      return conn
        .res
        .status(500)
        .send(html);
    });
};
