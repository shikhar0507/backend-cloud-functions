'use strict';

const {
  rootCollections,
} = require('../admin/admin');

module.exports = (conn) => {
  // Query param 'query', 'office'
  const result = {};

  return rootCollections
    .offices
    .where('office', '==', conn.req.query.office)
    .limit(1)
    .get()
    .then(docs => {
      if (docs.empty) {
        return null;
      }

      return docs
        .docs[0]
        .ref
        .collection('Activities')
        .where('searchables', 'array-contains', conn.req.query.query)
        .get();
    })
    .then(docs => {
      if (!docs) return [];

      docs.forEach(doc => {
        const data = doc.data();
        // This field might contain sensitive server keys
        delete data.addendumDocRef;

        data.activityId = doc.id;

        result.push(data);
      });

      return result;
    });
};
