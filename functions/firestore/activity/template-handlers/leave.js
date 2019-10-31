'use strict';

const momentTz = require('moment-timezone');
const {
  db,
  rootCollections,
} = require('../../../admin/admin');
const {
  getAuth,
  getDefaultAttendanceObject,
  getEmployeeReportData,
} = require('../../../admin/utils');
const {
  dateFormats,
  httpsActions,
  addendumTypes,
  subcollectionNames,
} = require('../../../admin/constants');


module.exports = async locals => {
  console.log('In leave handler');

  if (!locals.addendumDocData) {
    return;
  }

  console.log('action', locals.addendumDocData.action);

  if (locals.addendumDocData.action !== httpsActions.create
    && locals.addendumDocData.action !== httpsActions.update
    && locals.addendumDocData.action !== httpsActions.changeStatus) {
    return;
  }

  const {
    startTime,
    endTime,
  } = locals.change.after.get('schedule')[0];
  const {
    officeId,
    status,
    timezone,
    creator: {
      phoneNumber,
    },
  } = locals.change.after.data();
  const batch = db.batch();
  const momentNow = momentTz().tz(timezone);
  const rangeStart = momentTz(startTime).startOf('day');
  const rangeEnd = momentTz(endTime).endOf('day');
  const tempMoment = rangeStart.clone();
  const attendanceDocPromises = [];
  const monthsSet = new Set();
  const monthToDate = {};

  const employeeData = await getEmployeeReportData(officeId, phoneNumber);

  while (tempMoment.isSameOrBefore(rangeEnd)) {
    if (monthsSet.has(tempMoment.month())) {
      console.log('in loop');

      continue;
    }

    monthToDate[tempMoment.month()] = monthToDate[tempMoment.month()] || [];
    monthToDate[tempMoment.month()]
      .push(tempMoment.date());

    const promise = rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ATTENDANCES)
      .where('month', '==', tempMoment.month())
      .where('year', '==', tempMoment.year())
      .where('phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    attendanceDocPromises
      .push(promise);
    monthsSet
      .add(tempMoment.month());

    tempMoment
      .add(1, 'days');
  }

  console.log('monthToDate', monthToDate);

  const { uid } = await getAuth(phoneNumber);

  const attendanceSnaps = await Promise
    .all(attendanceDocPromises);
  const conflictingDates = [];

  console.log('attendanceSnaps', attendanceSnaps.length);

  attendanceSnaps
    .forEach(snap => {
      const doc = snap.docs[0];
      const filters = snap.query._queryOptions.fieldFilters;
      const month = filters[0].value;
      const year = filters[1].value;
      const datesArray = monthToDate[month] || [];

      const docData = doc ? doc.data() : {};
      docData
        .attendance = docData.attendance || {};

      datesArray
        .forEach(date => {
          const momentForDate = momentTz()
            .tz(timezone)
            .date(date)
            .month(month)
            .year(year);

          docData
            .attendance[date] = docData.attendance[date] || getDefaultAttendanceObject();

          if (docData.attendance[date].onLeave
            || docData.attendance[date].onAr) {
            conflictingDates
              .push(momentForDate.format(dateFormats.DATE));

            return;
          }

          docData
            .attendance[date]
            .leave
            .reason = locals.change.after.get('attachment.Reason.value') || '';
          docData
            .attendance[date]
            .leave
            .leaveType = locals.change.after.get('attachment.Leave Type.value') || '';
          docData
            .attendance[date]
            .attendance = 1;
          docData
            .attendance[date]
            .onLeave = true;
          docData
            .attendance[date]
            .leave = docData.attendance[date].leave || {};
          docData
            .attendance[date]
            .leave[status] = {
              phoneNumber: locals.addendumDocData.user,
              timestamp: Date.now(),
            };

          batch
            .set(rootCollections
              .updates
              .doc(uid)
              .collection(subcollectionNames.ADDENDUM)
              .doc(), {
              date,
              month,
              year,
              officeId,
              office: locals.change.after.get('office'),
              attendance: 1,
              _type: addendumTypes.ATTENDANCE,
              id: `${date}${month}${year}${officeId}`,
              key: momentForDate.clone().startOf('date').valueOf(),
              onAr: docData.attendance[date].onAr || false,
              onLeave: docData.attendance[date].onLeave || false,
              weeklyOff: docData.attendance[date].weeklyOff || false,
              holiday: docData.attendance[date].holiday || false,
              isLate: docData.attendance[date].isLate || false,
              addendum: docData.attendance[date].addendum || [],
            }, {
              merge: true,
            });
        });

      const reimbursementsDocRef = doc ? doc.ref : rootCollections
        .offices
        .doc(officeId)
        .collection(subcollectionNames.ATTENDANCES)
        .doc();

      console.log('reimbursements Path', reimbursementsDocRef.path);

      batch
        .set(reimbursementsDocRef,
          Object.assign({}, docData, employeeData), {
          merge: true,
        });
    });

  console.log('leave conflictingDates', conflictingDates);

  /**
   * No conflict in dates, so pushing attendance objects
   * in Updates collection for this user is ok.
   */
  if (conflictingDates.length === 0) {
    return batch
      .commit();
  }

  // dates conflict with leave
  // cancel activity
  const addendumDocRef = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();
  const comment = `Leave cancelled. Attendance is`
    + ` already set to 'Present'`
    + ` on the following date(s): ${[...conflictingDates]}`;

  const addendumDocData = {
    comment,
    isConflictedComment: true,
    date: momentNow.date(),
    month: momentNow.month(),
    year: momentNow.year(),
    user: locals.addendumDocData.user,
    action: httpsActions.comment,
    location: locals.addendumDocData.location,
    timestamp: Date.now(),
    userDeviceTimestamp: locals.addendumDocData.userDeviceTimestamp,
    activityId: locals.change.after.id,
    isSupportRequest: locals.addendumDocData.isSupportRequest,
    activityData: locals.change.after.data(),
    geopointAccuracy: locals.addendumDocData.geopointAccuracy || null,
    provider: locals.addendumDocData.provider,
    userDisplayName: locals.addendumDocData.userDisplayName,
    isAutoGenerated: true,
  };

  batch
    .set(addendumDocRef, addendumDocData);

  batch
    .set(locals.change.after.ref, {
      addendumDocRef,
      status: 'CANCELLED',
    }, {
      merge: true,
    });

  return batch
    .commit();
};
