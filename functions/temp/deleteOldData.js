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
  const rangeStart = momentTz().month(8).startOf('month');
  const rangeEnd = rangeStart.clone().endOf('month');
  const oldAttendanceQueries = [];

  const [
    employees,
    branches,
  ] = await Promise
    .all([
      rootCollections
        .activities
        .where('template', '==', 'employee')
        .where('office', '==', office)
        .get(),
      rootCollections
        .activities
        .where('template', '==', 'branch')
        .where('office', '==', office)
        .get(),
    ]);


  branches
    .forEach(branch => { branchData[branch.get('attachment.Name.value')] = branch; });

  const officeDoc = (await rootCollections
    .offices
    .where('office', '==', office)
    .limit(1)
    .get())
    .docs[0];

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
      const addendumOldPhoneNumber = officeDoc
        .ref
        .collection('Addendum')
        .where('action', '==', httpsActions.updatePhoneNumber)
        .where('oldPhoneNumber', '==', phoneNumber)
        .get();
      const addendumNewPhoneNumber = officeDoc
        .ref
        .collection('Addendum')
        .where('action', '==', httpsActions.updatePhoneNumber)
        .where('newPhoneNumber', '==', phoneNumber)
        .get();

      phoneNumberChangeAddendumPromises
        .push(addendumOldPhoneNumber, addendumNewPhoneNumber);

      attendancePromises
        .push(officeDoc
          .ref
          .collection(subcollectionNames.ATTENDANCES)
          .where('phoneNumber', '==', phoneNumber)
          .limit(1)
          .get()
        );

      authPromises
        .push(getAuth(phoneNumber));
    });

  const userRecords = await Promise
    .all(authPromises);

  userRecords
    .forEach(ur => {
      const { phoneNumber, uid } = ur;

      authObjects[phoneNumber] = uid;

      if (uid) {
        const aq = rootCollections
          .updates
          .doc(uid)
          .collection(subcollectionNames.ADDENDUM)
          .where('_type', '==', addendumTypes.ATTENDANCE)
          .get();

        oldAttendanceQueries
          .push(aq);
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
    const doc = snap.docs[0];

    if (doc) {
      if (docsCounter > MAX_UPDATES) {
        docsCounter = 0;
        batchIndex++;
      }

      docsCounter++;

      batchArray[batchIndex]
        .delete(doc.ref);
    }
  });

  const snaps = await Promise
    .all(phoneNumberChangeAddendumPromises);

  snaps.forEach(snap => {
    snap.forEach(doc => {
      const { timestamp, oldPhoneNumber, newPhoneNumber } = doc.data();
      const momentInstance = momentTz(timestamp);

      if (momentInstance.isBefore(rangeStart)
        || momentInstance.isAfter(rangeEnd)) {
        return;
      }

      phoneNumberChangeDataSet[oldPhoneNumber] = phoneNumberChangeDataSet[oldPhoneNumber] || [];
      phoneNumberChangeDataSet[oldPhoneNumber].push(newPhoneNumber);
      phoneNumberChangeDataSet[newPhoneNumber] = phoneNumberChangeDataSet[newPhoneNumber] || [];
      phoneNumberChangeDataSet[newPhoneNumber].push(oldPhoneNumber);
    });
  });

  employees.forEach(emp => {
    const baseLocation = emp.get('attachment.Base Location.value');
    const phoneNumber = emp.get('attachment.Employee Contact.value');
    const ref = db.collection('FromDeleter').doc();

    if (docsCounter > MAX_UPDATES) {
      docsCounter = 0;
      batchIndex++;
    }

    docsCounter++;

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
