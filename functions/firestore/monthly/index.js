'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

module.exports = async (change, context) => {
  const {
    month,
    year,
    phoneNumber,
    statusObject,
  } = change.after.data();

  Object
    .keys(statusObject)
    .forEach(date => {
      statusObject[date].month = month;
      statusObject[date].year = year;
    });

  const profileDoc = await rootCollections.profiles.doc(phoneNumber).get();
  const employeeOf = profileDoc.get('employeeOf') || {};
  const officeIdList = Object.values(employeeOf);
  const officeIdIndex = officeIdList.indexOf(context.params.officeId);

  if (officeIdIndex === -1) {
    return Promise.resolve();
  }

  const officeName = Object.keys(employeeOf)[officeIdIndex];

  return rootCollections
    .profiles
    .doc(phoneNumber)
    .set({
      statusObject: {
        [officeName]: statusObject,
      }
    }, {
        merge: true,
      })
    .catch(console.error);
};
