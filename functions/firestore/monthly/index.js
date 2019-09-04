'use strict';

const {
  rootCollections,
} = require('../../admin/admin');

const findKeyByValue = (obj, value) =>
  Object.keys(obj).find(key => obj[key] === value);


module.exports = async (change, context) => {
  const statusObject = change.after.get('statusObject') || {};
  const { phoneNumber, officeId } = context.params;

  try {
    const profileDoc = await rootCollections.profiles.doc(phoneNumber).get();
    const employeeOf = profileDoc.get('employeeOf') || {};
    const office = findKeyByValue(employeeOf, officeId);

    if (!office) {
      return Promise.resolve();
    }

    const { path } = change.after.ref;
    const parts = path.split('/');
    const monthYearString = parts[3];
    const [month, year] = monthYearString.split(' ');

    const allMonths = {
      'January': 0,
      'February': 1,
      'March': 2,
      'April': 3,
      'May': 4,
      'June': 5,
      'July': 6,
      'August': 7,
      'September': 8,
      'October': 9,
      'November': 10,
      'December': 11,
    };

    const result = [];

    Object.keys(statusObject).forEach(date => {
      const o = Object.assign({}, {
        office,
        date: Number(date),
        year: Number(year),
        month: allMonths[month],
      }, statusObject[date]);

      result.push(o);
    });

    return rootCollections
      .profiles
      .doc(phoneNumber)
      .set({
        statusObject: result,
      }, {
        merge: true,
      });
  } catch (error) {
    console.error(error);
  }
};
