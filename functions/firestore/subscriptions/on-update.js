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
const admin = require('firebase-admin');

const getActivityNew = (activityOld, templateDoc) => {
  activityOld.addendumDocRef = null;
  activityOld.hidden = templateDoc.hidden;
  activityOld.statusOnCreate = templateDoc.statusOnCreate;
  activityOld.canEditRule = templateDoc.canEditRule;

  activityOld.venue.forEach((venueObject, index) => {
    if (templateDoc.venue[index] === venueObject.venueDescriptor) {
      return;
    }

    // Venue has been removed from the template
    activityOld.venue.splice(index, 1);
  });

  templateDoc.venue.forEach((venueDescriptor, index) => {
    const activityOldVenueDescriptors = activityOld
      .venue
      .map(venue => venue.venueDescriptor);

    if (activityOldVenueDescriptors[index] === venueDescriptor) {
      return;
    }

    activityOld.venue[index] = {
      venueDescriptor,
      placeId: '',
      geopoint: {
        latitude: '',
        longitude: '',
      },
      address: '',
      location: '',
    };
  });

  activityOld.schedule.forEach((scheduleObject, index) => {
    if (templateDoc.schedule[index] === scheduleObject.name) {
      return;
    }

    // Schedule has been removed from the template
    activityOld.schedule.splice(index, 1);
  });

  templateDoc.schedule.forEach((scheduleName, index) => {
    const activityOldScheduleNames = activityOld
      .schedule
      .map(schedule => schedule.name);

    if (activityOldScheduleNames[index] === scheduleName) {
      return;
    }

    activityOld.schedule[index] = {
      name: scheduleName,
      startTime: '',
      endTime: '',
    };
  });

  Object
    .keys(activityOld.attachment)
    .forEach(field => {
      // Field also exists in attachment.
      // allow it
      if (templateDoc.attachment[field]) {
        return;
      }

      activityOld.attachment[field] = admin.firestore.FieldValue.delete();
    });

  Object
    .keys(templateDoc.attachment)
    .forEach(field => {
      // Field doesn't even exist
      if (!activityOld.attachment[field]) {
        activityOld.attachment[field] = templateDoc.attachment[field];
      }

      // Type changed
      if (activityOld.attachment[field]
        && !activityOld.attachment[field].type
        !== templateDoc.attachment[field].type) {
        activityOld
          .attachment[field]
          .type = templateDoc.attachment[field].type;
      }
    });

  return activityOld;
};


const updateActivities = change => {
  const templateName = change.after.get('name');

  /** Updating subscriptions for check-in, but not the activities */
  if (templateName === 'check-in') {
    return Promise.resolve();
  }

  const updateActivities = (query, resolve, reject, change) => {
    return query
      .get()
      .then(snapShot => {

        console.log('size', snapShot.size);

        if (snapShot.size === 0) return 0;

        const batch = db.batch();

        snapShot.forEach(doc => {
          const data = Object.assign({}, getActivityNew(
            doc.data(),
            change.after.data()
          ));

          batch.set(doc.ref, data, { merge: true });
        });

        /* eslint-disable */
        return batch
          .commit()
          .then(() => snapShot.docs[snapShot.size - 1]);
        /* eslint-enable */
      })
      .then(lastDoc => {
        if (!lastDoc) return resolve();

        const newQuery = query.startAfter(lastDoc);

        return process
          .nextTick(() => {
            return updateActivities(newQuery, resolve, reject, change);
          });
      })
      .catch(reject);
  };

  const query = rootCollections
    .activities
    .where('template', '==', change.after.get('name'))
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(500);

  return new Promise((resolve, reject) => {
    return updateActivities(
      query,
      resolve,
      reject,
      change
    );
  });
};

const updateSubscriptions = (query, resolve, reject) => {
  return query
    .get()
    .then(snapshot => {
      if (snapshot.size === 0) return 0;

      const batch = db.batch();

      snapshot.forEach(doc => {
        batch.set(doc.ref, {
          timestamp: Date.now(),
          addendumDocRef: null,
        }, {
            merge: true,
          });
      });

      /* eslint-disable */
      return batch
        .commit()
        .then(() => snapshot.docs[snapshot.size - 1]);
      /* eslint-enable */
    })
    .then(lastDoc => {
      if (!lastDoc) return resolve();

      const startAfter = lastDoc.get('attachment.Subscriber.value');
      const newQuery = query.startAfter(startAfter);

      return process
        .nextTick(() => {
          return updateSubscriptions(newQuery, resolve, reject);
        });
    })
    .catch(reject);
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
  const query =
    rootCollections
      .activities
      .where('template', '==', 'subscription')
      .where('attachment.Template.value', '==', templateName)
      .orderBy('attachment.Subscriber.value')
      .limit(500);

  console.log({ templateName });

  return new Promise((resolve, reject) => {
    return updateSubscriptions(query, resolve, reject);
  })
    .then(() => updateActivities(change))
    .catch(console.error);
};
