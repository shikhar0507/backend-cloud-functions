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

const { rootCollections, db } = require('../../admin/admin');

const updateTimestampActivities = async (queryActivities, templateDoc) => {
  const { name: template } = templateDoc.data();

  const MAX_DOCS_TO_FETCH = 500;

  const activitiesQuery =
    queryActivities ||
    rootCollections.activities
      .where('template', '==', template)
      .orderBy('__name__')
      .limit(MAX_DOCS_TO_FETCH);

  const { docs } = await activitiesQuery.get();

  const batch = db.batch();

  docs.forEach(activity => {
    batch.set(activity.ref, { timestamp: Date.now() }, { merge: true });
  });

  await batch.commit();

  const lastDoc = docs.docs[docs.size - 1];

  console.log('Docs found', docs.size);

  if (!lastDoc) {
    console.log('no last doc');

    return;
  }

  console.log('Called again last', lastDoc.id);

  const newQuery = activitiesQuery.startAfter(lastDoc);

  return updateTimestampActivities(newQuery, templateDoc);
};

const updateTimestampSubscriptions = async (
  querySubscriptions,
  templateDoc,
) => {
  const { name: template } = templateDoc.data();

  const MAX_DOCS_TO_FETCH = 500;

  const subscriptionActivitiesQuery =
    querySubscriptions ||
    rootCollections.activities
      .where('template', '==', 'subscription')
      .where('attachment.Template.value', '==', template)
      .orderBy('__name__')
      .limit(MAX_DOCS_TO_FETCH);

  const { docs } = await subscriptionActivitiesQuery.get();

  const batch = db.batch();

  docs.forEach(subscription => {
    batch.set(subscription.ref, { timestamp: Date.now() }, { merge: true });
  });

  await batch.commit();

  const lastDoc = docs.docs[docs.size - 1];

  console.log('Docs found', docs.size);

  if (!lastDoc) {
    console.log('no last doc');

    return;
  }

  console.log('Called again last', lastDoc.id);

  const newQuery = subscriptionActivitiesQuery.startAfter(lastDoc);

  return updateTimestampSubscriptions(newQuery, templateDoc);
};

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
module.exports = change => {
  /** The template name never changes. */
  const templateName = change.after.get('name');

  console.log({
    templateName,
  });

  const { after: templateDoc } = change;

  try {
    return Promise.all([
      updateTimestampSubscriptions(null, templateDoc),
      updateTimestampActivities(null, templateDoc),
    ]);
  } catch (error) {
    console.error(error);
  }
};
