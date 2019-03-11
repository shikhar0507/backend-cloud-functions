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
const helpers = require('./helpers');
const url = require('url');

const getSlug = (requestUrl) => {
  const parsed = url.parse(requestUrl);
  const officeName = parsed.pathname;

  return officeName.split('/')[1];
};

const handleHomePage = (conn) => {
  rootCollections
    .offices
    .where('office', '==', conn.req.query.office)
    .limit(1)
    .get()
    .then((docs) => {
      const officeDoc = docs.docs[0];

      const locals = {
        officesArray: [officeDoc, officeDoc, officeDoc, officeDoc],
      };

      return helpers.homePage(conn, locals);
    })
    .catch((error) => helpers.errorPage(conn, error));
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
  const slug = getSlug(req.url);
  const conn = { req, res };
  const locals = { slug };

  console.log('slug:', slug);

  if (slug === '/' || slug === '') {
    return handleHomePage(conn);
  }

  if (slug === 'download') {
    return helpers.downloadAppPage(conn, {});
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
        return helpers.homePage(conn, {});
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

      const getName = (name) => {

        return name.slice(0, 8);
      };

      locals
        .productObjectsArray = productQuery.docs.map((doc) => {
          return {
            name: getName(doc.get('attachment.Name.value')),
            productDetails: JSON.stringify({
              imageUrl: doc.get('attachment.Image Url.value'),
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
