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


const { rootCollections, db, } = require('../../admin/admin');

/**
 * Copies the addendum doc to the path Updates/(uid)/Addendum(auto-id)
 * for the activity assignees who have auth.
 *
 * @param {Object} addendumDocRef Firebase doc Object.
 * @returns {Promise <Object>} A `batch` object.
 */
module.exports = (addendumDocRef) =>
  rootCollections
    .activities
    .doc(addendumDocRef.get('activityId'))
    .collection('Assignees')
    .get()
    .then((snapShot) => {
      const promises = [];

      snapShot.forEach((doc) => {
        const phoneNumber = doc.id;

        promises.push(rootCollections
          .profiles
          .doc(phoneNumber)
          .get()
        );
      });

      return promises;
    })
    .then((promises) => Promise.all(promises))
    .then((snapShots) => {
      const batch = db.batch();

      snapShots.forEach((doc) => {
        /** An assignee (phone number) who's doc is added
         * to the promises array above, may not have auth.
         */
        if (!doc.exists) return;
        /** No `uid` means that the user has not signed up
         * for the app. Not writing addendum for those users.
         */
        if (!doc.get('uid')) return;

        const uid = doc.get('uid');

        batch.set(rootCollections
          .updates
          .doc(uid)
          .collection('Addendum')
          .doc(),
          addendumDocRef.data()
        );
      });

      return batch;
    })
    .then((batch) => batch.commit())
    .catch(console.error);
