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
  const mainObjects = [];
  const phoneNumberChangeAddendumPromises = [];
  const authObjects = {};
  const phoneNumberChangeDataSet = {};
  const rangeStart = momentTz().month(8).startOf('month');
  const rangeEnd = rangeStart.clone().endOf('month');
  const oldAttendanceQueries = [];
  const attendanceDeleterBatch = db.batch();
  const fromDeleterBatch = db.batch();

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
    .forEach(branch => {
      const name = branch.get('attachment.Name.value');

      branchData[name] = branch;
    });

  const officeDoc = (await rootCollections
    .offices
    .where('office', '==', office)
    .limit(1)
    .get())
    .docs[0];

  employees.forEach(employee => {
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

    authPromises.push(getAuth(phoneNumber));

    const uid = authObjects[phoneNumber];

    if (uid) {
      const aq = rootCollections
        .updates
        .doc(uid)
        .collection(subcollectionNames.ADDENDUM)
        .where('_type', '==', addendumTypes.ATTENDANCE)
        .get();

      oldAttendanceQueries.push(aq);
    }
  });

  const oldAttendanceSnaps = await Promise.all(oldAttendanceQueries);

  oldAttendanceSnaps.forEach(snap => {
    snap.forEach(doc => {
      console.log('deleting oldAttendanceSnaps', doc.ref.path);

      attendanceDeleterBatch.delete(doc.ref);
    });
  });

  const userRecords = await Promise.all(authPromises);

  userRecords.forEach(ur => {
    const { phoneNumber, uid } = ur;

    authObjects[phoneNumber] = uid;
  });

  const attendanceSnaps = await Promise
    .all(attendancePromises);

  attendanceSnaps.forEach(snap => {
    const doc = snap.docs[0];

    if (doc) {
      console.log('attendanceSnaps deleting', doc.ref.path);

      attendanceDeleterBatch
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

    const o = {
      uid: authObjects[phoneNumber] || '',
      employeeData: Object.assign({}, emp.data(), {
        createTime: emp.createTime.toMillis(),
        id: emp.id,
      }),
      branchData: branchData[baseLocation] ? branchData[baseLocation].data() : {},
      phoneNumberChanges: phoneNumberChangeDataSet[phoneNumber] || [],
    };

    mainObjects
      .push(o);

    const ref = db.collection('FromDeleter').doc();

    console.log(phoneNumber, ref.path);

    fromDeleterBatch
      .set(ref, o);
  });

  return Promise
    .all([
      fromDeleterBatch
        .commit(),
      attendanceDeleterBatch
        .commit(),
    ]);
};

module.exports = async snap => {
  return Deleter(snap);
};
