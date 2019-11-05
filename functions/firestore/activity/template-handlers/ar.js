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
const {
  getStatusForDay,
} = require('../../recipients/report-utils');


module.exports = async locals => {
  if (!locals.addendumDocData) {
    return;
  }

  if (locals.addendumDocData.isConflictedComment) {
    return;
  }

  const {
    timezone,
    status,
    officeId,
    creator: {
      phoneNumber,
    },
    office,
  } = locals.change.after.data();

  const momentNow = momentTz().tz(timezone);
  const arSchedule = locals.change.after.get('schedule')[0].startTime;
  const momentArDate = momentTz(arSchedule);
  const date = momentArDate.date();
  const month = momentArDate.month();
  const year = momentArDate.year();
  const batch = db.batch();
  const action = locals.addendumDocData.action;
  const arAppliedForFuture = arSchedule >= momentTz().tz(timezone).startOf('day').valueOf();
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

  if (status !== 'CANCELLED') {
    attendanceDocData
      .attendance[date]
      .attendance = 1;
  }

  attendanceDocData
    .attendance[date]
    .ar
    .reason = locals.change.after.get('attachment.Reason.value');

  if (action === httpsActions.changeStatus
    && status === 'CANCELLED') {
    const numberOfCheckIns = attendanceDocData.attendance[date].addendum.length;
    const firstAddendum = attendanceDocData.attendance[date].addendum[0];
    const lastAddendum = attendanceDocData.attendance[date].addendum[numberOfCheckIns - 1];
    const hoursWorked = momentTz(lastAddendum.timestamp)
      .diff(momentTz(firstAddendum.timestamp), 'hours', true);

    attendanceDocData
      .attendance[date]
      .onAr = false;

    attendanceDocData
      .attendance[date]
      .attendance = getStatusForDay({
        numberOfCheckIns, // number of actions done in the day by the user
        hoursWorked, // difference between first and last action in hours,
        minimumWorkingHours: employeeData.minimumWorkingHours,
        minimumDailyActivityCount: employeeData.minimumDailyActivityCount,
      });
  }

  console.log('AR ID', locals.change.after.id);
  console.log('AR for', momentArDate.format(dateFormats.DATE));

  const attendanceUpdate = Object
    .assign({}, attendanceDocData, employeeData);

  console.log('attendanceDocRef', attendanceDocRef.path);
  console.log('attendanceUpdate', attendanceUpdate.attendance[date]);

  batch
    .set(attendanceDocRef, Object.assign({
      month,
      year,
      office,
      officeId,
    }, attendanceUpdate), {
      merge: true,
    });

  batch
    .set(rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), Object.assign({}, attendanceUpdate.attendance[date], {
        office,
        officeId,
        _type: addendumTypes.ATTENDANCE,
        key: momentArDate.clone().startOf('day').valueOf(),
        id: `${date}${month}${year}${officeId}`,
      }), {
      merge: true,
    });

  console.log('hasConflictWithLeave', hasConflictWithLeave);
  console.log('hasConflictWithAr', hasConflictWithAr);

  // Ar or leave already applied on the date
  if (hasConflictWithLeave
    || hasConflictWithAr
    || arAppliedForFuture) {
    const addendumDocRef = rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ADDENDUM)
      .doc();

    console.log('Cancelling activity');

    batch
      .set(locals.change.after.ref, {
        addendumDocRef,
        status: 'CANCELLED',
      }, {
        merge: true,
      });

    // arAppliedForFuture
    const comment = (() => {
      if (arAppliedForFuture) {
        return `ATTENDANCE REGULARIZATION CANCELLED:`
          + ` Attendance can only be reglularized for the past`;
      }

      return `Attendance Regularization Cancelled:`
        + ` ${hasConflictWithLeave ? 'Leave' : 'attendance regularization'}`
        + ` has already been applied for the date:`
        + ` ${momentArDate.format(dateFormats.DATE)}`;
    })();

    batch
      .set(addendumDocRef, {
        comment,
        isConflictedComment: true,
        date: momentNow.date(),
        month: momentNow.month(),
        year: momentNow.year(),
        user: locals.addendumDocData.user,
        action: httpsActions.comment,
        location: locals.addendumDocData.location,
        timestamp: Date.now(),
        userDeviceTimestamp: locals.addendumDocData.userDeviceTimestamp || '',
        activityId: locals.change.after.id,
        isSupportRequest: locals.addendumDocData.isSupportRequest,
        activityData: locals.change.after.data(),
        geopointAccuracy: locals.addendumDocData.accuracy || null,
        provider: locals.addendumDocData.provider || null,
        userDisplayName: locals.addendumDocData.userDisplayName || '',
      });
  }

  return batch
    .commit();
};
