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
  serverTimestamp,
} = require('../../admin/admin');

let count = 0;

const updateSubscriptions = (query, resolve, reject) =>
  query
    .get()
    .then((docs) => {
      if (docs.size === 0) return 0;

      const batch = db.batch();

      docs.forEach((doc) => {
        batch.set(doc.ref, {
          timestamp: serverTimestamp,
        }, {
            merge: true,
          });
      });

      /* eslint-disable */
      return batch
        .commit()
        .then(() => docs.docs[docs.size - 1]);
      /* eslint-enable */
    })
    .then((lastDoc) => {
      if (!lastDoc) return resolve();

      count++;

      const startAfter = lastDoc.get('attachment.Subscriber.value');
      const newQuery = query.startAfter(startAfter);

      return process
        .nextTick(() => updateSubscriptions(newQuery, resolve, reject));
    })
    .catch(reject);

/**
 * Whenever a `Template Manager` updates a document in ActivityTemplates
 * collection, this function queries the `Activities` collection, gets
 * all the activities have subscribers of this activity and updates the
 * timestamp of the document's timestamp present in
 * `Profiles/(subscriberPhoneNumber)/Subscriptions/(activityId)`.
 *
 * @Path: `ActivityTemplates/{docId}`
 * @Trigger: `onUpdate`
 * @WritePath: `Profiles/(subscriberPhoneNumber)/Subscriptions/(activityId)`
 *
 * @param {Object} change Object containing doc snapShots (old and new).
 * @returns {Object<Batch>} Firebase Batch object.
 */
module.exports = (change) => {
  /** The template name never changes. */
  const templateName = change.after.get('name');
  const query =
    rootCollections
      .activities
      .where('template', '==', 'subscription')
      .where('attachment.Template.value', '==', templateName)
      .orderBy('attachment.Subscriber.value')
      .limit(500);

  return new
    Promise((resolve, reject) => updateSubscriptions(query, resolve, reject))
    .then(() => console.log(`Iterations: ${count}`))
    .catch(console.error);
};
