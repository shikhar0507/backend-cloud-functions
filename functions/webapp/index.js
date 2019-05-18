'use strict';

// TODO: Check this out: https://oembed.com/

const {
  auth,
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');
const {
  isNonEmptyString,
  hasAdminClaims,
  hasSupportClaims,
} = require('../admin/utils');
// const helpers = require('./helpers');
const handlebars = require('handlebars');
const url = require('url');
const env = require('../admin/env');

const headPartial = require('./views/partials/head.hbs')();
const headerPartial = require('./views/partials/header.hbs')();
const persistentBarPartial = require('./views/partials/persistent-bar.hbs')();
const footerPartial = require('./views/partials/footer.hbs')();
const scriptsPartial = require('./views/partials/scripts.hbs')();
const asidePartial = require('./views/partials/aside.hbs')();

handlebars.registerPartial('scriptsPartial', scriptsPartial);
handlebars.registerPartial('persistentBarPartial', persistentBarPartial);
handlebars.registerPartial('headPartial', headPartial);
handlebars.registerPartial('headerPartial', headerPartial);
handlebars.registerPartial('footerPartial', footerPartial);
handlebars.registerPartial('asidePartial', asidePartial);

const getIdToken = (parsedCookies) => {
  if (!parsedCookies.__session) {
    return '';
  }

  return parsedCookies.__session;
};

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
  return auth
    .verifyIdToken(idToken, true)
    .then((decodedIdToken) => auth.getUser(decodedIdToken.uid))
    .then((userRecord) => {
      const isAdmin = userRecord.customClaims.admin
      && userRecord.customClaims.admin.length > 0;
      let adminOffices;
      if(isAdmin) {
        adminOffices = userRecord.customClaims.admin;
      }

      return {
        uid: userRecord.uid,
        isLoggedIn: true,
        email: userRecord.email,
        phoneNumber: userRecord.phoneNumber,
        photoURL: userRecord.photoURL,
        emailVerified: userRecord.emailVerified,
        displayName: userRecord.displayName,
        disabled: userRecord.disabled,
        isSupport: userRecord.customClaims.support,
        isAdmin: isAdmin,
        adminOffices: adminOffices,
        isTemplateManager: userRecord.customClaims.manageTemplates,
      };
    })
    .catch(() => {
      return {
        uid: null,
        isLoggedIn: false,
        phoneNumber: '',
        photoURL: '',
        emailVerified: false,
        displayName: '',
        email: '',
        disabled: '',
        isSupport: false,
        isAdmin: false,
        isTemplateManager: false,
      };
    });
};

const handleOfficePage = (locals, requester) => {
  const source = require('./views/office.hbs')();
  const template = handlebars.compile(source, { strict: true });

  const description = locals.officeDoc.get('attachment.Description.value') || '';
  const parts = description.split('.');
  let pageDescription = `${parts[0]}.`;

  if (parts[1]) {
    pageDescription += `${parts[1]}`;
  }

  const logoURL = (() => {
    if (locals.officeDoc.get('attachment.logoURL.value')) {
      return locals.officeDoc.get('attachment.logoURL.value');
    }

    return `img/office-placeholder.jpg`;
  })();

  const html = template({
    logoURL,
    aboutOffice: description,
    pageDescription: pageDescription,
    userEmail: requester.email || '',
    userDisplayName: requester.displayName || '',
    userPhoneNumber: requester.phoneNumber || '',
    officeEmployeeSize: locals.officeEmployeeSize,
    officeName: locals.officeDoc.get('office'),
    pageTitle: `${locals.officeDoc.get('office')} | Growthfile`,
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
    photoURL: requester.photoURL,
    shortDescription: locals.officeDoc.get('attachment.Short Description.value'),
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isTemplateManager: requester.isTemplateManager,
    initOptions: env.webappInitOptions,
  });

  return Promise.resolve(html);
};

const getBranchOpenStatus = () => {
  return null;
};

const fetchOfficeData = (locals, requester) => {
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
      locals.branchObjectsArray = [];

      locals
        .branchDocs
        .forEach((doc) => {
          /** Currently branch has only 1 venue */
          const venue = doc.get('venue')[0];

          if (!venue.geopoint.latitude || !venue.geopoint._latitude) {
            return;
          }

          locals.branchObjectsArray.push({
            name: doc.get('attachment.Name.value'),
            address: venue.address,
            /** Not sure why I'm doing this... */
            latitude: venue.geopoint._latitude || venue.geopoint.latitude,
            longitude: venue.geopoint._longitude || venue.geopoint.longitude,
            weeklyOff: doc.get('attachment.Weekly Off.value'),
            openStatus: getBranchOpenStatus(doc),
          });
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

      return handleOfficePage(locals, requester);
    });
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
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isTemplateManager: requester.isTemplateManager,
    initOptions: env.webappInitOptions,
  });

  return html;
};

const handleHomePage = (locals, requester) => {
  console.log("request",requester);
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
    photoURL: requester.photoURL,
    isSupport: requester.isSupport,
    isAdmin: requester.isAdmin,
    adminOffices:requester.adminOffices,
    isTemplateManager: requester.isTemplateManager,
    initOptions: env.webappInitOptions,
  });

  return html;
};

const handleAuthPage = (locals, requester) => {
  const source = require('./views/auth.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Login to Growthfile',
    pageDescription: '',
    isLoggedIn: locals.isLoggedIn,
    showPersistentBar: false,
    pageIndexable: false,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isTemplateManager: requester.isTemplateManager,
    initOptions: env.webappInitOptions,
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
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isTemplateManager: requester.isTemplateManager,
  });

  return html;
};


const handleContactPage = (locals, requester) => {
  const source = require('./views/contact.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Contact Us | Growthfile',
    pageDescription: 'Please fill the form to contact us',
    isLoggedIn: locals.isLoggedIn,
    showPersistentBar: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isTemplateManager: requester.isTemplateManager,
  });

  return html;
};

const handleTermsAndConditionsPage = (locals, requester) => {
  const source = require('./views/terms-and-conditions.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Terms and Conditions | Growthfile',
    pageDescription: 'Terms and conditions for Growthfile',
    isLoggedIn: locals.isLoggedIn,
    showPersistentBar: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isTemplateManager: requester.isTemplateManager,
  });

  return html;
};

const handle404Page = () => '<h1>Page not found</h1>';

const handleServerError = () => '<h1>Something went wrong</h1>';

const handlePrivacyPolicyPage = (locals, requester) => {
  const source = require('./views/privacy-policy.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const html = template({
    pageTitle: 'Privacy Policy | Growthfile',
    pageDescription: 'Privacy Policy for Growthfile Analytics Pvt. Ltd.',
    isLoggedIn: locals.isLoggedIn,
    showPersistentBar: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isTemplateManager: requester.isTemplateManager,
  });

  return html;
};

const jsonApi = (conn, requester) => {
  console.log("Requester",requester);
  const json = {};
  const allowedTemplates = new Set(['enquiry']);

  if (!requester.uid) {
    return json;
  }

  if (conn.req.query.template 
    && !conn.req.query.office 
    && !conn.req.query.query) {
    if (!allowedTemplates.has(conn.req.query.template)) {
      return json;
    }

    return rootCollections
      .profiles
      .doc(requester.phoneNumber)
      .collection('Activities')
      .where('template', '==', conn.req.query.template)
      .get()
      .then((docs) => {
        docs.forEach((doc) => {
          json[doc.id] = {
            activityId: doc.id,
            status: doc.get('status'),
            canEdit: doc.get('canEdit'),
            schedule: doc.get('schedule'),
            venue: doc.get('venue'),
            timestamp: doc.get('timestamp'),
            template: doc.get('template'),
            office: doc.get('office'),
            attachment: doc.get('attachment'),
            creator: doc.get('creator'),
          }
        });

        return json;
      });
  }

  if (!isNonEmptyString(conn.req.query.office)) {
    
    return json;
  }

  // if (!hasAdminClaims(conn.requester.customClaims)
  //   && !hasSupportClaims(conn.requester.customClaims)) {
  //     console.log("not valid")
  //   return json;
  // }

  // if (hasAdminClaims(conn.requester.customClaims)
  //   && conn.requester.customClaims.admin.includes(conn.req.query.office)) {
  //   return json;
  // }

  return rootCollections
    .offices
    .where('office', '==', conn.req.query.office)
    .limit(1)
    .get()
    .then((docs) => {
      let baseQuery = docs
        .docs[0]
        .ref
        .collection('Activities')
        .where('template', '==', conn.req.query.template);

      if (conn.req.query.query) {
        baseQuery = baseQuery
          .where('searchables', 'array-contains', conn.req.query.query);
      }

      const MAX_RESULTS = 10;

      return baseQuery
        .limit(MAX_RESULTS)
        .get();
    })
    .then((docs) => {
      docs.forEach((doc) => {
        json[doc.id] = {
          activityId: doc.id,
          status: doc.get('status'),
          canEdit: doc.get('canEdit'),
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          timestamp: doc.get('timestamp'),
          template: doc.get('template'),
          activityName: doc.get('activityName'),
          office: doc.get('office'),
          attachment: doc.get('attachment'),
          creator: doc.get('creator'),
          hidden: doc.get('hidden'),
        };
      });

      return json;
    });
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

  conn.res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  conn.res.setHeader('Content-Type', 'text/html');
  let requester = {};
  const parsedCookies = parseCookies(req.headers.cookie);

  console.log('slug', slug);

  const idToken = getIdToken(parsedCookies);
  let html;

  /**
   * Avoids duplicate content issues since there is no native way
   * currently to set up a redirect in the firebase hosting settings.
   */
  if (req.headers['x-forwarded-host'] === env.firebaseDomain) {
    return res
      .status(code.permanentRedirect)
      .redirect(env.mainDomain);
  }

  if (slug === 'config') {
    const json = {
      apiBaseUrl: env.apiBaseUrl,
      getUserBaseUrl: env.getUserBaseUrl,
    };

    conn.res.setHeader('Content-Type', 'application/json');

    return conn.res.json(json);
  }

  return getLoggedInStatus(idToken)
    .then((result) => {
     
      const {
        uid,
        email,
        isAdmin,
        photoURL,
        disabled,
        isSupport,
        isLoggedIn,
        phoneNumber,
        displayName,
        emailVerified,
        isTemplateManager,
      } = result;

      console.log('phoneNumber:', result.phoneNumber);

      locals.isLoggedIn = uid !== null;

      if (isLoggedIn) {
        requester = {
          uid,
          email,
          photoURL,
          disabled,
          phoneNumber,
          displayName,
          emailVerified,
          isAdmin,
          isSupport,
          isTemplateManager,
          
        };
      }

      if (!slug) {
        requester.adminOffices = result.adminOffices;
        html = handleHomePage(locals, requester);
      }

      if (slug === 'contact') {
        html = handleContactPage(locals, requester);
      }

      if (slug === 'privacy-policy') {
        html = handlePrivacyPolicyPage(locals, requester);
      }

      if (slug === 'terms-and-conditions') {
        html = handleTermsAndConditionsPage(locals, requester);
      }

      if (slug === 'join') {
        html = handleJoinPage(locals, requester);
      }

      if (slug === 'download') {
        html = handleDownloadPage(locals, requester);
      }

      if (slug === 'auth' && !locals.isLoggedIn) {
        html = handleAuthPage(locals, requester);
      }

      if (slug === 'auth' && locals.isLoggedIn) {
        return res.status(code.temporaryRedirect).redirect('/');
      }

      if (slug === 'json') {
        return jsonApi(conn, requester);
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

    .then((result) => {
      if (!result || html) {
        return Promise.resolve();
      }

      if (slug === 'json') {
        html = result;

        conn.res.setHeader('Content-Type', 'application/json');

        return conn.res.send(html);
      }

      if (result.empty) {
        html = handle404Page();

        return conn.res.status(code.notFound).send(html);
      }

      locals.officeDoc = result.docs[0];

      return fetchOfficeData(locals, requester);
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
        .status(code.internalServerError)
        .send(html);
    });
};
