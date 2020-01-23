/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const { db, rootCollections } = require('../../admin/admin');
const { getNumbersbetween } = require('../../admin/utils');
const {
  addendumTypes,
  subcollectionNames,
  dateFormats,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');

const getBeneficiaryId = async ({ roleDoc, officeId, phoneNumber }) => {
  if (roleDoc && roleDoc.id) {
    return roleDoc.id;
  }

  const [newRole] = (
    await rootCollections.activities
      .where('officeId', '==', officeId)
      .where('status', '==', 'CONFIRMED')
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .get()
  ).docs.filter(doc => {
    const { template } = doc.data();

    return template !== 'admin' && template !== 'subscription';
  });

  if (newRole) {
    return newRole.id;
  }

  // query checkIn subscription doc
  // use that activityId as the role
  const {
    docs: [checkInSubscription],
  } = await rootCollections.activities
    .where('template', '==', 'subscription')
    .where('attachment.Template.value', '==', 'check-in')
    .where('officeId', '==', officeId)
    .where('attachment.Phone Number.value', '==', phoneNumber)
    .limit(1)
    .get();

  return checkInSubscription ? checkInSubscription.id : null;
};

const getCycle = ({ firstDayOfMonthlyCycle, month, year }) => {
  // fdmc =>first day of monthly cycle
  // if fdmc = 1 => start = 1; end = month end.
  // if fdmc !== 1 => start = fdmc; end = (fdmc + 1) in next month

  if (firstDayOfMonthlyCycle === 1) {
    const cycleStart = momentTz()
      .month(month)
      .year(year)
      .date(1);

    return {
      cycleStart: cycleStart.format(dateFormats.DATE),
      cycleEnd: cycleStart
        .clone()
        .endOf('month')
        .format(dateFormats.DATE),
    };
  }

  const cycleStart = momentTz()
    .date(firstDayOfMonthlyCycle)
    .month(month)
    .year(year);

  return {
    cycleStart: cycleStart.format(dateFormats.DATE),
    cycleEnd: cycleStart
      .clone()
      .add(1, 'months')
      .date(firstDayOfMonthlyCycle - 1)
      .format(dateFormats.DATE),
  };
};

const getPreviousMonthAttendance = async ({
  fetchPreviousMonthDocs,
  officeId,
  month,
  year,
  beneficiaryId,
}) => {
  if (!fetchPreviousMonthDocs) {
    return {};
  }

  const {
    docs: [attendanceDoc],
  } = await rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.ATTENDANCES)
    .where('month', '==', month)
    .where('year', '==', year)
    .where('roleDoc.id', '==', beneficiaryId)
    .limit(1)
    .get();

  return attendanceDoc ? attendanceDoc.get('attendance') || {} : {};
};

const attendanceHandler = async ({ doc, officeId }) => {
  const batch = db.batch();
  const {
    phoneNumber,
    roleDoc,
    month,
    year,
    attendance: attendanceInCurrentMonth,
  } = doc.data();
  const momentCurrMonth = momentTz()
    .month(month)
    .year(year);
  const momentPrevMonth = momentCurrMonth.clone().subtract(1, 'months');
  const [beneficiaryId, officeDoc] = await Promise.all([
    getBeneficiaryId({
      phoneNumber,
      /**
       * There will be docs where roleDoc is `null`/`undefined`
       */
      roleDoc,
      /**
       * Some old docs might not have `officeId`.
       * Don't wanna take the risk of crashes.
       */
      officeId,
    }),
    rootCollections.offices.doc(officeId).get(),
  ]);

  const firstDayOfMonthlyCycle =
    officeDoc.get('attachment.First Day Of Monthly Cycle.value') || 1;

  const { cycleStart, cycleEnd } = getCycle({
    firstDayOfMonthlyCycle,
    month,
    year,
  });
  const {
    docs: [firstVoucherDoc],
  } = await rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.VOUCHERS)
    .where('cycleStart', '==', cycleStart)
    .where('cycleEnd', '==', cycleEnd)
    .where('beneficiaryId', '==', beneficiaryId)
    .where('type', '==', addendumTypes.ATTENDANCE)
    .where('batchId', '==', null)
    .limit(1)
    .get();
  const fetchPreviousMonthDocs = firstDayOfMonthlyCycle !== 1;
  const firstRange = (() => {
    if (fetchPreviousMonthDocs) {
      return getNumbersbetween(
        firstDayOfMonthlyCycle,
        momentPrevMonth
          .clone()
          .endOf('month')
          .date() + 1,
      );
    }

    return [];
  })();
  const secondRange = getNumbersbetween(
    fetchPreviousMonthDocs ? 1 : firstDayOfMonthlyCycle,
    momentCurrMonth.clone().date() + 1,
  );
  const attendanceInPreviousMonth = await getPreviousMonthAttendance({
    fetchPreviousMonthDocs,
    beneficiaryId,
    officeId,
    month: momentPrevMonth.month(),
    year: momentPrevMonth.year(),
  });

  const attendanceCount =
    firstRange.reduce((prevSum, date) => {
      const { attendance = 0 } = attendanceInPreviousMonth[date] || {};

      return prevSum + attendance;
    }, 0) +
    secondRange.reduce((prevSum, date) => {
      const { attendance = 0 } = attendanceInCurrentMonth[date] || {};

      return prevSum + attendance;
    }, 0);

  const ref = firstVoucherDoc
    ? firstVoucherDoc.ref
    : officeDoc.ref.collection(subcollectionNames.VOUCHERS).doc();
  const data = firstVoucherDoc ? firstVoucherDoc.data() : {};

  batch.set(
    ref,
    Object.assign({}, data, {
      attendanceCount,
      cycleStart,
      cycleEnd,
      beneficiaryId,
      type: addendumTypes.ATTENDANCE,
      batchId: null,
      createdAt: data.createdAt || Date.now(),
      updatedAt: Date.now(),
    }),
    {
      merge: true,
    },
  );

  return batch.commit();
};

module.exports = async ({ after: doc }, { params: { officeId } }) => {
  try {
    return attendanceHandler({ doc, officeId });
  } catch (error) {
    console.error(error);
  }
};
