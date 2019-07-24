'use strict';

const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  toMapsUrl,
} = require('../../firestore/recipients/report-utils');
const momentTz = require('moment-timezone');

/**
 * Queries the Offices/officeId/Addendum collection for
 * docs with the value set to distanceAccurate `false`
 * for the current monthly cycle of the office and updates those
 * documents with new location string and url.
 *
 * @param {Object} DataSnapshot with the created location object
 * @param {Object} Context Context for the event.
 */
module.exports = async (snap, context) => {
  const { officeId } = context.params;

  const locationObject = snap.val();
  const officeDoc = await rootCollections
    .offices
    .doc(officeId)
    .get();
  const timezone = officeDoc
    .get('attachment.Timezone.value');
  const firstDayOfMonthlyCycle = officeDoc
    .get('attachment.First Day Of Monthly Cycle.value') || 1;
  const monthlyCycleStart = momentTz()
    .date(firstDayOfMonthlyCycle)
    .tz(timezone);
  const addendumDocs = await rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .where('adjustedGeopoints.latitude', '==', locationObject.latitude)
    .where('adjustedGeopoints.longitude', '==', locationObject.longitude)
    .where('distanceAccurate', '==', false)
    .where('timestamp', '>=', monthlyCycleStart.valueOf())
    .get();

  let docsCounter = 0;
  const numberOfDocs = addendumDocs.size;
  const MAX_DOCS_ALLOWED_IN_A_BATCH = 500;
  const numberOfBatches = Math
    .round(
      Math
        .ceil(numberOfDocs / MAX_DOCS_ALLOWED_IN_A_BATCH)
    );
  const batchesArray = Array
    .from(Array(numberOfBatches)).map(() => db.batch());
  let batchIndex = 0;

  addendumDocs.forEach(doc => {
    if (docsCounter > 499) {
      console.log('reset batch...');
      docsCounter = 0;
      batchIndex++;
    }

    docsCounter++;

    batchesArray[
      batchIndex
    ].set(doc.ref, {
      distanceAccurate: true,
      url: toMapsUrl({
        latitude: locationObject.latitude,
        longitude: locationObject.longitude
      }),
      identifier: locationObject.location,
    }, {
        merge: true,
      });
  });

  return Promise
    .all(batchesArray.map(batch => batch.commit()));
};
