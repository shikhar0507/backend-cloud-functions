'use strict';

const momentTz = require('moment-timezone');
const {
  db,
  rootCollections,
} = require('../../../admin/admin');
const {
  addendumTypes,
  httpsActions,
  subcollectionNames,
} = require('../../../admin/constants');
const {
  getAuth,
  populateWeeklyOffInAttendance,
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
  const { action } = locals.addendumDocData;
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

  let uid = locals.addendumDocData.uid;

  if (!uid) {
    uid = (await getAuth(phoneNumber)).uid;
  }

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

  const attendanceUpdate = Object
    .assign({}, employeeData, attendanceDocData);

  batch
    .set(attendanceDocRef, Object.assign({
      month,
      year,
      office,
      officeId,
      timestamp: Date.now(),
    }, attendanceUpdate), {
      merge: true,
    });

  batch
    .set(rootCollections
      .updates
      .doc(uid)
      .collection(subcollectionNames.ADDENDUM)
      .doc(), Object.assign({}, attendanceUpdate.attendance[date], {
        date,
        month,
        year,
        office,
        officeId,
        timestamp: Date.now(),
        activityId: locals.change.after.id,
        _type: addendumTypes.ATTENDANCE,
        key: momentArDate.clone().startOf('day').valueOf(),
        id: `${date}${month}${year}${officeId}`,
      }), {
      merge: true,
    });

  await batch
    .commit();

  /**
   * Doc will be created
   */
  if (!attendanceDoc) {
    const employeeDoc = (await rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ACTIVITIES)
      .where('template', '==', 'employee')
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .where('status', '==', 'CONFIRMED')
      .limit(1)
      .get())
      .docs[0];

    return populateWeeklyOffInAttendance({
      uid,
      employeeDoc,
      month: momentNow.month(),
      year: momentNow.year(),
    });
  }

  return;
};
