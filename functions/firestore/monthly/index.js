'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

const findKeyByValue = (obj, value) =>
  Object.keys(obj).find(key => obj[key] === value);


module.exports = async (change, context) => {
  const { statusObject } = change.after.data();
  const { phoneNumber, officeId } = context.params;

  try {
    const profileDoc = await rootCollections.profiles.doc(phoneNumber).get();
    const employeeOf = profileDoc.get('employeeOf') || {};
    const office = findKeyByValue(employeeOf, officeId);

    if (!office) {
      return Promise.resolve();
    }

    return rootCollections
      .profiles
      .doc(phoneNumber)
      .set({
        statusObject: {
          [office]: statusObject,
        }
      }, {
          merge: true,
        });
  } catch (error) {
    console.error(error);
  }
};
