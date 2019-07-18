'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

module.exports = (change, context) => {
  const {
    statusObject,
    month,
    year,
    phoneNumber,
  } = change.after.data();

  Object
    .keys(statusObject)
    .forEach(date => {
      statusObject[date].month = month;
      statusObject[date].year = year;
    });

  return rootCollections
    .profiles
    .doc(phoneNumber)
    .set({
      statusObject: {
        [context.params.officeId]: statusObject,
      }
    }, {
        merge: true,
      })
    .catch(console.error);
};
