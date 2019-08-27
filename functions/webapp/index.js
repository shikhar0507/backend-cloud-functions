'use strict';

// TODO: Check this out: https://oembed.com/

const {
  auth,
  db,
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');
const {
  isNonEmptyString,
  hasAdminClaims,
  hasSupportClaims,
  getEmployeesMapFromRealtimeDb,
} = require('../admin/utils');
const {
  dateFormats,
  httpsActions,
} = require('../admin/constants');
const {
  toMapsUrl,
} = require('../firestore/recipients/report-utils');
const url = require('url');
const env = require('../admin/env');
const admin = require('firebase-admin');
const momentTz = require('moment-timezone');
const handlebars = require('handlebars');

const headPartial = require('./views/partials/head.hbs')();
const headerPartial = require('./views/partials/header.hbs')();
const footerPartial = require('./views/partials/footer.hbs')();
const scriptsPartial = require('./views/partials/scripts.hbs')();
const actionsAside = require('./views/partials/actions-aside.hbs')();
const featuredPartial = require('./views/partials/featured.hbs')();
const headerProfileIcon = require('./views/partials/header-profile-icon.hbs')();
const appFeaturesPartial = require('./views/partials/app-features.hbs')();
const heroPartial = require('./views/partials/hero.hbs')();
const enquiryPartial = require('./views/partials/enquiry.hbs')();

handlebars.registerPartial('scriptsPartial', scriptsPartial);
handlebars.registerPartial('headPartial', headPartial);
handlebars.registerPartial('headerPartial', headerPartial);
handlebars.registerPartial('footerPartial', footerPartial);
handlebars.registerPartial('actionsAside', actionsAside);
handlebars.registerPartial('featuredPartial', featuredPartial);
handlebars.registerPartial('headerProfileIcon', headerProfileIcon);
handlebars.registerPartial('appFeaturesPartial', appFeaturesPartial);
handlebars.registerPartial('heroPartial', heroPartial);
handlebars.registerPartial('enquiryPartial', enquiryPartial);

const sendHTML = (conn, html) => conn.res.send(html);
const sendJSON = (conn, json) => conn.res.json(json);
const sendXML = (conn, xml) => {
  conn
    .res
    .set('Content-Type', 'text/xml');

  return conn.res.send(xml);
};


const getStaticMapsUrl = (branchObjectsArray) => {
  let url = `https://maps.googleapis.com/maps/api/`
    + `staticmap?center=New+Delhi&zoom=13&maptype=roadmap`;

  branchObjectsArray.forEach(branch => {
    const { gp } = branch;

    if (!gp || !gp.latitude || !gp.longitude) return;

    url += `&markers=color:blue%7C${gp.latitude},${gp.longitude}`;
  });

  return `${url}&size=854x480&key=${env.mapsApiKey}`;
};

/**
 * Creates a key-value pair using the cookie object
 * Not using Express, so have to resort to this trickery.
 *
 * @see https://stackoverflow.com/a/3409200/2758318
 * @param {string} cookies Cookie string from the browser.
 * @returns {object} The cookie object.
 */
const parseCookies = headers => {
  const cookies = headers.cookie || '';
  const cookieObject = {};

  cookies
    .split(';')
    .forEach(cookie => {
      const parts = cookie.split('=');

      cookieObject[parts.shift().trim()] = decodeURI(parts.join('='));
    });

  const getIdToken = parsedCookies => {
    if (!parsedCookies.__session) {
      return '';
    }

    return parsedCookies.__session;
  };

  const idToken = getIdToken(cookieObject);

  if (idToken) return idToken;

  if (!headers.authorization
    || typeof headers.authorization !== 'string'
    || !headers.authorization.startsWith('Bearer ')) {
    return '';
  }

  return headers.authorization.split('Bearer ')[1];
};

const getEmployeesRange = (employeesData = {}) => {
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

const getSlugFromUrl = requestUrl => {
  const parsed = url.parse(requestUrl);
  const officeName = parsed.pathname;

  return officeName.split('/')[1];
};

const getBranchOpenStatus = doc => {
  const result = {
    isOpen: false,
    isClosed: false,
    isClosingSoon: false,
    openingTime: '',
    closingTime: '',
  };

  const weekdayStartTime = doc.get('attachment.Weekday Start Time.value');
  const weekdayEndTime = doc.get('attachment.Weekday End Time.value');
  const saturdayStartTime = doc.get('attachment.Saturday Start Time.value');
  const saturdayEndTime = doc.get('attachment.Saturday End Time.value');
  const weeklyOff = doc.get('attachment.Weekly Off.value');

  // Nothing is set
  if (!weekdayStartTime
    && !weekdayEndTime
    && !saturdayStartTime
    && !saturdayEndTime
    && !weeklyOff) {
    return result;
  }

  const currentMoment = momentTz();
  const currentTimestamp = currentMoment
    .valueOf();
  const todaysDay = currentMoment
    .format('dddd')
    .toLowerCase();
  const MILLS_IN_1_HOUR = 3600000;
  const isSaturday = todaysDay === 'saturday';

  if (todaysDay === weeklyOff) {
    result.isClosed = true;
    const nextDayMoment = currentMoment
      .startOf('day')
      .add(1, 'day');
    const isNextDaySaturday = nextDayMoment
      .format('dddd')
      .toLowerCase() === 'saturday';

    if (isNextDaySaturday) {
      result
        .openingTime = momentTz(saturdayStartTime)
          .format(dateFormats.TIME);

      return result;
    }

    result
      .openingTime = momentTz(weekdayStartTime)
        .format(dateFormats.DATE);

    return result;
  }

  if (isSaturday) {
    if (currentMoment < saturdayStartTime
      || currentMoment > saturdayEndTime) {
      result.isClosed = true;
      result.openingTime = momentTz(saturdayStartTime)
        .format(dateFormats.TIME);

      return result;
    }

    if (currentMoment >= saturdayStartTime
      && currentMoment <= saturdayEndTime) {
      result.isOpen = true;

      return result;
    }

    result.isOpen = true;

    return result;
  }

  if (weekdayStartTime >= currentTimestamp
    && weekdayEndTime <= currentTimestamp) {
    const diff = weekdayEndTime - currentTimestamp;

    if (diff <= MILLS_IN_1_HOUR) {
      result.isClosingSoon = true;
      result.closingTime = momentTz(weekdayEndTime)
        .format(dateFormats.TIME);

      return result;
    }

    result.isOpen = true;

    return result;
  }

  return result;
};

const handleOfficePage = async (locals, requester) => {
  const source = require('./views/office.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const description = (() => {
    if (env.isProduction) {
      return locals
        .officeDoc
        .get('attachment.Description.value') || '';
    }

    return `Contrary to popular belief, Lorem`
      + ` Ipsum is not simply random text.`;
  })();

  const logoURL = (() => {
    if (locals.officeDoc.get('attachment.Company Logo.value')) {
      return locals.officeDoc.get('attachment.Company Logo.value');
    }

    const slug = locals.officeDoc.get('slug');

    return `img/logo-${slug}.png`;
  })();

  const videoId = (() => {
    if (env.isProduction) {
      return locals.officeDoc.get('attachment.Youtube ID.value');
    }

    // NOTE: Just for testing
    return 'jCyEX6u-Yhs';
  })();

  const shortDescription = (() => {
    if (env.isProduction) {
      return locals.officeDoc.get('attachment.Short Description.value') || '';
    }

    return `Lorem Ipsum is simply dummy text of the`
      + ` printing and typesetting industry.`;
  })();

  const employeesData = await getEmployeesMapFromRealtimeDb(
    locals.officeDoc.get('officeId')
  );

  return template({
    logoURL,
    videoId,
    shortDescription,
    aboutOffice: description,
    pageDescription: shortDescription,
    userEmail: requester.email || '',
    userDisplayName: requester.displayName || '',
    userPhoneNumber: requester.phoneNumber || '',
    officeEmployeeSize: getEmployeesRange(employeesData),
    officeName: locals.officeDoc.get('office'),
    pageTitle: `${locals.officeDoc.get('office')} | Growthfile`,
    mainImageUrl: '/img/logo-main.jpg',
    cannonicalUrl: `${env.mainDomain}/${locals.slug}`,
    mapsApiKey: env.mapsApiKey,
    branchObjectsArray: locals.branchObjectsArray,
    staticMapsUrl: getStaticMapsUrl(locals.branchObjectsArray),
    productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
    slug: locals.slug,
    isLoggedIn: !!requester.uid,
    pageIndexable: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isProduction: env.isProduction,
    officeFirstChar: locals.officeDoc.get('office').charAt(0),
    pageUrl: `https://growthfile.com/${locals.slug}`,
  });
};


const fetchOfficeData = async (locals, requester) => {
  const timezone = locals.officeDoc.get('attachment.Timezone.value');
  const [branchQuery, productQuery] = await Promise
    .all([
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'branch')
        .where('status', '==', 'CONFIRMED')
        .get(),
      locals
        .officeDoc
        .ref
        .collection('Activities')
        .where('template', '==', 'product')
        .where('status', '==', 'CONFIRMED')
        .get(),
    ]);

  branchQuery
    .forEach(doc => {
      /** Currently branch has only 1 venue */
      const venue = doc.get('venue')[0];

      if (!venue.geopoint.latitude
        || !venue.geopoint._latitude) {
        return;
      }

      const openStatusResult = getBranchOpenStatus(doc, timezone);
      let isOpen = openStatusResult.isOpen;
      let isClosed = openStatusResult.isClosed;
      let closingTime = openStatusResult.closingTime;
      let openingTime = openStatusResult.openingTime;
      let isClosingSoon = openStatusResult.isClosingSoon;

      // Dates are not set
      if (isClosed
        && closingTime === 'Invalid date'
        || openingTime === 'Invalid date') {
        isClosed = false;
        isOpen = true;
        openingTime = '';
        closingTime = '';
      }

      const branchContact = (() => {
        if (env.isProduction) {
          return doc.get('attachment.First Contact.value')
            || doc.get('attachment.Second Contact.value') || '';
        }

        /** Some random number for testing environments*/
        return `+919${Math.random().toString().slice(2, 12)}`;
      })();

      const latitude = venue
        .geopoint
        ._latitude
        || venue.geopoint.latitude;
      const longitude = venue
        .geopoint
        ._longitude
        || venue.geopoint.longitude;

      locals
        .branchObjectsArray
        .push({
          isOpen,
          isClosed,
          isClosingSoon,
          openingTime,
          closingTime,
          branchContact,
          latitude,
          longitude,
          address: venue.address,
          name: doc.get('attachment.Name.value'),
          weeklyOff: doc.get('attachment.Weekly Off.value'),
          mapsUrl: toMapsUrl({ latitude, longitude }),
          gp: { latitude, longitude },
        });
    });

  const office = locals.officeDoc.get('office');

  locals
    .productObjectsArray = productQuery
      .docs
      .map(doc => {
        const name = doc.get('attachment.Name.value');
        const imageUrl = `img/${name}-${office}.png`.replace(/\s+/g, '-');

        return {
          imageUrl,
          name,
          nameFirstChar: name.charAt(0),
          productType: doc.get('attachment.Product Type.value'),
          brand: doc.get('attachment.Brand.value'),
          model: doc.get('attachment.Model.value'),
          size: doc.get('attachment.Size.value'),
        };
      });

  return handleOfficePage(locals, requester);
};

const handleJoinPage = (locals, requester) => {
  const source = require('./views/join.hbs')();
  const template = handlebars.compile(source, { strict: true });

  return template({
    pageTitle: 'Join Growthfile',
    isLoggedIn: !!requester.uid,
    pageIndexable: true,
    pageDescription: 'Join Growthfile',
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isProduction: env.isProduction,
    pageUrl: `https://growthfile.com/${locals.slug}`,
  });
};

const handleHomePage = (locals, requester) => {
  const source = require('./views/index.hbs')();
  const template = handlebars.compile(source, { strict: true });

  return template({
    user: JSON.stringify({
      isSupport: requester.isSupport,
      admin: requester.isAdmin,
    }),
    mapsApiKey: env.mapsApiKey,
    pageTitle: 'Growthfile Home',
    pageDescription: 'One app for employees of all offices',
    isLoggedIn: !!requester.uid,
    /** Person is Support or already an admin of an office */
    pageIndexable: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.isSupport,
    isAdmin: requester.isAdmin,
    adminOffices: requester.adminOffices,
    isProduction: env.isProduction,
    isAdminOrSupport: requester.isAdmin || requester.isSupport,
    showActions: requester.isAdmin || requester.isSupport,
    pageUrl: `https://growthfile.com/${locals.slug}`,
  });
};

const handleAuthPage = (locals, requester) => {
  const source = require('./views/auth.hbs')();
  const template = handlebars.compile(source, { strict: true });

  return template({
    pageTitle: 'Login to Growthfile',
    pageDescription: '',
    isLoggedIn: !!requester.uid,
    pageIndexable: false,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isProduction: env.isProduction,
    pageUrl: `https://growthfile.com/${locals.slug}`,
  });
};

const handleDownloadPage = (locals, requester) => {
  const source = require('./views/download.hbs')();
  const template = handlebars.compile(source, { strict: true });
  return template({
    pageTitle: 'Download Growthfile App for your Android and iOS Phones',
    pageDescription: 'Download growthfile app for your android and iOS devices',
    isLoggedIn: !!requester.uid,
    pageIndexable: true,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isProduction: env.isProduction,
    pageUrl: `https://growthfile.com/${locals.slug}`,
  });
};

const handleContactPage = (locals, requester) => {
  const source = require('./views/contact.hbs')();
  const template = handlebars.compile(source, { strict: true });

  return template({
    pageTitle: 'Contact Us | Growthfile',
    pageDescription: 'Please fill the form to contact us',
    isLoggedIn: !!requester.uid,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isProduction: env.isProduction,
    pageUrl: `https://growthfile.com/${locals.slug}`,
  });
};

const handleTermsAndConditionsPage = (locals, requester) => {
  const source = require('./views/terms-and-conditions.hbs')();
  const template = handlebars.compile(source, { strict: true });

  return template({
    pageTitle: 'Terms and Conditions | Growthfile',
    pageDescription: 'Terms and conditions for Growthfile',
    isLoggedIn: !!requester.uid,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isProduction: env.isProduction,
    pageUrl: `https://growthfile.com/${locals.slug}`,
  });
};

const handle404Page = conn => {
  return conn
    .res
    .status(code.notFound)
    .send('<h1>Page not found</h1>');
};

const handleServerError = conn => {
  return conn
    .res
    .status(code.internalServerError)
    .send('<h1>Something went wrong</h1>');
};

const handlePrivacyPolicyPage = (locals, requester) => {
  const source = require('./views/privacy-policy.hbs')();
  const template = handlebars.compile(source, { strict: true });

  return template({
    pageTitle: 'Privacy Policy | Growthfile',
    pageDescription: 'Privacy Policy for Growthfile Analytics Pvt. Ltd.',
    isLoggedIn: !!requester.uid,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isProduction: env.isProduction,
    pageUrl: `https://growthfile.com/${locals.slug}`,
  });
};

function getTemplatesListJSON(name) {
  let baseQuery = rootCollections
    .activityTemplates;

  const query = (() => {
    if (name) {
      baseQuery = baseQuery
        .where('name', '==', name)
        .limit(1);
    }

    return baseQuery;
  })();

  return query
    .get()
    .then(docs => {
      const json = {};

      docs.forEach(doc => {
        const data = doc.data();
        delete data.timestamp;

        json[doc.id] = data;
      });

      return json;
    });
}

const handleJsonGetRequest = (conn, requester) => {
  const json = {};

  if (!requester.uid) {
    return Promise.resolve({});
  }

  if (conn.req.query.action === 'office-list'
    && requester.isSupport) {
    return rootCollections
      .offices
      .get()
      .then(docs => {
        return json.names = docs.docs.map(doc => doc.get('office'));
      });
  }

  if ((requester.isAdmin || requester.isSupport)
    && conn.req.query.action === 'view-templates') {
    return getTemplatesListJSON(conn.req.query.name);
  }

  if ((requester.isAdmin || requester.isSupport)
    && conn.req.query.action === 'get-template-names') {
    return rootCollections
      .activityTemplates
      .get()
      .then(docs => {
        return docs.docs.map(doc => {
          const name = doc.get('name');

          if (name !== 'check-in') return name;
        });
      });
  }

  if (!isNonEmptyString(conn.req.query.office)) {
    return Promise.resolve(json);
  }

  /** Not allowed to read stuff unless the user is admin or support */
  if (!hasAdminClaims(requester.customClaims)
    && !hasSupportClaims(requester.customClaims)) {
    return Promise.resolve(json);
  }

  /**
   * Admin claims are found, but the claims.admin array doesn't contain
   * the office which which was sent in the request body.
   */
  if (hasAdminClaims(requester.customClaims)
    && !requester.customClaims.admin.includes(conn.req.query.office)) {

    return Promise.resolve(json);
  }

  return require('./search')(conn.req, requester);
};

const handleOfficeJoinRequest = (conn, requester) => {
  conn.requester = {
    uid: requester.uid,
    phoneNumber: requester.phoneNumber,
    displayName: conn.requester.displayName,
    photoURL: conn.requester.photoURL,
  };

  return ({});
};

const handleAnonymousView = async (conn, requester) => {
  // put stuff in /Anonymous
  // if pageview is for an office page --> create an addendum
  await rootCollections
    .anonymous
    .doc()
    .set({
      uid: requester.uid,
      timestamp: Date.now(),
      context: conn.req.body,
      action: httpsActions.webapp,
    });

  return ({ success: true, });
};

const handleKnownUserView = async (conn, requester) => {
  // Put stuff in /Profiles/<phoneNumber>/Webapp/<autoid>
  // if pageview is for an office page -> create an addendum
  const batch = db.batch();
  const ref = rootCollections
    .profiles
    .doc(requester.phoneNumber)
    .collection('Webapp')
    .doc();

  batch
    .set(ref, {
      uid: requester.uid,
      phoneNumber: requester.phoneNumber,
      context: conn.req.body,
      action: httpsActions.webapp,
    });

  if (!conn.req.body.office) {
    await batch
      .commit();

    return ({ success: true });
  }

  const officeDocQueryResult = await rootCollections
    .offices
    .where('office', '==', conn.req.body.office)
    .limit(1)
    .get();

  if (officeDocQueryResult.empty) {
    return ({
      success: false,
      message: `Office: ${conn.req.body.office} not found`,
    });
  }

  const doc = officeDocQueryResult
    .docs[0]
    .ref
    .collection('Webapp')
    .doc();

  batch.set(doc, {
    timestamp: Date.now(),
    user: requester.phoneNumber,
    uid: requester.uid,
    context: conn.req.body,
    action: httpsActions.webapp,
  });

  await batch
    .commit();

  return ({ success: true });
};

const handleTrackViews = (conn, requester) => {
  if (conn.requester.isAnonymous) {
    return handleAnonymousView(conn, requester);
  }

  return handleKnownUserView(conn, requester);
};

const handleJsonPostRequest = (conn, requester) => {
  const json = {};

  if (!conn.req.query.action) {
    return json;
  }

  if (conn.req.query.action === 'update-auth') {
    return require('./update-auth')(conn, requester);
  }

  if (conn.req.query.action === 'track-view') {
    return handleTrackViews(conn, requester);
  }

  if (conn.req.query.action === 'parse-mail'
    && conn.req.query.token === env.sgMailParseToken) {
    conn.requester = {
      phoneNumber: requester.phoneNumber,
      uid: requester.uid,
      customClaims: requester.customClaims,
      email: requester.email,
      displayName: requester.displayName,
      photoURL: requester.photoURL,
      isSupportRequest: conn.req.query.isSupport === 'true',
    };

    return require('../firestore/mail-parser')(conn);
  }

  if (conn.req.query.action === 'track-mail') {
    return require('../firestore/track-mail')(conn);
  }

  if (conn.req.query.action === 'create-office') {
    return handleOfficeJoinRequest(conn);
  }

  return json;
};

const jsonApi = async (conn, requester) => {
  if (conn.req.method === 'POST') {
    return handleJsonPostRequest(conn, requester);
  }

  return handleJsonGetRequest(conn, requester);
};


const handleEmailVerificationFlow = async conn => {
  if (!isNonEmptyString(conn.req.query.uid)) {
    return conn
      .res
      .status(code.temporaryRedirect)
      .redirect('/');
  }

  const updatesDoc = await rootCollections
    .updates
    .doc(conn.req.query.uid)
    .get();

  const verificationRequestsCount = updatesDoc
    .get('verificationRequestsCount') || 0;

  if (!updatesDoc.exists
    || !updatesDoc.get('emailVerificationRequestPending')
    /**
     * This user has already requested 3 verification
     * emails. This will prevent abuse of the system
     */
    || verificationRequestsCount >= 3) {
    return conn
      .res
      .status(code.temporaryRedirect)
      .redirect('/');
  }

  const phoneNumber = updatesDoc.get('phoneNumber');
  const uid = updatesDoc.get('uid');

  if (verificationRequestsCount >= 3) {
    await rootCollections
      .instant
      .doc()
      .set({
        subject: `Verification requests count: ${verificationRequestsCount}`,
        messageBody: `User: ${JSON.stringify({ phoneNumber, uid }, ' ', 2)}`,
      });

    return conn
      .res
      .status(code.temporaryRedirect)
      .redirect('/');
  }

  const promises = [
    auth
      .updateUser(conn.req.query.uid, {
        emailVerified: true,
      }),
    updatesDoc
      .ref
      .set({
        emailVerificationRequestPending: admin.firestore.FieldValue.delete(),
        verificationRequestsCount: verificationRequestsCount + 1,
      }, {
        merge: true,
      })
  ];

  await Promise
    .all(promises);

  return conn
    .res
    .status(code.temporaryRedirect)
    .redirect('/');
};

const handleSitemap = async () => {
  const getUrlItem = (slug = '', object = {}) => {
    let str = `<url>`;
    str += '<loc>';
    str += `https://growthfile.com/${slug}`;
    str += `</loc>`;

    if (object) {
      str += `<lastmod>`;
      str += `${object.lastMod}`;
      str += `</lastmod>`;
    }

    str += `</url>`;

    return str;
  };

  const path = 'sitemap';
  const result = await admin
    .database()
    .ref(path)
    .once('value');
  const sitemapObject = result
    .val() || {};
  const allOffices = Object
    .entries(sitemapObject);
  let xmlString = '';

  allOffices.forEach((office, index) => {
    const [slug, object] = office;

    if (index === 0) {
      xmlString += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    }

    xmlString += getUrlItem(slug, object);
  });

  const lastMod = new Date().toJSON();

  [
    '', // home page
    'privacy-policy',
    'contact',
    'terms-and-conditions'
  ].forEach(slug => xmlString += getUrlItem(slug, { lastMod }));

  xmlString += `</urlset>`;

  return xmlString;
};

const getHeaders = () => ({
  /** The pre-flight headers */
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': `GET,POST,OPTIONS,HEAD`,
  'Access-Control-Allow-Headers': 'X-Requested-With, Authorization,' +
    'Content-Type, Accept',
  'Access-Control-Max-Age': 86400,
  'Content-Type': 'application/json',
  'Content-Language': 'en-US',
  'Cache-Control': 'no-cache',
});

const getAuthFromIdToken = async idToken => {
  try {
    const decodedIdToken = await auth.verifyIdToken(idToken);
    const userRecord = await auth
      .getUser(decodedIdToken.uid);

    return Object.assign({}, userRecord, {
      adminOffices: Object.keys(userRecord.customClaims || {}),
    });
  } catch (error) {
    return {
      phoneNumber: null,
      uid: null,
      customClaims: {},
    };
  }
};

module.exports = async (req, res) => {
  // https://firebase.google.com/docs/hosting/full-config#glob_pattern_matching
  const slug = getSlugFromUrl(req.url);
  const conn = {
    req,
    res,
    headers: getHeaders(),
  };
  const locals = {
    slug,
    branchObjectsArray: [],
  };

  // For CORS
  if (conn.req.method === 'OPTIONS'
    || conn.req.method === 'HEAD') {
    conn
      .res
      .status(code.ok)
      .set(conn.headers);

    return sendJSON(conn, { success: true });
  }

  // Only GET and POST are allowed
  if (!new Set(['GET', 'POST', 'HEAD', 'OPTIONS'])
    .has(req.method)) {
    return res
      .status(code.methodNotAllowed)
      .json({
        success: false,
        errors: [{
          message: `Method not allowed. Use 'GET' or 'POST'`,
        }],
      });
  }

  /**
   * Avoids duplicate content issues since there is no native way
   * currently to set up a redirect in the firebase hosting settings.
   */
  if (req.headers['x-forwarded-host']
    === env.firebaseDomain) {
    return res
      .status(code.permanentRedirect)
      .redirect(env.mainDomain);
  }

  if (slug === 'sitemap') {
    return sendXML(
      conn,
      await handleSitemap(conn)
    );
  }

  if (slug === 'config') {
    return sendJSON(conn, {
      apiBaseUrl: env.apiBaseUrl,
      getUserBaseUrl: env.getUserBaseUrl,
    });
  }

  if (slug === 'verify-email') {
    return handleEmailVerificationFlow(conn);
  }

  try {
    const idToken = parseCookies(req.headers);
    const userRecord = await getAuthFromIdToken(idToken);
    const requester = Object.assign({}, userRecord);
    // This is a read only property
    const customClaims = userRecord.customClaims || {};

    requester
      .customClaims = customClaims;
    requester
      .adminOffices = requester.customClaims.admin || [];
    requester
      .isAdmin = requester.adminOffices.length > 0;
    requester
      .isSupport = !!requester.customClaims.support;

    /** Home page */
    if (!slug) {
      return sendHTML(
        conn,
        handleHomePage(locals, requester)
      );
    }

    if (slug === 'contact') {
      return sendHTML(
        conn,
        handleContactPage(locals, requester)
      );
    }

    if (slug === 'privacy-policy') {
      return sendHTML(
        conn,
        handlePrivacyPolicyPage(locals, requester)
      );
    }

    if (slug === 'terms-and-conditions') {
      return sendHTML(
        conn,
        handleTermsAndConditionsPage(locals, requester)
      );
    }

    if (slug === 'join') {
      return sendHTML(
        conn,
        handleJoinPage(locals, requester)
      );
    }

    if (slug === 'download') {
      return sendHTML(
        conn,
        handleDownloadPage(locals, requester)
      );
    }

    if (slug === 'auth') {
      if (userRecord.uid) {
        return res
          .status(code.temporaryRedirect)
          .redirect('/');
      }

      return sendHTML(
        conn,
        handleAuthPage(locals, requester)
      );
    }

    if (slug === 'json') {
      return sendJSON(
        conn,
        await jsonApi(conn, requester)
      );
    }

    const officeDocQueryResult = await rootCollections
      .offices
      .where('slug', '==', slug)
      .limit(1)
      .get();

    if (officeDocQueryResult.empty) {
      return handle404Page(conn);
    }

    locals
      .officeDoc = officeDocQueryResult.docs[0];

    return sendHTML(conn, await fetchOfficeData(locals, requester));
  } catch (error) {
    console.error(error);

    return handleServerError(conn);
  }
};
