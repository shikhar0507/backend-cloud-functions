'use strict';


const {
  rootCollections,
  db,
} = require('../../admin/admin');


module.exports = (bulkDoc) => {
  const {
    filteredObjectsArray,
    geopoint,
    office,
    officeId,
    template,
    timestamp,
  } = bulkDoc.data();

  const batchesArray = [];

  filteredObjectsArray.forEach((activity) => {
    const batch = db.batch();

    const activityRef = rootCollections.activities.doc();
    const addendumDocRef =
      rootCollections
        .offices
        .doc(officeId)
        .collection('Addendum')
        .doc();
    const activityData = activity.activityData;
    activityData.addendumDocRef = addendumDocRef;
    activityData.office = office;
    activityData.template = template;
    activityData.timestamp = timestamp;
    activityData.geopoint = geopoint;
    const addendumData = activity.addendumData;
    addendumData.activityId = activityRef.id;
    const assigneesArray = activity.assigneesArray;

    batch.set(activityRef, activityData);
    batch.set(addendumDocRef, addendumData);
    assigneesArray.forEach((object) => {
      const {
        canEdit,
        addToInclude,
        phoneNumber,
      } = object;

      const assigneeRef = activityRef
        .collection('Assignees')
        .doc(phoneNumber);

      batch.set(assigneeRef, { canEdit, addToInclude });
    });

    batchesArray.push(batch);
  });

  const batchCommitter =
    (start = 0, end) => {
      let nextIndex = start;
      let iterationCount = 0;

      const rangeIterator = {
        next: () => {
          let result;

          if (nextIndex <= end) {
            result = {
              value: nextIndex,
              done: false,
              promise: batchesArray[nextIndex].commit(),
            };

            nextIndex++;
            iterationCount++;

            return result;
          }

          return { value: iterationCount, done: true };
        },
      };

      return rangeIterator;
    };

  return Promise
    .resolve()
    .then(() => {
      const start = 0;
      const end = batchesArray[batchesArray.length - 1];
      const it = batchCommitter(start, end);
      const result = it.next();

      while (!result.done) {
        result
          .promise
          .then(() => it.next())
          .catch(console.error);
      }

      return;
    })
    .catch(console.error);
};
