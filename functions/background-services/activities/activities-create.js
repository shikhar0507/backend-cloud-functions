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

  const batchFactoriesArray = [];

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

    const batchFactory = () => batch.commit();

    batchFactoriesArray.push(batchFactory);
  });

  const executeSequentially = (promiseFactories) => {
    let result = Promise.resolve();

    promiseFactories.forEach((promiseFactory, index) => {
      result = result
        .then(promiseFactory)
        .then(() => console.log('committed index', index));
    });

    return result;
  };

  return executeSequentially(batchFactoriesArray)
    .then((result) => console.log({ result }))
    .catch(console.error);
};
