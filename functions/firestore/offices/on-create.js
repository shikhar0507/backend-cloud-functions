'use strict';

const { db, } = require('../../admin/admin');


const getPermutations = (officeName) => {
  const nameCombinations = new Set();

  [' ', '.', ',', '-', '&', '(', ')',]
    .forEach((character) => {
      const parts = officeName.split(character);

      parts.forEach((part) => {
        nameCombinations.add(part);
        nameCombinations.add(part.toLowerCase());
        nameCombinations.add(part.toUpperCase());
      });
    });

  officeName
    .split(' ')
    .forEach((part) => {
      const withFirstLetterCaps =
        part
          .charAt(0)
          .toUpperCase()
        + part.substr(1);

      nameCombinations.add(withFirstLetterCaps);
    });

  return [...nameCombinations,];
};


module.exports = (officeDoc) => {
  const batch = db.batch();
  const officeName = officeDoc.get('attachment.Name.value');
  const namePermutations = getPermutations(officeName);

  batch.set(officeDoc.ref, { namePermutations, }, { merge: true, });

  return batch
    .commit()
    .catch(console.error);
};
