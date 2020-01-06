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
const {subcollectionNames} = require('../../admin/constants');

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
  const [checkInSubscription] = (
    await rootCollections.activities
      .where('template', '==', 'subscription')
      .where('attachment.Template.value', '==', 'check-in')
      .where('officeId', '==', officeId)
      .where('attachment.Phone Number.value', '==', phoneNumber)
      .limit(1)
      .get()
  ).docs;

  return checkInSubscription ? checkInSubscription.id : null;
};

const getDefaultVoucher = () => {};

const reimbursementHandler = async (doc, context) => {
  const batch = db.batch();
  const {date, month, year, phoneNumber, roleDoc, officeId} = doc.data();
  const [beneficiaryId, officeDoc] = await Promise.all([
    getBeneficiaryId({
      // There will be docs where roleDoc is null/undefined
      roleDoc,
      // Some old docs might not have officeId. Don't wanna
      // take the risk of crashes.
      officeId: officeId ? officeId : context.params.officeId,
      phoneNumber,
    }),
    rootCollections.offices.doc(officeId).get(),
  ]);

  console.log('officeDoc', officeDoc);
  console.log('beneficiaryId', beneficiaryId);

  if (!beneficiaryId) {
    return;
  }

  const voucherDocs = await rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.VOUCHERS)
    .where('beneficiaryId', '==', beneficiaryId)
    .get();

  console.log(voucherDocs);
  const [firstVoucherDoc] = voucherDocs.docs;

  voucherDocs.docs.forEach((doc, index) => {
    if (index === 0) {
      return;
    }

    batch.delete(doc.ref);
  });

  const ref = firstVoucherDoc
    ? firstVoucherDoc.ref
    : rootCollections.offices
        .doc(officeId)
        .collection(subcollectionNames.VOUCHERS)
        .doc();
  const data = firstVoucherDoc ? firstVoucherDoc.data() : getDefaultVoucher();

  batch.set(ref, data, {merge: true});

  return batch.commit();
};

module.exports = async (doc, context) => {
  try {
    return reimbursementHandler(doc, context);
  } catch (error) {
    console.error(error);
  }
};
