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

const getStaticMapsUrl = (branchObjectsArray) => {
  let url = `https://maps.googleapis.com/maps/api/staticmap?center=New+Delhi&zoom=13&maptype=roadmap`;

  branchObjectsArray.forEach((branch) => {
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

const getLoggedInStatus = idToken => {
  return auth
    .verifyIdToken(idToken, true)
    .then(decodedIdToken => auth.getUser(decodedIdToken.uid))
    .then(userRecord => {
      const customClaims = userRecord.customClaims || {};
      let adminOffices;

      const isAdmin = customClaims.admin
        && customClaims.admin.length > 0;

      if (isAdmin) {
        adminOffices = customClaims.admin;
      }

      return {
        isAdmin,
        customClaims,
        adminOffices,
        uid: userRecord.uid,
        email: userRecord.email,
        photoURL: userRecord.photoURL,
        disabled: userRecord.disabled,
        isSupport: customClaims.isSupport,
        phoneNumber: userRecord.phoneNumber,
        isAnonymous: userRecord.isAnonymous,
        displayName: userRecord.displayName,
        emailVerified: userRecord.emailVerified,
        isTemplateManager: customClaims.manageTemplates,
      };
    })
    .catch(error => {
      const authError = new Set(['auth/invalid-argument'])
        .has(error.code);

      if (authError) {
        throw new Error(error);
      }

      const clearCookie = new Set([
        'auth/id-token-expired',
        'auth/id-token-revoked',
        'auth/session-cookie-expired',
        'auth/session-cookie-revoked',
        'auth/invalid-session-cookie-duration',
      ])
        .has(error.code);

      const result = {
        clearCookie,
        uid: null,
      };

      return result;
    });
};

const handleOfficePage = (locals, requester) => {
  const source = require('./views/office.hbs')();
  const template = handlebars.compile(source, { strict: true });
  const description = (() => {
    if (env.isProduction) {
      return locals.officeDoc.get('attachment.Description.value') || '';
    }

    return `Contrary to popular belief, Lorem Ipsum is not simply random text. It has roots in a piece of classical Latin literature from 45 BC, making it over 2000 years old. Richard McClintock, a Latin professor at Hampden-Sydney College in Virginia, looked up one of the more obscure Latin words, consectetur, from a Lorem Ipsum passage, and going through the cites of the word in classical literature, discovered the undoubtable source.`;
  })();

  const logoURL = (() => {
    if (locals.officeDoc.get('attachment.logoURL.value')) {
      return locals.officeDoc.get('attachment.logoURL.value');
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

    return `Lorem Ipsum is simply dummy text of the printing and typesetting industry.`;
  })();

  const html = template({
    logoURL,
    videoId,
    shortDescription,
    aboutOffice: description,
    pageDescription: shortDescription,
    userEmail: requester.email || '',
    userDisplayName: requester.displayName || '',
    userPhoneNumber: requester.phoneNumber || '',
    officeEmployeeSize: locals.officeEmployeeSize,
    officeName: locals.officeDoc.get('office'),
    pageTitle: `${locals.officeDoc.get('office')} | Growthfile`,
    mainImageUrl: '/img/logo-main.jpg',
    cannonicalUrl: `${env.mainDomain}/locals.slug`,
    mapsApiKey: env.mapsApiKey,
    branchObjectsArray: locals.branchObjectsArray,
    staticMapsUrl: getStaticMapsUrl(locals.branchObjectsArray),
    productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
    slug: locals.slug,
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
    isProduction: env.isProduction,
    officeFirstChar: locals.officeDoc.get('office').charAt(0),
  });

  return Promise.resolve(html);
};

const getBranchOpenStatus = (doc, timezone) => {
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

  const currentMoment = momentTz().tz(timezone);
  const currentTimestamp = currentMoment.valueOf();
  const todaysDay = currentMoment.format('dddd').toLowerCase();
  const MILLS_IN_1_HOUR = 3600000;
  const isSaturday = todaysDay === 'saturday';

  if (todaysDay === weeklyOff) {
    result.isClosed = true;
    const nextDayMoment = currentMoment.startOf('day').add(1, 'day');
    const isNextDaySaturday = nextDayMoment.format('dddd').toLowerCase() === 'saturday';

    if (isNextDaySaturday) {
      result.openingTime = momentTz(saturdayStartTime).tz(timezone).format(dateFormats.TIME);

      return result;
    }

    result.openingTime = momentTz(weekdayStartTime).tz(timezone).format(dateFormats.DATE);

    return result;
  }

  if (isSaturday) {
    if (currentMoment < saturdayStartTime || currentMoment > saturdayEndTime) {
      result.isClosed = true;
      result.openingTime = momentTz(saturdayStartTime)
        .tz(timezone)
        .format(dateFormats.TIME);

      return result;
    }

    if (currentMoment >= saturdayStartTime && currentMoment <= saturdayEndTime) {
      result.isOpen = true;

      return result;
    }

    result.isOpen = true;

    return result;
  }

  if (weekdayStartTime >= currentTimestamp && weekdayEndTime <= currentTimestamp) {
    const diff = weekdayEndTime - currentTimestamp;

    if (diff <= MILLS_IN_1_HOUR) {
      result.isClosingSoon = true;
      result.closingTime = momentTz(weekdayEndTime).format(dateFormats.TIME);

      return result;
    }

    result.isOpen = true;

    return result;
  }

  return result;
};

const fetchOfficeData = (locals, requester) => {
  const timezone = locals.officeDoc.get('attachment.Timezone.value');

  return Promise
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
    ])
    .then((result) => {
      const [branchQuery, productQuery] = result;

      locals.branchDocs = branchQuery.docs;
      locals.productDocs = productQuery.docs;
      locals.branchObjectsArray = [];

      locals
        .branchDocs
        .forEach(doc => {
          /** Currently branch has only 1 venue */
          const venue = doc.get('venue')[0];

          if (!venue.geopoint.latitude || !venue.geopoint._latitude) {
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
                || doc.get('attachment.Second Contact.value')
                || '';
            }

            // Some random number for the purpose of testing
            return `+911234567890`;
          })();

          /** Not sure why I'm doing this... */
          const latitude = venue.geopoint._latitude || venue.geopoint.latitude;
          const longitude = venue.geopoint._longitude || venue.geopoint.longitude;

          locals.branchObjectsArray.push({
            latitude,
            longitude,
            isOpen,
            isClosed,
            isClosingSoon,
            openingTime,
            closingTime,
            branchContact,
            gp: { latitude, longitude },
            address: venue.address,
            name: doc.get('attachment.Name.value'),
            weeklyOff: doc.get('attachment.Weekly Off.value'),
            mapsUrl: toMapsUrl({ latitude, longitude }),
          });
        });

      const office = locals.officeDoc.get('office');

      locals
        .productObjectsArray = productQuery.docs.map((doc) => {
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
    isProduction: env.isProduction,
  });

  return html;
};

const handleHomePage = (locals, requester) => {
  const source = require('./views/index.hbs')();
  const template = handlebars.compile(source, { strict: true });

  const html = template({
    user: JSON.stringify({
      isSupport: requester.isSupport,
      admin: requester.isAdmin,
      isTemplateManager: requester.isTemplateManager,
    }),
    mapsApiKey: env.mapsApiKey,
    pageTitle: 'Growthfile Home',
    pageDescription: 'One app for employees of all offices',
    isLoggedIn: locals.isLoggedIn,
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
    isTemplateManager: requester.isTemplateManager,
    initOptions: env.webappInitOptions,
    isProduction: env.isProduction,
    isAdminOrSupport: requester.isAdmin || requester.isSupport,
    showActions: requester.isAdmin
      || requester.isSupport
      || requester.isTemplateManager,
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
    isProduction: env.isProduction,
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
    isProduction: env.isProduction,
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
    showPersistentBar: false,
    phoneNumber: requester.phoneNumber,
    email: requester.email,
    emailVerified: requester.emailVerified,
    displayName: requester.displayName,
    photoURL: requester.photoURL,
    isSupport: requester.support,
    isAdmin: requester.isAdmin,
    isTemplateManager: requester.isTemplateManager,
    isProduction: env.isProduction,
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
    isProduction: env.isProduction,
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
    isProduction: env.isProduction,
  });

  return html;
};

const createJsonRecord = (doc) => {
  return {
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
  const allowedTemplates = new Set(['enquiry']);

  if (!requester.uid) {
    return Promise.resolve({});
  }

  if ((requester.isAdmin || requester.isSupport)
    && conn.req.query.action === 'get-template-xlsx') {
    return require('./excel-handler')(conn);
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

  if (conn.req.query.action === 'view-templates') {
    return getTemplatesListJSON(conn.req.query.name);
  }

  if (conn.req.query.action === 'get-template-names') {
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

  if (conn.req.query.template
    && !conn.req.query.office
    && !conn.req.query.query) {
    if (!allowedTemplates.has(conn.req.query.template)) {
      return Promise.resolve(json);
    }

    return rootCollections
      .profiles
      .doc(requester.phoneNumber)
      .collection('Activities')
      .where('template', '==', conn.req.query.template)
      .get()
      .then((docs) => {
        docs.forEach((doc) => {
          if (!json[doc.get('template')]) {
            json[doc.get('template')] = [createJsonRecord(doc)];
          }
          else {
            json[doc.get('template')].push(createJsonRecord(doc));
          }
        });

        return Promise.resolve(json);
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

  const webappSearch = require('./search');

  return webappSearch(conn.req, requester);
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

const handleAnonymousView = conn => {
  // put stuff in /Anonymous
  // if pageview is for an office page --> create an addendum
  return rootCollections
    .anonymous
    .doc()
    .set({
      uid: conn.requester.uid,
      timestamp: Date.now(),
      context: conn.req.body,
      action: httpsActions.webapp,
    })
    .then(() => ({ success: true, }));
};

const handleKnownUserView = (conn, requester) => {
  // Put stuff in /Profiles/<phoneNumber>/Webapp/<autoid>
  // if pageview is for an office page -> create an addendum
  const batch = db.batch();
  // const phoneNumber = conn.req.body.phoneNumber;
  const ref = rootCollections.profiles.doc(requester.phoneNumber).collection('Webapp').doc();

  batch
    .set(ref, {
      uid: requester.uid,
      phoneNumber: requester.phoneNumber,
      context: conn.req.body,
      action: httpsActions.webapp,
    });

  if (!conn.req.body.office) {
    return batch
      .commit()
      .then(() => ({ success: true }));
  }

  return rootCollections
    .offices
    .where('office', '==', conn.req.body.office)
    .limit(1)
    .get()
    .then(docs => {
      if (docs.empty) {
        return Promise.resolve();
      }

      const doc = docs.docs[0].ref.collection('Webapp').doc();

      batch.set(doc, {
        timestamp: Date.now(),
        user: requester.phoneNumber,
        uid: requester.uid,
        context: conn.req.body,
        action: httpsActions.webapp,
      });

      return batch
        .commit()
        .then(() => ({ success: true }));
    });
};

const handleTrackViews = conn => {
  if (conn.requester.isAnonymous) {
    return handleAnonymousView();
  }

  return handleKnownUserView();
};

const handleJsonPostRequest = (conn, requester) => {
  const json = {};

  if (!conn.req.query.action) {
    return Promise.resolve({});
  }

  if (conn.req.query.action === 'update-auth') {
    return require('./update-auth')(conn, requester);
  }

  if (conn.req.query.action === 'track-view') {
    return handleTrackViews(conn);
  }

  if (conn.req.query.action === 'create-template'
    && requester.isTemplateManager) {
    conn.requester = {
      phoneNumber: requester.phoneNumber,
      uid: requester.uid,
      customClaims: requester.customClaims,
      displayName: requester.displayName,
    };

    return require('../firestore/activity-templates/on-create')(conn);
  }

  if (conn.req.query.action === 'update-template'
    && requester.isTemplateManager) {
    conn.requester = {
      phoneNumber: requester.phoneNumber,
      uid: requester.uid,
      customClaims: requester.customClaims,
      displayName: requester.displayName,
    };

    return require('../firestore/activity-templates/on-update')(conn);
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

  return Promise.resolve(json);
};

const jsonApi = (conn, requester) => {
  if (conn.req.method === 'POST') {
    return handleJsonPostRequest(conn, requester);
  }

  return handleJsonGetRequest(conn, requester);
};


const handleEmailVerificationFlow = conn => {
  if (!isNonEmptyString(conn.req.query.uid)) {
    return conn
      .res
      .status(code.temporaryRedirect)
      .redirect('/');
  }

  return rootCollections
    .updates
    .doc(conn.req.query.uid)
    .get()
    .then(updatesDoc => {
      if (!updatesDoc.exists
        || !updatesDoc.get('emailVerificationRequestPending')) {
        return conn.res.status(code.temporaryRedirect).redirect('/');
      }

      return Promise
        .all([
          auth
            .updateUser(conn.req.query.uid, {
              emailVerified: true,
            }),
          updatesDoc
            .ref
            .set({
              emailVerificationRequestPending: admin.firestore.FieldValue.delete(),
              verificationRequestsCount: (updatesDoc.get('verificationRequestsCount') || 0) + 1,
            }, {
                merge: true,
              })
        ]);
    })
    .then(() => {
      // TODO: Also set __session cookie in order to login the user.
      return conn.res.status(code.temporaryRedirect).redirect('/');
    })
    .catch(error => {
      console.error(error);

      const html = handleServerError();

      return conn.res.status(code.internalServerError).send(html);
    });
};

module.exports = (req, res) => {
  // https://firebase.google.com/docs/hosting/full-config#glob_pattern_matching
  const slug = getSlugFromUrl(req.url);
  const conn = {
    req,
    res,
    headers: {
      /** The pre-flight headers */
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': `GET,POST,OPTIONS,HEAD`,
      'Access-Control-Allow-Headers': 'X-Requested-With, Authorization,' +
        'Content-Type, Accept',
      'Access-Control-Max-Age': 86400,
      'Content-Type': 'application/json',
      'Content-Language': 'en-US',
      'Cache-Control': 'no-cache',
    },
  };
  const locals = {
    slug,
    isLoggedIn: false,
  };

  // For CORS
  if (conn.req.method === 'OPTIONS'
    || conn.req.method === 'HEAD') {
    conn.res.status(code.ok).set(conn.headers);

    return conn.res.send({ success: true });
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

  let requester = {};
  const idToken = parseCookies(req.headers);
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

  if (slug === 'sitemap') {
    return rootCollections
      .sitemaps
      .doc('growthfile.com')
      .get()
      .then((doc) => {
        conn.res.set('Content-Type', 'text/xml');

        return conn.res.send(doc.get('sitemap'));
      })
      .catch(error => {
        console.error(error);
        const html = handleServerError();

        return conn.res.status(code.internalServerError).send(html);
      });
  }

  if (slug === 'config') {
    return conn
      .res
      .json({
        apiBaseUrl: env.apiBaseUrl,
        getUserBaseUrl: env.getUserBaseUrl,
      });
  }

  if (slug === 'verify-email') {
    return handleEmailVerificationFlow(conn);
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
        phoneNumber,
        displayName,
        customClaims,
        emailVerified,
        isTemplateManager,
      } = result;

      locals.isLoggedIn = uid !== null;

      if (locals.isLoggedIn) {
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
          customClaims,
        };
      }

      /** Home page */
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
        res.status(code.temporaryRedirect).redirect('/');

        return;
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
    .then(result => {
      if (!result || html) {
        return Promise.resolve();
      }

      if (slug === 'json') {
        if (conn.req.query.action === 'get-template-xlsx') {
          const xlsxPopulate = require('xlsx-populate');
          conn.res.type(xlsxPopulate.MIME_TYPE);

          return conn
            .res
            .download(`/tmp/sample.xlsx`);
        }

        html = result;

        conn
          .res
          .status(result.status || code.ok)
          .set(conn.headers);

        return conn.res.json(html);
      }

      if (result.empty) {
        html = handle404Page();

        return conn
          .res
          .status(code.notFound)
          .send(html);
      }

      locals
        .officeDoc = result.docs[0];

      return fetchOfficeData(locals, requester);
    })
    .then(officeHtml => {
      if (html) {
        return Promise.resolve();
      }

      html = officeHtml;

      conn.res.send(html);

      return;
    })
    .catch(error => {
      console.error('Error', error, conn.req.body);
      const html = handleServerError();

      return conn
        .res
        .status(code.internalServerError)
        .send(html);
    });
};
