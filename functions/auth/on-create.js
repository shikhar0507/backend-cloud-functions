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
  db,
  rootCollections,
} = require('../admin/admin');


/**
 * Creates new docs inside `Profile` and `Updates` collection in Firestore for
 * a newly signed up user.
 *
 * @param {Object} userRecord Object with user info.
 * @returns {Promise <Object>} Batch object.
 */
module.exports = (userRecord) => {
  const batch = db.batch();
  const { uid, phoneNumber } = userRecord;

  batch.set(rootCollections
    .updates
    .doc(uid), {
      phoneNumber,
    }, {
      merge: true,
    });

  /**
   * Profile *may* exist already, if the user signed
   * up to the platform sometime in the past.
   */
  batch.set(rootCollections
    .profiles
    .doc(phoneNumber), {
      uid,
    }, {
      merge: true,
    });

  return batch
    .commit()
    .catch(console.error);
};
