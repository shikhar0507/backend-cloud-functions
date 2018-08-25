'use strict';

const { db, } = require('../../admin/admin');

const getNameCombinations = (officeName) => {
  const nameCombinations = [];

  return nameCombinations;
};


module.exports = (officeDoc, context) => {
  const batch = db.batch();
  const officeRef = officeDoc.ref;

  batch.set(officeRef, {
    nameCombinations: getNameCombinations(officeDoc.get('attachment.Name.value')),
  }, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};
