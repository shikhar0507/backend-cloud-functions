'use strict';

const momentTz = require('moment-timezone');
const {
  db,
  rootCollections,
} = require('../../../admin/admin');
const {
  addendumTypes,
  dateFormats,
  httpsActions,
  subcollectionNames,
} = require('../../../admin/constants');
const {
  getAuth,
  getEmployeeReportData,
  getDefaultAttendanceObject,
} = require('../../../admin/utils');


module.exports = async locals => {
  if (!locals.addendumDocData) {
    console.log('IN AR returning');
    return;
  }

  const arSchedule = locals.change.after.get('schedule')[0].startTime;
  const momentArDate = momentTz(arSchedule);
  const date = momentArDate.date();
  const month = momentArDate.month();
  const year = momentArDate.year();
  const timezone = locals.change.after.get('timezone');
  const status = locals.change.after.get('status');
  const officeId = locals.change.after.get('officeId');
  const phoneNumber = locals.change.after.get('creator.phoneNumber');
  const batch = db.batch();
  const attendanceDoc = (await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .where('phoneNumber', '==', phoneNumber)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get())
    .docs[0];

  const { uid } = await getAuth(phoneNumber);
  const employeeData = await getEmployeeReportData(officeId, phoneNumber);

  const attendanceDocData = attendanceDoc ? attendanceDoc.data() : {};
  const attendanceDocRef = attendanceDoc ? attendanceDoc.ref : rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc();

  attendanceDocData
    .attendance = attendanceDocData.attendance || {};

  attendanceDocData
    .attendance[date] = attendanceDocData
      .attendance[date] || getDefaultAttendanceObject();

  const hasConflictWithAr = attendanceDocData.attendance[date].onAr === true;
  const hasConflictWithLeave = attendanceDocData.attendance[date].onLeave === true;

  attendanceDocData
    .attendance[date]
    .ar[status] = {
      phoneNumber: locals.addendumDocData.user,
      timestamp: Date.now(),
    };

  attendanceDocData
    .attendance[date]
    .onAr = status !== 'CANCELLED';

  console.log('AR ID', locals.change.after.id);
  console.log('AR for', momentArDate.format(dateFormats.DATE));

  const attendanceUpdate = Object
    .assign({}, attendanceDocData, employeeData);

  console.log('attendanceDocRef', attendanceDocRef.path);
  console.log('attendanceUpdate', attendanceUpdate.attendance[date]);

  batch
    .set(attendanceDocRef, attendanceUpdate, {
      merge: true,
    });

  const updatesRef = rootCollections
    .updates
    .doc(uid)
    .collection(uid)
    .doc(attendanceDocRef.id);

  console.log('updatesId', updatesRef.id);

  batch
    .set(updatesRef, Object.assign({}, attendanceUpdate, {
      _type: addendumTypes.ATTENDANCE,
      key: `${date}${month}${year}${officeId}`,
      id: momentArDate.clone().startOf('day').valueOf(),
    }), {
      merge: true,
    });

  console.log('hasConflictWithLeave', hasConflictWithLeave);
  console.log('hasConflictWithAr', hasConflictWithAr);

  // Ar or leave already applied on the date
  if (hasConflictWithLeave
    || hasConflictWithAr) {
    const addendumDocRef = rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ADDENDUM)
      .doc();

    console.log('Cancelling activity');

    batch
      .set(locals.change.after.get(), {
        addendumDocRef,
        status: 'CANCELLED',
      }, {
        merge: true,
      });

    const momentNow = momentTz().tz(timezone);
    const comment = `Attendance Regularization Cancelled:`
      + ` ${hasConflictWithLeave ? 'Leave' : 'attendance regularization'}`
      + ` has already been applied for the date:`
      + ` ${momentArDate.format(dateFormats.DATE)}`;

    batch
      .set(addendumDocRef, {
        comment,
        date: momentNow.getDate(),
        month: momentNow.getMonth(),
        year: momentNow.getFullYear(),
        user: locals.addendumDocData.user,
        action: httpsActions.comment,
        location: locals.addendumDocData.location,
        timestamp: Date.now(),
        userDeviceTimestamp: locals.addendumDocData.userDeviceTimestamp,
        activityId: locals.change.after.id,
        isSupportRequest: locals.addendumDocData.isSupportRequest,
        activityData: locals.change.after.data(),
        geopointAccuracy: locals.addendumDocData.accuracy || null,
        provider: locals.addendumDocData.provider || null,
        userDisplayName: locals.addendumDocData.displayName,
      });
  }

  return batch
    .commit();
};
