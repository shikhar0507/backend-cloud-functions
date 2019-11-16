'use strict';

const admin = require('firebase-admin');
const db = admin.firestore();
const {
  rootCollections,
} = require('../admin/admin');
const {
  getAuth,
} = require('../admin/utils');
const {
  httpsActions,
  addendumTypes,
  subcollectionNames,
} = require('../admin/constants');


const Deleter = async snap => {
  const { office } = snap.data();
  const authPromises = [];
  const branchData = {};
  const authObjects = {};

  const [
    employees,
    branches,
  ] = await Promise
    .all([
      rootCollections
        .activities
        .where('template', '==', 'employee')
        .where('office', '==', office)
        .where('status', '==', 'CONFIRMED')
        .get(),
      rootCollections
        .activities
        .where('template', '==', 'branch')
        .where('office', '==', office)
        .where('status', '==', 'CONFIRMED')
        .get(),
    ]);

  branches
    .forEach(branch => {
      branchData[branch.get('attachment.Name.value')] = branch;
    });

  const numberOfDocs = employees.size * 63;
  const MAX_DOCS_ALLOWED_IN_A_BATCH = 199;
  const numberOfBatches = Math
    .round(
      Math
        .ceil(numberOfDocs / MAX_DOCS_ALLOWED_IN_A_BATCH)
    );
  const batchArray = Array
    .from(Array(numberOfBatches)).map(() => db.batch());
  let batchIndex = 0;
  let docsCounter = 0;
  const MAX_UPDATES = 200;

  const userRecords = await Promise
    .all(authPromises);
  const empContactSet = new Set();

  userRecords
    .forEach(ur => {
      const { phoneNumber, uid } = ur;

      authObjects[phoneNumber] = uid;
    });

  employees.forEach(doc => {
    const phoneNumber = doc
      .get('attachment.Employee Contact.value');

    if (empContactSet.has(phoneNumber)) {
      return;
    }

    if (docsCounter > MAX_UPDATES) {
      batchIndex++;
      docsCounter++;
    }

    docsCounter++;

    empContactSet
      .add(phoneNumber);
    const bl = doc
      .get('attachment.Base Location.value');
    const ref = db
      .collection('FromDeleter')
      .doc();

    batchArray[
      batchIndex
    ].set(ref, {
      employeeData: doc.data(),
      branchData: branchData[bl] || {},
      uid: authObjects[phoneNumber] || null,
    }, {
      merge: true,
    });
  });

  console.log('batchArray', batchArray.length);

  return Promise
    .all(batchArray.map(batch => {
      console.log('batch._ops', batch._ops.length);

      return batch
        .commit();
    }));
};

module.exports = async snap => {
  try {
    return Deleter(snap);
  } catch (error) {
    console.error(error);
  }
};
