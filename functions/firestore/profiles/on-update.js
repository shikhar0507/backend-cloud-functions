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


const {
  rootCollections,
  db,
} = require('../../admin/admin');


const purgeAddendum = (uid, queryArg, resolve, reject) =>
  rootCollections
    .updates
    .doc(uid)
    .collection('Addendum')
    .where('timestamp', '<', queryArg)
    .limit(500)
    .get()
    .then((docs) => {
      // When there are no documents left, we are done
      if (docs.size === 0) return 0;

      // Delete documents in a batch
      const batch = db.batch();

      docs.forEach((doc) => batch.delete(doc.ref));

      /* eslint-disable */
      return batch
        .commit()
        .then(() => docs.size);
      /* eslint-enable */
    })
    .then((numberOfDocsDeleted) => {
      if (numberOfDocsDeleted === 0) return resolve();

      // Recurse on the next process tick, to avoid exploding the stack.
      return process
        .nextTick(() => purgeAddendum(uid, queryArg, resolve, reject));
    })
    .catch(reject);


/**
 * Deletes the addendum docs from the `Updates/(uid)/Addendum` when the
 * `lastFromQuery` changes in the `Profiles` doc of the user.
 *
 * @Path: `Profiles/(phoneNumber)`
 * @Trigger: `onUpdate`
 *
 * @param {Object} change Contains snapshot of `old` and `new` doc in `context`.
 * @returns {Promise<Batch>} Firestore `Batch` object.
 */
module.exports = (change) => {
  const oldProfile = change.before;
  const newProfile = change.after;

  const oldQuery = oldProfile.get('lastFromQuery');
  const newQuery = newProfile.get('lastFromQuery');

  if (oldQuery === newQuery) return Promise.resolve();

  const uid = newProfile.get('uid');

  const queryArg = new Date(parseInt(oldQuery));

  return new
    Promise(
      (resolve, reject) => purgeAddendum(uid, queryArg, resolve, reject)
    )
    .catch(console.error);
};
