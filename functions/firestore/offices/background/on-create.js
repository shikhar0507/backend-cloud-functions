/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */


'use strict';

const { db } = require('../../../admin/admin');
const { slugify } = require('../../../admin/utils');


const getPermutations = (officeName) => {
  const nameCombinations = new Set();

  [' ', '.', ',', '-', '&', '(', ')']
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

  return [...nameCombinations];
};


module.exports = (officeDoc) => {
  const batch = db.batch();
  const officeName = officeDoc.get('attachment.Name.value');
  const namePermutations = getPermutations(officeName);
  const slug = slugify(officeName);

  batch.set(officeDoc.ref, {
    namePermutations,
    slug,
  }, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};
