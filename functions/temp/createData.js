'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const {
  getNumbersbetween,
} = require('../admin/utils');
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


const Creator = async snap => {
  const batch = db.batch();
  const year = 2019;
  const {
    uid,
    branchDoc,
    employeeDoc,
  } = snap.data();

  const phoneNumber = employeeDoc
    .attachment['Employee Contact']
    .value;

  if (!uid) {
    console.log('Skipping. No uid', phoneNumber);

    return;
  }

  const docPaths = [];
  const office = employeeDoc.office;
  const officeId = employeeDoc.officeId;
  const attendanceDoc9 = (await rootCollections
    .offices
    .doc(officeId)
    .collection('Attendances')
    .where('month', '==', 9)
    .where('phoneNumber', '==', phoneNumber)
    .limit(1)
    .get())
    .docs[0];
  const attendanceDoc10 = (await rootCollections
    .offices
    .doc(officeId)
    .collection('Attendances')
    .where('month', '==', 10)
    .where('phoneNumber', '==', phoneNumber)
    .limit(1)
    .get())
    .docs[0];

  const ref9th = attendanceDoc9 ? attendanceDoc9.ref : rootCollections
    .offices
    .doc(officeId)
    .collection('Attendances')
    .doc();
  const ref10th = attendanceDoc10 ? attendanceDoc10.ref : rootCollections
    .offices
    .doc(officeId)
    .collection('Attendances')
    .doc();

  const attendanceDoc9Data = attendanceDoc9 ? attendanceDoc9.data() : {};
  const attendanceDoc10Data = attendanceDoc10 ? attendanceDoc10.data() : {};
  const datesIn9thMonth = getNumbersbetween(
    1,
    momentTz().month(9).year(year).daysInMonth() + 1
  );
  const datesIn10thMonth = getNumbersbetween(
    1,
    momentTz().month(10).year(year).daysInMonth() + 1
  );

  if (Object.keys(branchDoc).length > 0) {
    console.log('in branch holiday/weekday logic');

    const holidays = (branchDoc.schedule || []);
    const weeklyOffWeekday = branchDoc.attachment['Weekly Off'].value;

    datesIn9thMonth.forEach(date => {
      const month = 9;

      if (!weeklyOffWeekday) {
        return;
      }

      attendanceDoc9Data
        .attendance = attendanceDoc9Data.attendance || {};

      attendanceDoc9Data
        .attendance[
        date
      ] = attendanceDoc9Data.attendance[date] || getDefaultAttendanceObject();

      const weekdayName = momentTz()
        .date(date)
        .month(month)
        .year(2019)
        .format('dddd')
        .toLowerCase();

      if (weeklyOffWeekday === weekdayName) {
        attendanceDoc9Data
          .attendance[
          date
        ].weeklyOff = true;

        attendanceDoc9Data
          .attendance[
          date
        ].attendance = 1;
      }
    });

    datesIn10thMonth
      .forEach(date => {
        const month = 10;

        if (!weeklyOffWeekday) {
          return;
        }

        attendanceDoc10Data
          .attendance = attendanceDoc10Data.attendance || {};

        attendanceDoc10Data
          .attendance[
          date
        ] = attendanceDoc10Data.attendance[date] || getDefaultAttendanceObject();

        const weekdayName = momentTz()
          .date(date)
          .month(month)
          .year(2019)
          .format('dddd')
          .toLowerCase();

        if (weeklyOffWeekday === weekdayName) {
          attendanceDoc10Data
            .attendance[
            date
          ].weeklyOff = true;

          console.log(month, 'wo', weekdayName, momentTz()
            .date(date)
            .month(month)
            .year(2019)
            .format('LLL'));

          attendanceDoc10Data
            .attendance[
            date
          ].attendance = 1;
        }
      });

    holidays
      .forEach(holiday => {
        const { startTime } = holiday;

        if (!Number.isInteger(startTime)) {
          return;
        }

        const momentInstance = momentTz(startTime);
        const holidayDate = momentInstance.date();
        const holidayMonth = momentInstance.month();
        const holidayYear = momentInstance.year();

        if (holidayMonth === 9
          && holidayYear === 2019) {
          // update attendance doc with attendance 1 and holiday = true
          // create doc in updates

          attendanceDoc9Data
            .attendance = attendanceDoc9Data.attendance || {};

          attendanceDoc9Data
            .attendance[
            holidayDate
          ] = attendanceDoc9Data.attendance[holidayDate] || getDefaultAttendanceObject();

          attendanceDoc9Data
            .attendance[
            holidayDate
          ].holiday = true;

          attendanceDoc9Data
            .attendance[
            holidayDate
          ].attendance = 1;
        }

        if (holidayMonth === 10
          && holidayYear === 2019) {
          // update attendance doc with attendance 1 and holiday = true
          // create doc in updates

          attendanceDoc10Data
            .attendance = attendanceDoc10Data.attendance || {};

          attendanceDoc10Data
            .attendance[holidayDate] = attendanceDoc10Data
              .attendance[holidayDate] || getDefaultAttendanceObject();

          attendanceDoc10Data
            .attendance[
            holidayDate
          ].holiday = true;

          attendanceDoc10Data
            .attendance[
            holidayDate
          ].attendance = 1;
        }
      });
  }

  datesIn9thMonth
    .forEach(date => {
      attendanceDoc9Data
        .attendance = attendanceDoc9Data.attendance || {};

      attendanceDoc9Data
        .attendance[date] = attendanceDoc9Data
          .attendance[date] || getDefaultAttendanceObject();
      const addendumArr = attendanceDoc9Data.attendance[date].addendum || [];

      if (attendanceDoc9Data.attendance[date].attendance === 1) {
        return;
      }

      if (addendumArr.length > 0) {
        // console.log('writing attendance', date, 9);
        const first = addendumArr[0];
        const last = addendumArr[addendumArr.length - 1];
        const hoursWorked = momentTz(last).diff(momentTz(first), 'hours', true);

        attendanceDoc9Data
          .attendance[date]
          .attendance = getStatusForDay({
            hoursWorked,
            numberOfCheckIns: addendumArr.length,
            minimumDailyActivityCount: employeeDoc.attachment['Minimum Daily Activity Count'].value,
            minimumWorkingHours: employeeDoc.attachment['Minimum Working Hours'].value,
          });
      }
    });

  datesIn10thMonth.forEach(date => {
    attendanceDoc10Data
      .attendance = attendanceDoc10Data.attendance || {};

    attendanceDoc10Data
      .attendance[date] = attendanceDoc10Data
        .attendance[date] || getDefaultAttendanceObject();
    const addendumArr = attendanceDoc10Data.attendance[date].addendum || [];

    if (attendanceDoc10Data.attendance[date].attendance === 1) {
      return;
    }

    if (addendumArr.length > 0) {
      const first = addendumArr[0];
      const last = addendumArr[addendumArr.length - 1];
      const hoursWorked = momentTz(last).diff(momentTz(first), 'hours', true);

      attendanceDoc10Data
        .attendance[date]
        .attendance = getStatusForDay({
          hoursWorked,
          numberOfCheckIns: addendumArr.length,
          minimumDailyActivityCount: employeeDoc.attachment['Minimum Daily Activity Count'].value,
          minimumWorkingHours: employeeDoc.attachment['Minimum Working Hours'].value,
        });
    }
  });

  docPaths
    .push(ref9th.path);
  docPaths
    .push(ref10th.path);

  batch
    .set(ref9th, attendanceDoc9Data, { merge: true });
  batch
    .set(ref10th, attendanceDoc10Data, { merge: true });

  datesIn9thMonth.forEach(date => {
    const month = 9;
    const u = rootCollections
      .updates
      .doc(uid)
      .collection('Addendum')
      .doc();

    docPaths
      .push(u.path);

    batch
      .set(u, Object.assign({}, {
        date,
        month,
        year,
        office,
        officeId,
        timestamp: Date.now(),
        _type: 'attendance',
        id: `${date}${month}${year}${officeId}`,
        key: momentTz().date(date).month(month).year(year).startOf('day').valueOf(),
      }, attendanceDoc9Data.attendance[date]), {
        merge: true,
      });
  });

  datesIn10thMonth.forEach(date => {
    const month = 10;
    const u = rootCollections
      .updates
      .doc(uid)
      .collection('Addendum')
      .doc();

    docPaths
      .push(u.path);

    const o = Object.assign({}, {
      date,
      month,
      year,
      office,
      officeId,
      _type: 'attendance',
      timestamp: Date.now(),
      id: `${date}${month}${year}${officeId}`,
      key: momentTz().date(date).month(month).year(year).startOf('day').valueOf(),
    }, attendanceDoc10Data.attendance[date]);

    docPaths
      .push(u.path);

    batch
      .set(u, o, {
        merge: true,
      });
  });

  batch
    .set(snap.ref, {
      docPaths,
      numberOfDocsTouched: docPaths.length + 1,
      timestamp: Date.now(),
      successful: true,
    }, {
      merge: true,
    });

  console.log('batch =>', batch._ops.length);

  await batch
    .commit();

  return;
};

module.exports = async snap => {
  try {
    return Creator(snap);
  } catch (error) {
    await snap
      .ref
      .set({
        failed: true,
      }, {
        merge: true,
      });

    console.error({
      error,
      context: snap.ref.path,
    });
  }
};
