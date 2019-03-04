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
// const templates = require('./templates');
// const handlebars = require('handlebars');
const url = require('url');

const officePage = require('../webapp/office-page');
const errorPage = require('../webapp/error-page');

const getSlug = (requestUrl) => {
  const parsed = url.parse(requestUrl);
  const officeName = parsed.pathname;

  return officeName.split('/')[1];
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

  if (slug === '/' || slug === '') {
    return officePage(conn);
  }

  console.log('slug', slug);

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

      return officePage(conn, locals);
    })
    .catch((error) => errorPage(conn, error));
};



module.exports = app;
