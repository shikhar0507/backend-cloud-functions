'use strict';

// TODO: Check this out: https://oembed.com/

const {
  rootCollections,
} = require('../admin/admin');
const {
  code,
} = require('../admin/responses');
const helpers = require('./helpers');
const url = require('url');

const getSlugFromUrl = (requestUrl) => {
  const parsed = url.parse(requestUrl);
  const officeName = parsed.pathname;

  return officeName.split('/')[1];
};

const handleHomePage = (conn) => {
  const locals = {};

  return helpers.homePage(conn, locals);
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

  if (slug === '/' || slug === '') {
    return handleHomePage(conn);
  }

  if (slug === 'download') {
    return helpers.downloadAppPage(conn, {});
  }

  if (slug === 'join') {
    return helpers.joinPage(conn, {});
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
        return helpers.pageNotFound(conn, {});
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
      if (!result) return Promise.resolve();

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
          };
        });

      // const getName = (name) => {

      //   return name.slice(0, 8);
      // };

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

      return helpers.officePage(conn, locals);
    })
    .catch((error) => helpers.errorPage(conn, error));
};



module.exports = app;
