/**
 * Copyright (c) 2020 GrowthFile
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
const { db, rootCollections } = require('../../../admin/admin');
const { addendumCreator } = require('../../activity/helper');
const {
  httpsActions,
  subcollectionNames,
} = require('../../../admin/constants');
const grantSubscription = require('./grantSubscription');
const momentTz = require('moment-timezone');

const templatesToGrant = {
  share_link: ['check-in', 'call'],
};

const getPotentialSameDevices = async ({ phoneNumber, uid }) => {
  const { docs: checkinDocs } = await rootCollections.activities
    .where('attachment.Phone Number.value', '==', phoneNumber)
    .where('status', '==', 'CONFIRMED')
    .where('template', '==', 'check-in')
    .get();
  const offices = [];
  checkinDocs.forEach(checkin => {
    offices.push(checkin.get('office'));
  });
  const result = {};
  const { latestDeviceId = null } =
    (await rootCollections.updates.doc(uid).get()).data() || {};

  if (!latestDeviceId) {
    return {};
  }

  const rolePromises = [];

  (
    await rootCollections.updates
      .where('deviceIdsArray', 'array-contains', latestDeviceId)
      .get()
  ).forEach(updatesDoc => {
    // check-in template document in subscription has the role
    offices.forEach(office => {
      rolePromises.push(
        rootCollections.profiles
          .doc(updatesDoc.get('phoneNumber'))
          .collection(subcollectionNames.SUBSCRIPTIONS)
          .where('template', '==', 'check-in')
          .where('office', '==', office)
          .limit(1)
          .get(),
      );
    });
  });

  (await Promise.all(rolePromises)).forEach(({ docs: [doc] }) => {
    console.log('rolePromises', doc);

    if (!doc) {
      return;
    }

    const { roleDoc = null, office } = doc.data();

    const phoneNumberInRole =
      roleDoc &&
      roleDoc.attachment &&
      roleDoc.attachment['Phone Number'] &&
      roleDoc.attachment['Phone Number'].value;

    if (!phoneNumberInRole || phoneNumberInRole === phoneNumber) {
      return;
    }

    result[office] = result[office] || [];
    result[office].push(phoneNumberInRole);
  });

  return result;
};

const createAddendum = async ({ office, conn }) => {
  const {
    docs: [officeDoc],
  } = await rootCollections.offices.where('office', '==', office).get();
  const timezone = officeDoc.get('Timezone') || 'Asia/Kolkata';
  const { date, months: month, years: year } = momentTz()
    .tz(timezone)
    .toObject();
  const addendumRef = rootCollections.offices
    .doc(officeDoc.id)
    .collection(subcollectionNames.ADDENDUM)
    .doc();
  const addendum = addendumCreator(
    {
      ms_timestamp: Date.now(),
      ms_month: month,
      ms_date: date,
      ms_year: year,
      ms_action: httpsActions.signup,
    },
    {
      ms_displayName: conn.requester.displayName,
      ms_phoneNumber: conn.requester.phoneNumber,
      ms_email: conn.requester.email,
      ms_displayUrl: conn.requester.photoURL,
      ms_isSupportRequest: false,
      ms_potentialSameUsers: await getPotentialSameDevices({
        phoneNumber: conn.requester.phoneNumber,
        uid: conn.requester.uid,
      }),
    },
    {},
    {
      ms_template: '',
      ms_name: '',
      ms_lat: '',
      ms_long: '',
      ms_url: '',
      ms_route: '',
      ms_locality: '',
      ms_adminstrative_area_level_2: '',
      ms_adminstrative_area_level_1: '',
      ms_country: '',
      ms_postalCode: '',
    },
    0.0,
    '',
    {},
  );
  const batch = db.batch();
  batch.set(addendumRef, addendum);
  return batch.commit();
};

module.exports = async function (conn, campaign) {
  if (templatesToGrant.hasOwnProperty(campaign)) {
    if (templatesToGrant[campaign].length > 0) {
      await createAddendum({ office: conn.req.body.office, conn });
    }
    return Promise.all(
      templatesToGrant[campaign].map(template =>
        grantSubscription(conn, template),
      ),
    );
  } else {
    return false;
  }
};
