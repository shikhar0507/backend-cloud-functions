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

const { rootCollections, db } = require('../../../admin/admin');
const { getAuth } = require('../../../admin/utils');
const { auth } = require('firebase-admin');

/**
 * Cancels all the subscription activities where template's
 * canEditRule is ADMIN.
 *
 * @param {*} activityNew The activity document.
 */
const handleAdminCancellation = async activityNew => {
  // cancel subscriptions where templates' canEditRule is ADMIN
  const { officeId, attachment } = activityNew.data();
  const { value: phoneNumber } = attachment['Phone Number'];

  const usersSubscriptionDocs = await rootCollections.activities
    .where('template', '==', 'subscription')
    .where('attachment.Phone Number.value', '==', phoneNumber)
    .where('officeId', '==', officeId)
    .get();

  const batch = db.batch();
  const templateDocQueries = [];

  const activityIdMap = new Map();

  usersSubscriptionDocs.forEach(subscriptionActivity => {
    const { status } = subscriptionActivity.data();
    const { value: template } = subscriptionActivity.get('attachment.Template');

    /**
     * Activity is already cancelled, so no need to set the
     * `CANCELLED` status again.
     */
    if (status === 'CANCELLED') {
      return;
    }

    templateDocQueries.push(
      rootCollections.activityTemplates
        .where('name', '==', template)
        .limit(1)
        .get(),
    );

    activityIdMap.set(template, subscriptionActivity);
  });

  const templateSnaps = await Promise.all(templateDocQueries);

  templateSnaps.forEach(snap => {
    const [doc] = snap.docs;
    const { canEditRule, name: templateName } = doc.data();

    if (canEditRule !== 'ADMIN') {
      return;
    }

    const activityToCancel = activityIdMap.get(templateName);

    batch.set(
      activityToCancel.ref,
      {},
      {
        merge: true,
      },
    );
  });

  return batch.commit();
};

const adminHandler = async locals => {
  const { before: activityOld, after: activityNew } = locals.change;
  const { attachment, office } = activityNew.data();
  const { value: adminContact } = attachment['Phone Number'];
  const hasBeenCancelled =
    activityOld.data() &&
    activityOld.get('status') !== 'CANCELLED' &&
    activityNew.get('status') === 'CANCELLED';

  const userRecord = await getAuth(adminContact);

  if (!userRecord.uid) {
    return;
  }

  const customClaims = Object.assign({}, userRecord.customClaims);

  customClaims.admin = customClaims.admin || [];
  customClaims.admin.push(office);
  customClaims.admin = Array.from(new Set(customClaims.admin));

  if (hasBeenCancelled) {
    const index = customClaims.admin.indexOf(office);

    customClaims.admin = customClaims.admin.splice(index, 1);

    await handleAdminCancellation(activityNew);
  }

  return auth().setCustomUserClaims(userRecord.uid, customClaims);
};

module.exports = adminHandler;
