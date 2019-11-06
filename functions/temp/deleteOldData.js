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
const momentTz = require('moment-timezone');

const Deleter = async snap => {
  const { office } = snap.data();
  const branchData = {};
  const attendancePromises = [];
  const authPromises = [];
  const phoneNumberChangeAddendumPromises = [];
  const authObjects = {};
  const phoneNumberChangeDataSet = {};
  const oldAttendanceQueries = [];
  const jsonFile = require('./data.json');
  const timedOutPhoneNumbersArray = JSON
    .parse(JSON.stringify(jsonFile)).phoneNumbers;

  const [
    employees,
    branches,
  ] = await Promise
    .all([
      rootCollections
        .activities
        .where('template', '==', 'employee')
        .where('office', '==', office)
        // .where('s')
        .get(),
      rootCollections
        .activities
        .where('template', '==', 'branch')
        .where('office', '==', office)
        .get(),
    ]);

  branches
    .forEach(branch => {
      branchData[branch.get('attachment.Name.value')] = branch;
    });

  const officeDoc = (await rootCollections
    .offices
    .where('office', '==', office)
    .limit(1)
    .get())
    .docs[0];

  const timezone = officeDoc.get('attachment.Timezone.value');
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

  employees
    .forEach(employee => {
      const phoneNumber = employee.get('attachment.Employee Contact.value');
      const status = employee.get('status');

      // if (!timedOutPhoneNumbersArray.includes(phoneNumber)
      //   || status !== 'CONFIRMED') {
      //   return;
      // }
      if (timedOutPhoneNumbersArray.includes(phoneNumber)
        && status === 'CONFIRMED') {
        phoneNumberChangeAddendumPromises
          .push(
            officeDoc
              .ref
              .collection('Addendum')
              .where('action', '==', httpsActions.updatePhoneNumber)
              .where('month', '==', 8)
              .where('oldPhoneNumber', '==', phoneNumber)
              .get(),
            officeDoc
              .ref
              .collection('Addendum')
              .where('action', '==', httpsActions.updatePhoneNumber)
              .where('month', '==', 8)
              .where('newPhoneNumber', '==', phoneNumber)
              .get(),
            officeDoc
              .ref
              .collection('Addendum')
              .where('action', '==', httpsActions.updatePhoneNumber)
              .where('month', '==', 9)
              .where('oldPhoneNumber', '==', phoneNumber)
              .get(),
            officeDoc
              .ref
              .collection('Addendum')
              .where('action', '==', httpsActions.updatePhoneNumber)
              .where('month', '==', 9)
              .where('newPhoneNumber', '==', phoneNumber)
              .get(),
          );

        attendancePromises
          .push(
            officeDoc
              .ref
              .collection(subcollectionNames.ATTENDANCES)
              .where('phoneNumber', '==', phoneNumber)
              .where('month', '==', 8)
              .where('year', '==', 2019)
              .get(),
            officeDoc
              .ref
              .collection(subcollectionNames.ATTENDANCES)
              .where('phoneNumber', '==', phoneNumber)
              .where('month', '==', 9)
              .where('year', '==', 2019)
              .get(),
          );

        authPromises
          .push(getAuth(phoneNumber));
      }
    });

  const userRecords = await Promise
    .all(authPromises);

  userRecords
    .forEach(ur => {
      const { phoneNumber, uid } = ur;

      authObjects[phoneNumber] = uid;

      if (uid) {
        oldAttendanceQueries
          .push(
            rootCollections
              .updates
              .doc(uid)
              .collection(subcollectionNames.ADDENDUM)
              .where('_type', '==', addendumTypes.ATTENDANCE)
              .where('month', '==', 8)
              .where('year', '==', 2019)
              .get(),
            rootCollections
              .updates
              .doc(uid)
              .collection(subcollectionNames.ADDENDUM)
              .where('_type', '==', addendumTypes.ATTENDANCE)
              .where('month', '==', 9)
              .where('year', '==', 2019)
              .get()
          );
      }
    });

  const oldAttendanceSnaps = await Promise
    .all(oldAttendanceQueries);

  oldAttendanceSnaps.forEach(snap => {
    snap.forEach(doc => {
      if (docsCounter > MAX_UPDATES) {
        docsCounter = 0;
        batchIndex++;
      }

      docsCounter++;

      batchArray[batchIndex]
        .delete(doc.ref);
    });
  });

  const attendanceSnaps = await Promise
    .all(attendancePromises);

  attendanceSnaps.forEach(snap => {
    snap.forEach(doc => {
      if (docsCounter > MAX_UPDATES) {
        docsCounter = 0;
        batchIndex++;
      }

      docsCounter++;

      batchArray[batchIndex]
        .delete(doc.ref);
    });
  });

  // delete batch split
  // write batch split.
  const snaps = await Promise
    .all(phoneNumberChangeAddendumPromises);

  snaps.forEach(snap => {
    snap.forEach(doc => {
      const { oldPhoneNumber, newPhoneNumber } = doc.data();

      phoneNumberChangeDataSet[oldPhoneNumber] = phoneNumberChangeDataSet[oldPhoneNumber] || [];
      phoneNumberChangeDataSet[oldPhoneNumber].push(newPhoneNumber);
      phoneNumberChangeDataSet[newPhoneNumber] = phoneNumberChangeDataSet[newPhoneNumber] || [];
      phoneNumberChangeDataSet[newPhoneNumber].push(oldPhoneNumber);
    });
  });

  employees.forEach(emp => {
    const baseLocation = emp.get('attachment.Base Location.value');
    const phoneNumber = emp.get('attachment.Employee Contact.value');
    const status = emp.get('status');

    if (timedOutPhoneNumbersArray.includes(phoneNumber)
      && status == 'CONFIRMED') {
      if (docsCounter > MAX_UPDATES) {
        docsCounter = 0;
        batchIndex++;
      }

      docsCounter++;
      const ref = db.collection('FromDeleter').doc();

      console.log('FromDeleter', ref.path);

      batchArray[batchIndex]
        .set(ref, {
          uid: authObjects[phoneNumber] || '',
          employeeData: Object.assign({}, emp.data(), {
            createTime: emp.createTime.toMillis(),
            id: emp.id,
          }),
          branchData: branchData[baseLocation] ? branchData[baseLocation].data() : {},
          phoneNumberChanges: phoneNumberChangeDataSet[phoneNumber] || [],
        });
    }
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
