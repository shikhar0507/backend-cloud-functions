'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

module.exports = (change, context) =>
  rootCollections
    .profiles
    .doc(change.after.get('phoneNumber'))
    .set({
      statusObject: {
        [context.params.officeId]: change.after.get('statusObject'),
      }
    }, {
        merge: true,
      })
    .catch(console.error);
