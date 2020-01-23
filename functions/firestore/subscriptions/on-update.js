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
const { subcollectionNames, addendumTypes } = require('../../admin/constants');

const pushUpdatedTemplates = async (query, templateDoc) => {
  const { name: template } = templateDoc.data();
  const authPromises = [];
  const uidMap = new Map();
  const templateUpdate = {
    template,
    _type: addendumTypes.SUBSCRIPTION,
    schedule: templateDoc.get('schedule'),
    venue: templateDoc.get('venue'),
    attachment: templateDoc.get('attachment'),
    report: templateDoc.get('report') || null,
    /**
     * Field timestamp is required in order for this
     * doc to show up in the /read api query.
     */
    timestamp: Date.now(),
  };

  const MAX_DOCS_TO_FETCH = 500;

  const subscriptionActivitiesQuery =
    query ||
    rootCollections.activities
      .where('template', '==', 'subscription')
      .where('attachment.Template.value', '==', template)
      .orderBy('__name__')
      .limit(MAX_DOCS_TO_FETCH);

  const docs = await subscriptionActivitiesQuery.get();

  docs.forEach(subscription => {
    authPromises.push(
      rootCollections.updates
        .where(
          'phoneNumber',
          '==',
          subscription.get('attachment.Phone Number.value'),
        )
        .limit(1)
        .get(),
    );
  });

  const snapsFromUpdates = await Promise.all(authPromises);
  snapsFromUpdates.forEach(snap => {
    const [doc] = snap.docs;

    if (!doc) {
      return;
    }

    const { id: uid } = doc;
    const { phoneNumber } = doc.data();

    uidMap.set(phoneNumber, uid);
  });

  const batch = db.batch();

  docs.forEach(subscription => {
    const { office, status } = subscription.data();

    const data = Object.assign({}, templateUpdate, {
      office,
      status,
    });

    const uid = uidMap.get(subscription.get('attachment.Phone Number.value'));

    if (!uid) {
      return;
    }

    const ref = rootCollections.updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc();

    console.log(ref.path);

    batch.set(ref, data);
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

  return pushUpdatedTemplates(newQuery, templateDoc);
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
    return pushUpdatedTemplates(null, templateDoc);
  } catch (error) {
    console.error(error);
  }
};
