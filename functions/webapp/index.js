'use strict';

// TODO: Check this out: https://oembed.com/

const {
  rootCollections,
} = require('../admin/admin');

const {
  // TODO: Try this one: https://gist.github.com/sgmurphy/3095196
  slugify,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');
const templates = require('./templates');
const handlebars = require('handlebars');
const url = require('url');

const handlebarsOptions = { strict: true };

const getSlug = (requestUrl) => {
  const parsed = url.parse(requestUrl);
  const officeName = parsed.pathname;

  return officeName.split('/')[1];
};


const send500Page = (conn, error) => {
  console.error(error);
  const html = `<h1>Something went wrong :(</h1>`;

  return conn.res.status(500).send(html);
};

const handleOfficePage = (conn, locals) => {
  const context = {
    officeName: locals.officeDoc.get('office'),
    videoId: locals.officeDoc.get('attachment.Video Id.value'),
    officeDescription: locals.officeDoc.get('attachment.Description.value'),
    currentYear: new Date().getFullYear(),
    branchObjectsArray: locals.branchObjectsArray,
    productObjectsArray: locals.productObjectsArray,
    displayBranch: locals.branchObjectsArray.length > 0,
    displayProducts: locals.productObjectsArray.length > 0,
    mapsApiKey: 'AIzaSyCadBqkHUJwdcgKT11rp_XWkbQLFAy80JQ',
    slug: locals.slug,
  };

  const source = templates.officeSource();
  const template = handlebars.compile(source, handlebarsOptions);
  const result = template(context);

  return conn.res.status(code.ok).send(result);
};

const handleHomePage = (conn) => {
  const context = {};
  const source = templates.homeSource();
  const template = handlebars.compile(source, handlebarsOptions);
  const result = template(context);

  return conn.res.status(code.ok).send(result);
};

const handleJoinPage = (conn) => {
  const context = {};
  const source = templates.joinPageSource();
  const template = handlebars.compile(source, handlebarsOptions);
  const result = template(context);

  return conn.res.status(code.ok).send(result);
};


const app = (req, res) => {
  if (req.method !== 'GET') {
    return res.status(code.methodNotAllowed).json({
      success: false,
      errors: [{
        message: `Method not allowed. Use 'GET'`,
      }],
    });
  }

  // https://firebase.google.com/docs/hosting/full-config#glob_pattern_matching
  const slug = getSlug(req.url);
  const conn = { req, res };
  const locals = { slug };

  if (slug === '/' || slug === '') {
    return handleHomePage(conn);
  }

  if (slug === 'join') {
    return handleJoinPage(conn);
  }

  return rootCollections
    .offices
    .where('slug', '==', slug)
    .limit(1)
    .get()
    .then((docs) => {
      if (docs.empty) {
        const html = `<h1>NOT FOUND<h1>`;

        return res.status(code.notFound).send(html);
      }

      locals.officeDoc = docs.docs[0];

      return Promise
        .all([
          docs
            .docs[0]
            .ref
            .collection('Activities')
            .where('template', '==', 'branch')
            .limit(10)
            .get(),
          docs
            .docs[0]
            .ref
            .collection('Activities')
            .where('template', '==', 'product')
            .limit(10)
            .get(),
        ]);
    })
    .then((result) => {
      const [
        branchQuery,
        productQuery,
      ] = result;

      locals.branchDocs = branchQuery.docs;
      locals.productDocs = productQuery.docs;

      locals
        .branchObjectsArray = branchQuery.docs.map((doc) => {
          return {
            name: doc.get('attachment.Name.value'),
            address: doc.get('venue')[0].address,
            latitude: doc.get('venue')[0].geopoint._latitude,
            longitude: doc.get('venue')[0].geopoint._longitude,
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

      return handleOfficePage(conn, locals);
    })
    .catch((error) => send500Page(conn, error));
};



module.exports = app;
