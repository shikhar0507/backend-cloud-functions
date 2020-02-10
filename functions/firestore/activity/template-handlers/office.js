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

const crypto = require('crypto');
const { db, rootCollections } = require('../../../admin/admin');
const { activityName, createAutoSubscription } = require('../helper');
const {
  slugify,
  getAuth,
  getBranchName,
  adjustedGeopoint,
  millitaryToHourMinutes,
} = require('../../../admin/utils');
const {
  reportNames,
  httpsActions,
  subcollectionNames,
} = require('../../../admin/constants');
const { createVirtualAccount } = require('../../../cash-free/autocollect');
const env = require('../../../admin/env');
const admin = require('firebase-admin');
const momentTz = require('moment-timezone');
const googleMapsClient = require('@google/maps').createClient({
  key: env.mapsApiKey,
  Promise: Promise,
});

const isActivityCreated = change =>
  !change.before.data() && change.after.data();

const replaceInvalidCharsInOfficeName = office => {
  let result = office.toLowerCase();

  const mostCommonTlds = new Set([
    'com',
    'in',
    'co.in',
    'net',
    'org',
    'gov',
    'uk',
  ]);

  mostCommonTlds.forEach(tld => {
    if (!result.endsWith(`.${tld}`)) {
      return;
    }

    result = result.replace(`.${tld}`, '');
  });

  return result
    .replace('.', '')
    .replace(',', '')
    .replace('(', '')
    .replace(')', '')
    .replace('ltd', '')
    .replace('limited', '')
    .replace('pvt', '')
    .replace('private', '')
    .trim();
};

/** Uses autocomplete api for predictions */
const getPlaceIds = async office => {
  const result = await googleMapsClient
    .placesAutoComplete({
      input: office,
      sessiontoken: crypto.randomBytes(64).toString('hex'),
      components: {
        country: 'in',
      },
    })
    .asPromise();

  return result.json.predictions.map(prediction => prediction.place_id);
};

const getFullBranchActivity = async placeid => {
  const result = await googleMapsClient
    .place({
      placeid,
      fields: [
        'address_component',
        'adr_address',
        'formatted_address',
        'geometry',
        'name',
        'permanently_closed',
        'place_id',
        'type',
        'vicinity',
        'international_phone_number',
        'opening_hours',
        'website',
      ],
    })
    .asPromise();

  const { address_components: addressComponents } = result.json.result;

  const branchName = getBranchName(addressComponents);
  const branchOffice = {
    placeId: result.json.result['place_id'],
    venueDescriptor: 'Branch Office',
    address: result.json.result['formatted_address'],
    location: branchName,
    geopoint: new admin.firestore.GeoPoint(
      result.json.result.geometry.location.lat,
      result.json.result.geometry.location.lng,
    ),
  };

  const weekdayStartTime = (() => {
    const openingHours = result.json.result['opening_hours'];

    if (!openingHours) {
      return '';
    }

    const periods = openingHours.periods;

    const [relevantObject] = periods.filter(item => {
      return item.close && item.close.day === 1;
    });

    if (!relevantObject) {
      return '';
    }

    return relevantObject.open.time;
  })();

  const weekdayEndTime = (() => {
    const openingHours = result.json.result['opening_hours'];

    if (!openingHours) {
      return '';
    }

    const [relevantObject] = openingHours.periods.filter(item => {
      return item.close && item.close.day === 1;
    });

    if (!relevantObject) {
      return '';
    }

    return relevantObject.close.time;
  })();

  const saturdayStartTime = (() => {
    const openingHours = result.json.result['opening_hours'];

    if (!openingHours) {
      return '';
    }

    const [relevantObject] = openingHours.periods.filter(
      item => item.open && item.open.day === 6,
    );

    if (!relevantObject) {
      return '';
    }

    return relevantObject.open.time;
  })();

  const saturdayEndTime = (() => {
    const openingHours = result.json.result['opening_hours'];

    if (!openingHours) {
      return '';
    }

    const [relevantObject] = openingHours.periods.filter(
      item => item.open && item.open.day === 6,
    );

    if (!relevantObject) {
      return '';
    }

    return relevantObject.close.time;
  })();

  const weeklyOff = (() => {
    const openingHours = result.json.result['opening_hours'];

    if (!openingHours) {
      return '';
    }

    const weekdayText = openingHours['weekday_text'];

    if (!weekdayText) {
      return '';
    }

    const [closedWeekday] = weekdayText
      // ['Sunday: Closed']
      .filter(str => str.includes('Closed'));

    if (!closedWeekday) {
      return '';
    }

    const [part] = closedWeekday.split(':');

    if (!part) {
      return '';
    }

    // ['Sunday' 'Closed']
    return part.toLowerCase();
  })();

  const schedulesArray = Array.from(Array(15)).map((_, index) => {
    return {
      name: `Holiday ${index + 1}`,
      startTime: '',
      endTime: '',
    };
  });

  const activityObject = {
    // All assignees from office creation instance
    venue: [branchOffice],
    placeId: placeid,
    schedule: schedulesArray,
    attachment: {
      Name: {
        value: branchName,
        type: 'string',
      },
      'First Contact': {
        value: '',
        type: 'phoneNumber',
      },
      'Second Contact': {
        value: '',
        type: 'phoneNumber',
      },
      'Branch Code': {
        value: '',
        type: 'string',
      },
      'Weekday Start Time': {
        value: millitaryToHourMinutes(weekdayStartTime),
        type: 'HH:MM',
      },
      'Weekday End Time': {
        value: millitaryToHourMinutes(weekdayEndTime),
        type: 'HH:MM',
      },
      'Saturday Start Time': {
        value: millitaryToHourMinutes(saturdayStartTime),
        type: 'HH:MM',
      },
      'Saturday End Time': {
        value: millitaryToHourMinutes(saturdayEndTime),
        type: 'HH:MM',
      },
      'Weekly Off': {
        value: weeklyOff,
        type: 'weekday',
      },
    },
  };

  return activityObject;
};

const createAutoBranch = (branchData, locals, branchTemplateDoc) => {
  const batch = db.batch();
  const { officeId } = locals.change.after.data();
  const addendumDocRef = rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  const activityRef = rootCollections.activities.doc();
  const gp = adjustedGeopoint(branchData.venue[0].geopoint);

  const activityData = {
    officeId,
    placeId: branchData.placeId,
    addendumDocRef,
    template: 'branch',
    status: branchTemplateDoc.get('statusOnCreate'),
    hidden: branchTemplateDoc.get('hidden'),
    createTimestamp: Date.now(),
    schedule: branchData.schedule,
    venue: branchData.venue,
    attachment: branchData.attachment,
    canEditRule: branchTemplateDoc.get('canEditRule'),
    timezone: locals.change.after.get('timezone'),
    timestamp: Date.now(),
    office: locals.change.after.get('office'),
    activityName: activityName({
      attachmentObject: branchData.attachment,
      templateName: 'branch',
      requester: locals.change.after.get('creator'),
    }),
    adjustedGeopoints: `${gp.latitude},${gp.longitude}`,
    creator: locals.change.after.get('creator'),
  };

  const addendumDocData = {
    activityData,
    timestamp: Date.now(),
    timezone: locals.change.after.get('timezone'),
    user: locals.change.after.get('creator.phoneNumber'),
    userDisplayName: locals.change.after.get('creator.displayName'),
    action: httpsActions.create,
    template: activityData.template,
    userDeviceTimestamp: locals.addendumDoc.get('userDeviceTimestamp'),
    activityId: activityRef.id,
    activityName: activityData.activityName,
    isSupportRequest: locals.addendumDoc.get('isSupportRequest'),
    geopointAccuracy: locals.addendumDoc.get('geopointAccuracy'),
    provider: locals.addendumDoc.get('provider'),
    location: locals.addendumDoc.get('location'),
  };

  locals.assigneePhoneNumbersArray.forEach(phoneNumber => {
    batch.set(
      activityRef.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber),
      {
        addToInclude: false,
      },
    );
  });

  batch.set(activityRef, activityData);

  batch.set(addendumDocRef, addendumDocData);

  return batch.commit();
};

const createBranches = async locals => {
  const { office } = locals.change.after.data();

  if (!isActivityCreated(locals.change)) {
    return;
  }

  let failureCount = 0;

  const getBranchBodies = async office => {
    return getPlaceIds(office).then(ids => {
      const promises = [];

      if (ids.length === 0) {
        failureCount++;

        if (failureCount > 1) {
          // Has failed once with the actual office name
          // and 2nd time even by replacing invalid chars
          // Give up.

          return Promise.all(promises);
        }

        const filteredOfficeName = replaceInvalidCharsInOfficeName(office);

        return getBranchBodies(filteredOfficeName);
      }

      ids.forEach(id => {
        promises.push(getFullBranchActivity(id));
      });

      return Promise.all(promises);
    });
  };

  return Promise.all([
    getBranchBodies(office),
    rootCollections.activityTemplates
      .where('name', '==', 'branch')
      .limit(1)
      .get(),
  ]).then(result => {
    const [branches, templateQuery] = result;

    const [templateDoc] = templateQuery.docs;
    const promises = [];

    branches.forEach(branch => {
      promises.push(createAutoBranch(branch, locals, templateDoc));
    });

    return Promise.all(promises);
  });
};

const cancelAdmin = async (officeId, phoneNumber) => {
  const {
    docs: [doc],
  } = await rootCollections.activities
    .where('officeId', '==', officeId)
    .where('template', '==', 'admin')
    .where('attachment.Phone Number.value', '==', phoneNumber)
    .get();

  if (!doc || doc.get('status') === 'CANCELLED') {
    return;
  }

  return doc.ref.set(
    {
      timestamp: Date.now(),
      addendumDocRef: null,
      status: 'CANCELLED',
    },
    { merge: true },
  );
};

const createFootprintsRecipient = async locals => {
  const batch = db.batch();
  const template = 'recipient';
  const { id: officeId } = locals.change.after;
  const activityRef = rootCollections.activities.doc();
  const addendumDocRef = rootCollections.offices
    .doc(officeId)
    .collection(subcollectionNames.ADDENDUM)
    .doc();

  const [
    {
      docs: [recipientTemplate],
    },
    {
      docs: [footprintsRecipientActivity],
    },
  ] = await Promise.all([
    rootCollections.activityTemplates
      .where('name', '==', template)
      .limit(1)
      .get(),
    rootCollections.activities
      .where('template', '==', template)
      .where('officeId', '==', officeId)
      .where('attachment.Name.value', '==', reportNames.FOOTPRINTS)
      .limit(1)
      .get(),
  ]);

  if (footprintsRecipientActivity) {
    return;
  }

  const { attachment, venue, schedule } = recipientTemplate.data();

  attachment.Name.value = 'footprints';

  const activityData = {
    addendumDocRef,
    attachment,
    template,
    venue: venue.map(venueDescriptor => ({
      venueDescriptor,
      address: '',
      location: '',
      geopoint: { latitude: '', longitude: '' },
    })),
    schedule: schedule.map(name => ({ name, startTime: '', endTime: '' })),
    timestamp: Date.now(),
    timezone: locals.change.after.get('attachment.Timezone.value'),
    status: recipientTemplate.get('statusOnCreate'),
    office: locals.change.after.get('office'),
    activityName: 'RECIPIENT: FOOTPRINTS REPORT',
    canEditRule: recipientTemplate.get('canEditRule'),
    officeId: locals.change.after.id,
    creator: locals.change.after.get('creator'),
    createTimestamp: Date.now(),
  };

  const momentNow = momentTz().tz(
    locals.change.after.get('timezone') || 'Asia/Kolkata',
  );

  const addendumDocData = {
    activityData,
    date: momentNow.date(),
    month: momentNow.month(),
    year: momentNow.year(),
    user: locals.change.after.get('creator.phoneNumber'),
    userDisplayName: locals.change.after.get('creator.displayName'),
    action: httpsActions.create,
    template: 'recipient',
    isAutoGenerated: true,
    timestamp: Date.now(),
    userDeviceTimestamp: Date.now(),
    activityId: activityRef.id,
    location: locals.addendumDoc ? locals.addendumDoc.get('location') : null,
    isSupportRequest: locals.addendumDoc
      ? locals.addendumDoc.get('isSupportRequest')
      : false,
    isAdminRequest:
      locals.addendumDoc && locals.addendumDoc.get('isAdminRequest'),
    geopointAccuracy: null,
    provider: null,
  };

  locals.assigneePhoneNumbersArray.forEach(phoneNumber => {
    batch.set(
      activityRef.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber),
      { addToInclude: false },
    );
  });

  batch.set(activityRef, activityData);
  batch.set(addendumDocRef, addendumDocData);

  return batch.commit();
};

const cancelSubscriptionOfSubscription = async (officeId, phoneNumber) => {
  const {
    docs: [doc],
  } = await rootCollections.activities
    .where('officeId', '==', officeId)
    .where('template', '==', 'subscription')
    .where('attachment.Template.value', '==', 'subscription')
    .where('attachment.Phone Number.value', '==', phoneNumber)
    .limit(1)
    .get();

  if (!doc || doc.get('status') === 'CANCELLED') {
    return;
  }

  return doc.ref.set(
    {
      timestamp: Date.now(),
      addendumDocRef: null,
      status: 'CANCELLED',
    },
    { merge: true },
  );
};

const handleSitemap = async locals => {
  const path = 'sitemap';
  const sitemapObject = await admin
    .database()
    .ref(path)
    .once('value');
  const sitemap = sitemapObject.val() || {};
  const office = locals.change.after.get('office');
  const slug = slugify(office);

  sitemap[slug] = {
    office,
    lastMod: locals.change.after.updateTime.toDate().toJSON(),
    createTime: locals.change.after.createTime.toDate().toJSON(),
  };

  return admin
    .database()
    .ref(path)
    .set(sitemap);
};

const getVid = async () => {
  const vAccountId = crypto
    .randomBytes(16)
    .toString('hex')
    .substring(0, 9);

  const existsAlready =
    (
      await rootCollections.offices
        .where('vAccountId', '==', vAccountId)
        .limit(1)
        .get()
    ).size > 0;

  if (existsAlready) {
    return getVid();
  }

  return vAccountId;
};

const createOfficeVirtualAccount = async locals => {
  if (!isActivityCreated(locals.change)) {
    return;
  }

  const { value: firstContact } = locals.change.after.get(
    'attachment.First Contact',
  );
  const { value: secondContact } = locals.change.after.get(
    'attachment.Second Contact',
  );

  const [firstUserRecord, secondUserRecord] = await Promise.all([
    getAuth(firstContact),
    getAuth(secondContact),
  ]);

  const {
    displayName: firstDisplayName,
    email: firstEmail,
    emailVerified: firstEmailVerified,
  } = firstUserRecord;

  let name, email, phone, emailVerified;

  const {
    displayName: secondDisplayName,
    email: secondEmail,
    emailVerified: secondEmailVerified,
  } = secondUserRecord;

  const firstContactRejected =
    !firstDisplayName || !firstEmail || !firstEmailVerified;
  const secondContactRejected =
    !secondDisplayName || !secondEmail || !secondEmailVerified;

  if (!firstContactRejected) {
    name = firstDisplayName;
    email = firstDisplayName;
    phone = firstContact;
    emailVerified = firstEmailVerified;
  }

  if (!secondContactRejected) {
    name = secondDisplayName;
    email = secondEmail;
    phone = secondContact;
    emailVerified = secondEmailVerified;
  }

  if (!name || !email || !emailVerified) {
    return;
  }

  const vAccountId = await getVid();
  console.log('vAccountId', vAccountId);

  return createVirtualAccount({
    name,
    phone,
    email,
    vAccountId,
  });
};

const handleOffice = async locals => {
  const { value: firstContactNew } = locals.change.after.get(
    'attachment.First Contact',
  );
  const firstContactOld = locals.change.before.get(
    'attachment.First Contact.value',
  );
  const secondContactNew = locals.change.after.get(
    'attachment.Second Contact.value',
  );
  const secondContactOld = locals.change.before.get(
    'attachment.Second Contact.value',
  );
  const officeId = locals.change.after.id;

  if (firstContactOld && firstContactOld !== firstContactNew) {
    await Promise.all([
      cancelSubscriptionOfSubscription(officeId, firstContactOld),
      cancelAdmin(officeId, firstContactOld),
    ]);
  }

  if (secondContactOld && secondContactOld !== secondContactNew) {
    await Promise.all([
      cancelSubscriptionOfSubscription(officeId, secondContactOld),
      cancelAdmin(officeId, secondContactOld),
    ]);
  }

  await createFootprintsRecipient(locals);
  await createAutoSubscription(locals, 'subscription', firstContactNew);
  await createAutoSubscription(locals, 'subscription', secondContactNew);
  await createBranches(locals);
  await handleSitemap(locals);

  return createOfficeVirtualAccount(locals);
};

module.exports = handleOffice;
