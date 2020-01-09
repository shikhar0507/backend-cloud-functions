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

const {rootCollections, db} = require('../../admin/admin');
const {
  subcollectionNames,
  dateFormats,
  addendumTypes,
  reimbursementsFrequencies,
} = require('../../admin/constants');
const momentTz = require('moment-timezone');
const Dinero = require('dinero.js');

const getBeneficiaryId = async ({roleDoc, officeId, phoneNumber}) => {
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
    const {template} = doc.data();

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

  if (checkInSubscription) {
    return checkInSubscription.id;
  }

  const {
    docs: [reimbursementTemplateSubscription],
  } = await rootCollections.profiles
    .doc(phoneNumber)
    .collection(subcollectionNames.SUBSCRIPTIONS)
    .where('report', '==', 'reimbursement')
    .where('officeId', '==', officeId)
    .limit(1)
    .get();

  if (reimbursementTemplateSubscription) {
    return reimbursementTemplateSubscription.id;
  }

  return null;
};

const getDefaultVoucher = ({
  beneficiaryId,
  office,
  officeId,
  cycleStart,
  cycleEnd,
  amount = 0,
}) => ({
  beneficiaryId,
  office,
  officeId,
  amount,
  cycleStart,
  cycleEnd,
  batchId: null,
});

const getIterator = ({reimbursementFrequency, date, month, year}) => {
  const momentInstance = momentTz()
    .date(date)
    .month(month)
    .year(year);
  const isBimonthly =
    reimbursementFrequency === reimbursementsFrequencies.BI_MONTHLY;

  return {
    start: (() => {
      if (isBimonthly) {
        return momentInstance.clone().date(1);
      }

      return momentInstance.clone().startOf('month');
    })(),
    end: (() => {
      if (isBimonthly) {
        return momentInstance.clone().date(15);
      }

      return momentInstance.clone().endOf('month');
    })(),
  };
};

const getCycleDates = ({reimbursementFrequency, date, month, year}) => {
  const {end: iteratorEnd, start: iteratorStart} = getIterator({
    reimbursementFrequency,
    date,
    month,
    year,
  });

  // Default is 1st of the month
  const result = [iteratorStart.format(dateFormats.DATE)];

  if (
    reimbursementFrequency === reimbursementsFrequencies.BI_MONTHLY &&
    date > 15
  ) {
    result[0] = momentTz()
      .date(16)
      .month(month)
      .year(year)
      .format(dateFormats.DATE);
  }

  result[1] = iteratorEnd.format(dateFormats.DATE);

  return result;
};

const reimbursementHandler = async (change, context) => {
  const {officeId} = context.params;
  const {
    after: reimbursementDocNewState,
    before: reimbursementDocOldState,
  } = change;
  const batch = db.batch();
  const {
    date,
    currency = 'INR',
    month,
    year,
    phoneNumber,
    roleDoc,
    office,
    claimId,
    status,
    amount: newAmount,
  } = reimbursementDocNewState.data();
  const {amount: oldAmount = 0} = reimbursementDocOldState.data() || {};

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

  console.log('officeDoc', officeDoc);
  console.log('beneficiaryId', beneficiaryId);

  // This case should currently never happen because
  // user will have at least one role.
  // the fallback is check-in subscription activityId
  if (!beneficiaryId) {
    return;
  }

  const reimbursementFrequency =
    officeDoc.get('attachment.Reimbursement Frequency.value') ||
    reimbursementsFrequencies.MONTHLY;

  const cycleDates = getCycleDates({
    reimbursementFrequency,
    date,
    month,
    year,
  });

  const [cycleStart] = cycleDates;
  const cycleEnd = cycleDates[cycleDates.length - 1];

  const {
    docs: [firstVoucherDoc],
  } = await rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.VOUCHERS)
    .where('cycleStart', '==', cycleStart)
    .where('cycleEnd', '==', cycleEnd)
    .where('beneficiaryId', '==', beneficiaryId)
    .where('type', '==', addendumTypes.REIMBURSEMENT)
    .where('batchId', '==', null)
    .limit(1)
    .get();

  const ref = firstVoucherDoc
    ? firstVoucherDoc.ref
    : rootCollections.offices
        .doc(officeId)
        .collection(subcollectionNames.VOUCHERS)
        .doc();
  const data = firstVoucherDoc
    ? firstVoucherDoc.data()
    : getDefaultVoucher({
        office,
        officeId,
        beneficiaryId,
        cycleStart,
        cycleEnd,
      });

  console.log('ref', ref.path);

  data.linkedReimbursements = data.linkedReimbursements || [];
  data.linkedReimbursements.push(change.after.id);

  const amount = (() => {
    if (!firstVoucherDoc) {
      // doc will be created in this instance
      return Dinero({
        currency,
        amount: Number(newAmount),
      }).getAmount();
    }

    if (claimId && status === 'CANCELLED') {
      return Dinero({
        currency,
        amount: Number(data.amount),
      })
        .subtract(
          Dinero({
            currency,
            amount: Number(newAmount),
          }),
        )
        .getAmount();
    }

    const diff = Dinero({
      currency,
      amount: Number(newAmount),
    }).subtract(
      Dinero({
        currency,
        amount: Number(oldAmount),
      }),
    );

    return Dinero({
      currency,
      amount: Number(data.amount),
    })
      .add(diff)
      .getAmount();
  })();

  batch.set(
    ref,
    Object.assign({}, data, {
      office,
      officeId,
      beneficiaryId,
      cycleStart,
      cycleEnd,
      amount: `${Number(data.amount) + Number(amount)}`,
      batchId: data.batchId || null,
      type: addendumTypes.REIMBURSEMENT,
      timestamp: Date.now(),
    }),
    {merge: true},
  );

  return batch.commit();
};

module.exports = async (change, context) => {
  try {
    return reimbursementHandler(change, context);
  } catch (error) {
    console.error(error);
  }
};
