'use strict';

const {
  rootCollections,
} = require('../admin/admin');

module.exports = (office, query) => {
  // Query param 'query', 'office'
  const result = {};
  const assigneeFetchPromises = [];

  return rootCollections
    .offices
    .where('office', '==', office)
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
        .where('searchables', 'array-contains', query)
        .get();
    })
    .then(docs => {
      if (!docs) return [];

      docs.forEach(doc => {
        const data = doc.data();
        // This field might contain sensitive server keys
        delete data.addendumDocRef;

        const promise = rootCollections
          .activities
          .doc(doc.id)
          .collection('Assignees')
          .get();

        assigneeFetchPromises.push(promise);

        data.activityId = doc.id;

        result[doc.id] = Object.assign({}, data);
      });

      return Promise.all(assigneeFetchPromises);
    })
    .then(snapShots => {
      snapShots.forEach(snapShot => {
        if (snapShot.empty) return;

        const firstDoc = snapShot.docs[0];
        const activityId = firstDoc.ref.path.split('/')[1];

        result[activityId].assignees = snapShot.docs.map(doc => doc.id);
      });

      return result;
    });
};
