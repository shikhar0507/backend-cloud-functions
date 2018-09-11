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

const BATCH_LIMIT = 500;


const updateSubscriptions = (query, templateName, resolve, reject) =>
  query
    .get()
    .then((activities) => {
      if (activities.empty) return Promise.resolve();

      const batch = db.batch();

      activities.forEach((activityDoc) => {
        batch.set(activityDoc.ref, {
          timestamp: serverTimestamp,
        }, {
            merge: true,
          });
      });

      return activities.docs[activities.size - 1];
    })
    .then((lastDocFromLastQuery) => {
      /** All docs are updated */
      if (!lastDocFromLastQuery.id) return Promise.resolve();

      const startAt = lastDocFromLastQuery.get('timestamp');

      return process
        .nextTick(() => {
          console.log('next tick');

          const query = rootCollections
            .activities
            .where('template', '==', 'subscription')
            .where('attachment.Template.value', '==', templateName)
            .orderBy('timestamp', 'desc')
            .startAt(startAt)
            .limit(BATCH_LIMIT);

          updateSubscriptions(query, templateName, resolve, reject);
        });
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

  const query = rootCollections
    .activities
    .where('template', '==', 'subscription')
    .where('attachment.Template.value', '==', templateName)
    .orderBy('timestamp', 'desc')
    .limit(BATCH_LIMIT);

  return new
    Promise(
      (resolve, reject) =>
        updateSubscriptions(query, resolve, reject)
    )
    .catch(console.error);
};
