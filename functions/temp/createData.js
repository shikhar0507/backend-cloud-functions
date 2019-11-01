'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const {
  subcollectionNames,
  httpsActions,
  addendumTypes,
} = require('../admin/constants');
const momentTz = require('moment-timezone');
const {
  getStatusForDay,
} = require('../firestore/recipients/report-utils');

const getDefaultAttendanceObject = () => {
  return {
    onAr: false,
    onLeave: false,
    weeklyOff: false,
    isLate: false,
    holiday: false,
    attendance: 0,
    addendum: [],
    working: {
      firstCheckInTimestamp: '',
      lastCheckInTimestamp: '',
      numberOfCheckIns: 0,
    },
    ar: {
      reason: '',
      CONFIRMED: {
        phoneNumber: '',
        timestamp: '',
      },
      PENDING: {
        phoneNumber: '',
        timestamp: '',
      },
      CANCELLED: {
        phoneNumber: '',
        timestamp: '',
      },
    },
    leave: {
      reason: '',
      leaveType: '',
      CONFIRMED: {
        phoneNumber: '',
        timestamp: '',
      },
      PENDING: {
        phoneNumber: '',
        timestamp: '',
      },
      CANCELLED: {
        phoneNumber: '',
        timestamp: '',
      },
    },
  };
};

const getReportEmployeeMeta = employeeData => {
  return {
    id: employeeData.id,
    activationDate: employeeData.createTime,
    phoneNumber: employeeData.attachment['Employee Contact'].value,
    employeeName: employeeData.attachment.Name.value,
    employeeCode: employeeData.attachment['Employee Code'].value,
    baseLocation: employeeData.attachment['Base Location'].value,
    region: employeeData.attachment.Region.value,
    department: employeeData.attachment.Department.value,
  };
};

const Creator = async snap => {
  const {
    uid,
    employeeData,
    branchData,
    phoneNumberChanges,
  } = snap.data();
  const year = 2019;
  const batch = db.batch();
  const allDocsWrittenPaths = [];
  const checkInAddendumPromises = [];
  const office = employeeData.office;
  const officeId = employeeData.officeId;
  const latestPhoneNumber = employeeData.attachment['Employee Contact'].value;
  const locationValidationCheck = employeeData.attachment['Location Validation Check'].value;
  const minimumDailyActivityCount = employeeData.attachment['Minimum Daily Activity Count'].value;
  const minimumWorkingHours = employeeData.attachment['Minimum Working Hours'].value;
  const reportEmployeeMeta = getReportEmployeeMeta(employeeData);
  const attendanceDocDataSept = Object.assign({
    month: 8,
    year: 2019,
  }, reportEmployeeMeta);
  const attendanceDocDataOct = Object.assign({
    office,
    officeId,
    month: 9,
    year: 2019,
  }, reportEmployeeMeta);

  if (branchData && branchData.attachment) {
    const weeklyOffFromBranch = branchData.attachment['Weekly Off'].value;
    const rangeStart = momentTz().month(8).startOf('month');
    const rangeEnd = momentTz().month(9).endOf('month');
    const tempMoment = rangeStart.clone();

    while (tempMoment.isSameOrBefore(rangeEnd)) {
      const month = tempMoment.month();
      const date = tempMoment.date();
      const weekdayName = tempMoment.format('dddd').toLowerCase();
      const obj = (() => {
        if (month === 8) {
          return attendanceDocDataSept;
        }

        return attendanceDocDataOct;
      })();

      if (weeklyOffFromBranch === weekdayName) {
        obj
          .attendance = obj.attendance || {};
        obj
          .attendance[date] = obj.attendance[date] || getDefaultAttendanceObject();

        obj
          .attendance[date].weeklyOff = true;
        obj
          .attendance[date].attendance = 1;
      }

      tempMoment
        .add(1, 'days');
    }
  }

  if (branchData && branchData.schedule) {
    const branchHolidays = branchData.schedule;

    branchHolidays.forEach(schedule => {
      const { startTime } = schedule;

      if (!startTime) {
        return;
      }

      const momentNow = momentTz(startTime);
      const date = momentNow.date();
      const month = momentNow.month();

      if (month !== 8 && month !== 9) {
        return;
      }

      const obj = (() => {
        if (month === 8) {
          return attendanceDocDataSept;
        }

        return attendanceDocDataOct;
      })();

      obj
        .attendance = obj.attendance || {};
      obj
        .attendance[date] = obj.attendance[date] || getDefaultAttendanceObject();
      obj
        .attendance[date].holiday = true;
      obj
        .attendance[date].attendance = 1;
    });
  }

  [
    latestPhoneNumber,
    ...phoneNumberChanges,
  ].forEach(phoneNumber => {
    const checkInAddendumPromise = rootCollections
      .offices
      .doc(officeId)
      .collection(subcollectionNames.ADDENDUM)
      .where('activityData.template', '==', 'check-in')
      .where('action', '==', httpsActions.create)
      .where('year', '==', 2019)
      .where('user', '==', phoneNumber);

    checkInAddendumPromises
      .push(checkInAddendumPromise.where('month', '==', 8).get());
    checkInAddendumPromises
      .push(checkInAddendumPromise.where('month', '==', 9).get());
  });

  const checkInSnaps = await Promise
    .all(checkInAddendumPromises);
  const allCheckInAddendumsSorted = [];

  checkInSnaps.forEach(snap => {
    snap.forEach(doc => {
      allCheckInAddendumsSorted.push(doc);
    });
  });

  allCheckInAddendumsSorted.sort((a, b) => {
    return a.get('timestamp') - b.get('timestamp');
  });

  // 1. weekly off, holiday true and attendance 1
  // 2.

  allCheckInAddendumsSorted
    .forEach(doc => {
      const { timestamp } = doc.data();
      const momentNow = momentTz(timestamp);
      const date = momentNow.date();
      const month = momentNow.month();
      const { location, distanceAccurate } = doc.data();

      if (locationValidationCheck === true
        && distanceAccurate === false) {
        return;
      }

      const obj = (() => {
        if (month === 8) {
          return attendanceDocDataSept;
        }

        return attendanceDocDataOct;
      })();

      obj
        .attendance = obj.attendance || {};
      obj
        .attendance[date] = obj.attendance[date] || getDefaultAttendanceObject();
      obj
        .attendance[date]
        .addendum = obj.attendance[date].addendum || [];
      obj
        .attendance[date]
        .addendum
        .push({
          timestamp,
          addendumId: doc.id,
          latitude: location.latitude || location._latitude,
          longitude: location.longitude || location._longitude,
        });

      const numberOfCheckIns = obj.attendance[date].addendum.length;
      const firstAddendum = obj.attendance[date].addendum[0];
      const lastAddendum = obj.attendance[date].addendum[numberOfCheckIns - 1];
      const hoursWorked = momentTz(lastAddendum.timestamp)
        .diff(momentTz(firstAddendum.timestamp), 'hours', true);

      obj
        .attendance[date]
        .working = obj.attendance[date].working || {};

      if (!obj.attendance[date].working.firstCheckInTimestamp) {
        obj
          .attendance[date]
          .working.firstCheckInTimestamp = timestamp;
      }

      obj
        .attendance[date]
        .working
        .numberOfCheckIns = numberOfCheckIns;
      obj
        .attendance[date]
        .working
        .lastCheckInTimestamp = timestamp;

      if (obj.attendance.attendance !== 1) {
        obj
          .attendance[date]
          .attendance = getStatusForDay({
            numberOfCheckIns,
            minimumDailyActivityCount,
            minimumWorkingHours,
            hoursWorked,
          });
      }

      if (obj.attendance[date].onLeave
        || obj.attendance[date].onAr
        || obj.attendance[date].weeklyOff
        || obj.attendance[date].holiday) {
        obj.attendance[date].attendance = 1;
      }
    });

  const leavesThisYear = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ACTIVITIES)
    .where('creator.phoneNumber', '==', latestPhoneNumber)
    .where('creationYear', '==', year)
    .where('template', '==', 'leave')
    .where('isCancelled', '==', false)
    .get();

  // leave and ar sort by relevntTime descrindg order
  // sept 1 start.

  leavesThisYear
    .forEach(leaveDoc => {
      const schedule = leaveDoc.get('schedule')[0];
      const momentStartTime = momentTz(schedule.startTime);
      const momentEndTime = momentTz(schedule.endTime);
      const leaveReason = leaveDoc.get('attachment.Reason.value');
      const leaveType = leaveDoc.get('attachment.Leave Type.value');
      const now = momentStartTime.clone();

      while (now.isSameOrBefore(momentEndTime)) {
        const leaveMonth = now.month();
        const leaveYear = now.year();
        const leaveDate = now.date();

        const obj = (() => {
          if (leaveMonth === 8) {
            return attendanceDocDataSept;
          }

          if (leaveMonth === 9) {
            return attendanceDocDataOct;
          }
        })();

        if (leaveYear === 2019 && obj) {
          obj
            .attendance = obj.attendance || {};
          obj
            .attendance[leaveDate] = obj.attendance[leaveDate] || getDefaultAttendanceObject();
          obj
            .attendance[leaveDate]
            .attendance = 1;
          obj
            .attendance[leaveDate]
            .onLeave = true;
          obj
            .attendance[leaveDate]
            .leave
            .leaveType = leaveType;
          obj
            .attendance[leaveDate]
            .leave
            .reason = leaveReason || '';
        }

        now
          .add(1, 'day');
      }
    });

  const arThisYear = await rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ACTIVITIES)
    .where('creator.phoneNumber', '==', latestPhoneNumber)
    .where('creationYear', '==', year)
    .where('template', '==', 'attendance regularization')
    .where('isCancelled', '==', false)
    .get();

  arThisYear
    .forEach(arDoc => {
      const arReason = arDoc.get('attachment.Reason.value');
      const schedule = arDoc.get('schedule')[0];
      const momentNow = momentTz(schedule.startTime);
      const arMonth = momentNow.month();
      const arYear = momentNow.year();
      const arDate = momentNow.date();

      if (arYear !== 2019) {
        return;
      }

      const obj = (() => {
        if (arMonth === 8) {
          return attendanceDocDataSept;
        }

        if (arMonth === 9) {
          return attendanceDocDataOct;
        }
      })();

      if (obj) {
        obj
          .attendance = obj.attendance || {};
        obj
          .attendance[arDate] = obj.attendance[arDate] || getDefaultAttendanceObject();
        obj
          .attendance[arDate]
          .attendance = 1;
        obj
          .attendance[arDate]
          .onAr = true;
        obj
          .attendance[arDate]
          .ar
          .reason = arReason;
      }
    });

  const septRef = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc();

  allDocsWrittenPaths
    .push(septRef.path);

  batch
    .set(septRef,
      attendanceDocDataSept
    );

  const octRef = rootCollections
    .offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .doc();

  allDocsWrittenPaths
    .push(octRef.path);

  batch
    .set(octRef,
      attendanceDocDataOct
    );

  if (uid) {
    [
      (attendanceDocDataSept.attendance || {}),
      (attendanceDocDataOct.attendance || {}),
    ].forEach((att, index) => {
      Object
        .keys(att)
        .forEach(date => {
          let month;

          if (index === 0) {
            month = 8;
          }

          if (index === 1) {
            month = 9;
          }

          const momentNow = momentTz()
            .date(date)
            .month(month)
            .year(year);

          const data = Object
            .assign({}, att[date], {
              month,
              year,
              office,
              officeId,
              date: Number(date),
              timestamp: Date.now(),
              id: `${date}${month}${year}${officeId}`,
              key: momentNow.clone().startOf('day').valueOf(),
              _type: addendumTypes.ATTENDANCE,
            });

          const updatesRef = rootCollections
            .updates
            .doc(uid)
            .collection(subcollectionNames.ADDENDUM)
            .doc();

          allDocsWrittenPaths
            .push(updatesRef.path);

          batch
            .set(updatesRef, data);
        });
    });
  }

  batch
    .set(snap.ref, {
      allDocsWrittenPaths,
      success: true,
      docsWritten: batch._ops.length,
      updatedAt: Date.now(),
    }, {
      merge: true,
    });

  return batch
    .commit();
};

module.exports = async snap => {
  try {
    return Creator(snap);
  } catch (error) {
    console.error({
      error,
      context: snap.ref.path,
    });
  }
};
