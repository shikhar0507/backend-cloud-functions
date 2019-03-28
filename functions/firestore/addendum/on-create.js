'use strict';


const {
  db,
  rootCollections,
  deleteField,
} = require('../../admin/admin');
const {
  httpsActions,
  reportNames,
} = require('../../admin/constants');
const {
  haversineDistance,
} = require('../activity/helper');
const {
  toMapsUrl,
} = require('../recipients/report-utils');
const momentTz = require('moment-timezone');
const env = require('../../admin/env');

const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: require('../../admin/env').mapsApiKey,
      Promise: Promise,
    });


const initDocRef = (snapShot) => {
  if (snapShot.empty) {
    return rootCollections.inits.doc();
  }

  return snapShot.docs[0].ref;
};

const getLocalityCityState = (components) => {
  let locality = '';
  let city = '';
  let state = '';

  components.forEach((component) => {
    if (component.types.includes('locality')) {
      locality = component.long_name;
    }

    if (component.types.includes('administrative_area_level_2')) {
      city = component.long_name;
    }

    if (component.types.includes('administrative_area_level_1')) {
      state = component.long_name;
    }
  });

  return { locality, city, state };
};


const getLatLngString = (location) =>
  `${location._latitude},${location._longitude}`;

const getLocationUrl = (plusCode) => `https://plus.codes/${plusCode}`;

const getPlaceInformation = (mapsApiResult, geopoint) => {
  const value = toMapsUrl(geopoint);

  if (!mapsApiResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const firstResult = mapsApiResult.json.results[0];

  if (!firstResult) {
    return {
      url: value,
      identifier: value,
    };
  }

  const addressComponents = firstResult['address_components'];

  let identifier = '';

  addressComponents.forEach((component) => {
    const longName = component['long_name'];
    const types = component.types;

    if (!types.includes('political')) return;

    if (types.includes('sublocality')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('locality')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('administrative_area_level_2')) {
      identifier += ` ${longName} `;
    }

    if (types.includes('administrative_area_level_1')) {
      identifier += ` ${longName} `;
    }
  });

  const plusCode = mapsApiResult.json['plus_code']['global_code'];

  return {
    identifier: identifier.trim(),
    url: getLocationUrl(plusCode),
  };
};


const getObject = (snapShot, field) => {
  if (snapShot.empty) {
    return {};
  }

  return snapShot.docs[0].get(field) || {};
};


const getDutyRosterObject = (addendumDoc, initQuery, locals) => {
  const dutyRosterObject = getObject(initQuery, 'dutyRosterObject');
  const action = addendumDoc.get('action');
  const status = addendumDoc.get('activityData.status');
  const schedule = addendumDoc.get('activityData.schedule')[0];
  const venue = addendumDoc.get('activityData.venue')[0];
  const activityId = addendumDoc.get('activityId');
  const description = addendumDoc.get('activityData.attachment.Description.value');

  if (!dutyRosterObject[activityId]) {
    dutyRosterObject[activityId] = {};
  }

  dutyRosterObject[activityId].status = status;
  // Not changing the dutyType to Name, because old data will become incompatible
  dutyRosterObject[activityId].dutyType =
    addendumDoc.get('activityData.attachment.Name.value')
    || addendumDoc.get('activityData.attachment.Duty Type.value');
  dutyRosterObject[activityId].description = description;
  dutyRosterObject[activityId].reportingLocation = venue.address;
  dutyRosterObject[activityId].reportingLocationGeopoint = venue.geopoint;
  dutyRosterObject[activityId].reportingTimeStart = schedule.startTime;
  dutyRosterObject[activityId].reportingTimeEnd = schedule.endTime;

  if (action === httpsActions.create) {
    dutyRosterObject[activityId].createdBy = addendumDoc.get('user');
    dutyRosterObject[activityId].createdOn = addendumDoc.get('timestamp');
    /** 
     * Default is empty string because unless someone updates the activity
     * status to `CONFIRMED` or `CANCELLED` 
     */
    dutyRosterObject[activityId].place = {
      identifier: '',
      url: '',
    };
  }

  if (action === httpsActions.changeStatus) {
    if (status === 'CONFIRMED') {
      dutyRosterObject[activityId].when = addendumDoc.get('timestamp');
      dutyRosterObject[activityId].user = addendumDoc.get('user');
      dutyRosterObject[activityId].place = locals.placeInformation;
    } else {
      dutyRosterObject[activityId].when = '';
      dutyRosterObject[activityId].user = '';
      dutyRosterObject[activityId].place = '';
    }
  }

  console.log({ dutyRosterObject });

  return dutyRosterObject;
};


const getExpenseClaimObject = (addendumDoc, initQuery, locals) => {
  const expenseClaimObject = getObject(initQuery, 'expenseClaimObject');
  const action = addendumDoc.get('action');
  const activityData = addendumDoc.get('activityData');
  const activityId = addendumDoc.get('activityId');

  if (!expenseClaimObject[activityId]) {
    expenseClaimObject[activityId] = {};
  }

  expenseClaimObject[activityId] = {
    amount: activityData.attachment.Amount.value,
    status: activityData.status,
    expenseType: activityData.attachment['Expense Type'].value,
    reason: activityData.attachment.Reason.value,
    referenceNumber: activityData.attachment['Reference Number'].value,
    confirmedAt: '',
    confirmedBy: '',
    confirmedOn: '',
    user: '',
    expenseDateStartTime: '',
    expenseLocation: '',
  };

  if (action === httpsActions.create) {
    expenseClaimObject[activityId].phoneNumber = addendumDoc.get('user');
    // Done explictly. Ignoring expense date from schedule
    expenseClaimObject[activityId].expenseDateStartTime = addendumDoc.get('timestamp');
    expenseClaimObject[activityId].expenseLocation = locals.placeInformation;
  }

  if (action === httpsActions.changeStatus) {
    if (activityData.status === 'CONFIRMED') {
      expenseClaimObject[activityId].confirmedBy = addendumDoc.get('user');
      expenseClaimObject[activityId].confirmedOn = addendumDoc.get('timestamp');
      expenseClaimObject[activityId].confirmedAt = locals.placeInformation;
    } else {
      // `PENDING` or `CANCELLED`
      expenseClaimObject[activityId].confirmedBy = '';
      expenseClaimObject[activityId].confirmedOn = '';
      expenseClaimObject[activityId].confirmedAt = '';
    }
  }

  console.log({ expenseClaimObject });

  return expenseClaimObject;
};


const handleExpenseClaimReport = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== reportNames.EXPENSE_CLAIM) {
    return Promise.resolve();
  }

  if (addendumDoc.get('action') === httpsActions.comment) {
    return Promise.resolve();
  }

  const timestamp = addendumDoc.get('timestamp');
  const month = new Date(timestamp).getMonth();
  const year = new Date(timestamp).getFullYear();

  return rootCollections
    .inits
    .where('report', '==', reportNames.EXPENSE_CLAIM)
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((expenseClaimInitDocsQuery) => {
      const ref = initDocRef(expenseClaimInitDocsQuery);

      locals
        .batch
        .set(ref, {
          month,
          year,
          expenseClaimObject: getExpenseClaimObject(
            addendumDoc,
            expenseClaimInitDocsQuery,
            locals
          ),
          report: reportNames.EXPENSE_CLAIM,
          office: addendumDoc.get('activityData.office'),
          officeId: addendumDoc.get('activityData.officeId'),
        }, {
            merge: true,
          });

      return Promise.resolve();
    })
    .catch(console.error);
};


const handleDutyRosterReport = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== reportNames.DUTY_ROSTER) {
    return Promise.resolve();
  }

  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');
  const startTime = addendumDoc.get('activityData.schedule')[0].startTime;
  const endTime = addendumDoc.get('activityData.schedule')[0].endTime;

  if (!startTime || !endTime) {
    return Promise.resolve();
  }

  const dateObject = new Date(startTime);
  const date = dateObject.getDate();
  const month = dateObject.getMonth();
  const year = dateObject.getFullYear();

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', reportNames.DUTY_ROSTER)
        .where('date', '==', date)
        .where('office', '==', office)
        .where('month', '==', month)
        .where('year', '==', year)
        .limit(1)
        .get(),
      rootCollections
        .activities
        .doc(addendumDoc.get('activityId'))
        .collection('Assignees')
        .get(),
    ])
    .then((result) => {
      const [
        dutyRosterInitDocsQuery,
        assigneesSnapshot,
      ] = result;

      const ref = initDocRef(dutyRosterInitDocsQuery);
      const dutyRosterObject
        = getDutyRosterObject(addendumDoc, dutyRosterInitDocsQuery, locals);
      const activityId = addendumDoc.get('activityId');

      dutyRosterObject[activityId].assignees =
        assigneesSnapshot
          .docs
          .map((doc) => doc.id);

      locals.batch.set(ref, {
        date,
        month,
        year,
        office,
        officeId,
        dutyRosterObject,
        report: reportNames.DUTY_ROSTER,
      }, {
          merge: true,
        });

      return Promise.resolve();
    })
    .catch(console.error);
};

const getVisitObject = (addendumDoc, initQuery, locals) => {
  const visitObject = getObject(initQuery, 'visitObject');
  const activityData = addendumDoc.get('activityData');
  const activityId = addendumDoc.get('activityId');
  const template = addendumDoc.get('activityData.template');
  const status = addendumDoc.get('activityData.status');
  const phoneNumber = addendumDoc.get('user');
  const [
    visitDateSchedule,
    followUpDateSchedule,
  ] = activityData.schedule;

  const dataObject = (() => {
    if (template === reportNames.TOUR_PLAN) {
      return {
        firstContact: '',
        secondContact: '',
        product1: '',
        product2: '',
        product3: '',
      };
    }

    return {
      firstContact: activityData.attachment['First Contact'].value,
      secondContact: activityData.attachment['Second Contact'].value,
      product1: activityData.attachment['Product 1'].value,
      product2: activityData.attachment['Product 2'].value,
      product3: activityData.attachment['Product 3'].value,
    };
  })();

  if (!visitObject[phoneNumber]) {
    visitObject[phoneNumber] = {
      [activityId]: {},
    };
  }

  if (visitDateSchedule.startTime) {
    visitObject[phoneNumber][activityId] = {
      status,
      firstContact: dataObject.firstContact,
      secondContact: dataObject.secondContact,
      purpose: addendumDoc.get('activityData.template'),
      phoneNumber: addendumDoc.get('user'),
      visitStartTimestamp: visitDateSchedule.startTime,
      visitEndTimestamp: visitDateSchedule.endTime,
      customer: activityData.attachment.Customer.value,
      product1: dataObject.product1,
      product2: dataObject.product2,
      product3: dataObject.product3,
      comment: activityData.attachment.Comment.value,
      actualLocation: locals.placeInformation,
    };

    if (template === reportNames.DSR) {
      visitObject[phoneNumber][activityId]
        .followUpStartTimestamp = followUpDateSchedule.startTime;
      visitObject[phoneNumber][activityId]
        .followUpEndTimestamp = followUpDateSchedule.endTime;
    }
  }

  if (addendumDoc.get('status') === httpsActions.create) {
    visitObject[phoneNumber][activityId].city = locals.city;
    visitObject[phoneNumber][activityId].state = locals.state;
    visitObject[phoneNumber][activityId].locality = locals.locality;
  }

  if (status === 'CANCELLED'
    && visitObject[phoneNumber]
    && visitObject[phoneNumber][activityId]) {
    visitObject[phoneNumber][activityId] = deleteField();
  }

  return visitObject;
};


const getFollowUpObject = (addendumDoc, initQuery, locals) => {
  const followUpObject = getObject(initQuery, 'followUpObject');
  const activityId = addendumDoc.get('activityId');
  const activityData = addendumDoc.get('activityData');
  const status = addendumDoc.get('activityData.status');
  const phoneNumber = addendumDoc.get('user');
  const [
    visitDateSchedule,
    followUpDateSchedule,
    closureDateSchedule,
  ] = activityData.schedule;

  const visitType = (() => {
    if (closureDateSchedule.startTime) {
      return 'Closure';
    }

    return 'Follow-Up';
  })();

  if (!followUpObject[phoneNumber]) {
    followUpObject[phoneNumber] = {
      [activityId]: {},
    };
  }

  if (followUpDateSchedule.startTime || closureDateSchedule.startTime) {
    followUpObject[phoneNumber][activityId] = {
      visitType,
      phoneNumber,
      visitStartTimestamp: visitDateSchedule.startTime,
      visitEndTimestamp: visitDateSchedule.endTime,
      followUpStartTimestamp: followUpDateSchedule.startTime,
      followUpEndTimestamp: followUpDateSchedule.endTime,
      customer: activityData.attachment.Customer.value,
      firstContact: activityData.attachment['First Contact'].value,
      secondContact: activityData.attachment['Second Contact'].value,
      product1: activityData.attachment['Product 1'].value,
      product2: activityData.attachment['Product 2'].value,
      product3: activityData.attachment['Product 3'].value,
      closureStartTimestamp: closureDateSchedule.startTime,
      closureEndTimestamp: closureDateSchedule.endTime,
      comment: activityData.attachment.Comment.value,
      purpose: addendumDoc.get('activityData.template'),
      actualLocation: locals.placeInformation,
    };
  }

  if (addendumDoc.get('action') === httpsActions.create) {
    followUpObject[phoneNumber][activityId].city = locals.city;
    followUpObject[phoneNumber][activityId].locality = locals.locality;
    followUpObject[phoneNumber][activityId].state = locals.state;
  }

  if (status === 'CANCELLED'
    && followUpObject[phoneNumber]
    && followUpObject[phoneNumber][activityId]) {
    followUpObject[phoneNumber][activityId] = deleteField();
  }

  return followUpObject;
};


const handleVisitDate = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== reportNames.DSR
    && addendumDoc.get('activityData.template') !== reportNames.TOUR_PLAN
    || !addendumDoc.get('activityData.schedule')[0]) {
    console.log('In handleVisitDate: resolving early');

    return Promise.resolve();
  }

  const visitStartSchedule = addendumDoc.get('activityData.schedule')[0];

  if (!visitStartSchedule.startTime) {
    return Promise.resolve();
  }

  const visitDayStartTimestamp = new Date(visitStartSchedule.startTime);
  const date = visitDayStartTimestamp.getDate();
  const month = visitDayStartTimestamp.getMonth();
  const year = visitDayStartTimestamp.getFullYear();

  return rootCollections
    .inits
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('report', '==', reportNames.DSR)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((snapShot) => {
      const ref = initDocRef(snapShot);
      const visitObject = getVisitObject(addendumDoc, snapShot, locals);

      return ref
        .set({
          date,
          month,
          year,
          visitObject,
          report: reportNames.DSR,
          office: addendumDoc.get('activityData.office'),
          officeId: addendumDoc.get('activityData.officeId'),
        }, {
            merge: true,
          });
    })
    .catch(console.error);
};


const handleFollowUpDate = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== reportNames.DSR
    || !addendumDoc.get('activityData.schedule')[1]) {
    console.log('resolving early follow up');

    return Promise.resolve();
  }

  const followUpSchedule = addendumDoc.get('activityData.schedule')[1];
  const closureDateSchedule = addendumDoc.get('activityData.schedule')[2];

  if (!followUpSchedule.startTime && !closureDateSchedule.startTime) {
    return Promise.resolve();
  }

  // Either date can be missing
  const followUpStartTimestamp = new Date(
    followUpSchedule.startTime || closureDateSchedule.startTime
  );
  const date = followUpStartTimestamp.getDate();
  const month = followUpStartTimestamp.getMonth();
  const year = followUpStartTimestamp.getFullYear();

  return rootCollections
    .inits
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('report', '==', reportNames.DSR)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((snapShot) => {
      const ref = initDocRef(snapShot);

      const followUpObject = getFollowUpObject(addendumDoc, snapShot, locals);

      return ref
        .set({
          date,
          month,
          year,
          followUpObject,
          report: reportNames.DSR,
          office: addendumDoc.get('activityData.office'),
          officeId: addendumDoc.get('activityData.officeId'),
        }, {
            merge: true,
          });
    })
    .catch(console.error);
};


const handleDsr = (addendumDoc, locals) => {
  if (!new Set()
    .add(reportNames.DSR)
    .add(reportNames.TOUR_PLAN)
    .has(addendumDoc.get('activityData.template'))) {
    return Promise.resolve();
  }

  return handleVisitDate(addendumDoc, locals)
    .then(() => handleFollowUpDate(addendumDoc, locals))
    .catch(console.error);
};


const handleDailyStatusReport = (addendumDoc, locals) => {
  if (!env.isProduction) {
    console.log('NOT PROD. NOT LOGGING DATA');

    return Promise.resolve();
  }

  const batch = db.batch();

  const getValue = (snap, field) => {
    if (snap.empty) {
      return 0;
    }

    return snap.docs[0].get(field) || 0;
  };

  const action = addendumDoc.get('action');
  const isSupportRequest = addendumDoc.get('isSupportRequest');
  const isAdminRequest = addendumDoc.get('isAdminRequest');
  const isAutoGenerated = addendumDoc.get('isAutoGenerated');
  const template = addendumDoc.get('activityData.template');
  const momentToday = momentTz().toObject();

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', reportNames.DAILY_STATUS_REPORT)
        .where('date', '==', momentToday.date)
        .where('month', '==', momentToday.months)
        .where('year', '==', momentToday.years)
        .limit(1)
        .get(),
      rootCollections
        .inits
        .where('report', '==', 'counter')
        .limit(1)
        .get(),
    ])
    .then((result) => {
      const [
        todayInitQuery,
        counterDocsQuery,
      ] = result;

      const initDoc = initDocRef(todayInitQuery);

      console.log('REPORT:', initDoc.path);

      let totalActivities = counterDocsQuery.docs[0].get('totalActivities');
      let totalCreatedWithAdminApi = counterDocsQuery.docs[0].get('totalCreatedWithAdminApi');
      let totalCreatedWithClientApi = counterDocsQuery.docs[0].get('totalCreatedWithClientApi');
      let totalCreatedWithSupport = counterDocsQuery.docs[0].get('totalCreatedWithSupport');
      const supportMap = counterDocsQuery.docs[0].get('supportMap');
      const autoGeneratedMap = counterDocsQuery.docs[0].get('autoGeneratedMap');
      const totalByTemplateMap = counterDocsQuery.docs[0].get('totalByTemplateMap');
      const adminApiMap = counterDocsQuery.docs[0].get('adminApiMap');

      let activitiesAddedToday = getValue(todayInitQuery, 'activitiesAddedToday');
      let withAdminApi = getValue(todayInitQuery, 'withAdminApi');
      let autoGenerated = getValue(todayInitQuery, 'autoGenerated');
      let withSupport = getValue(todayInitQuery, 'withSupport');
      let createApi = getValue(todayInitQuery, 'createApi');
      let updateApi = getValue(todayInitQuery, 'updateApi');
      let changeStatusApi = getValue(todayInitQuery, 'changeStatusApi');
      let shareApi = getValue(todayInitQuery, 'shareApi');
      let commentApi = getValue(todayInitQuery, 'commentApi');

      if (action === httpsActions.create) {
        totalActivities++;
        activitiesAddedToday++;
        createApi++;

        if (totalByTemplateMap[template]) {
          totalByTemplateMap[template]++;
        } else {
          totalByTemplateMap[template] = 1;
        }
      }

      if (action === httpsActions.update) {
        updateApi++;
      }

      if (action === httpsActions.changeStatus) {
        changeStatusApi++;
      }

      if (action === httpsActions.share) {
        shareApi++;
      }

      if (action === httpsActions.comment) {
        commentApi++;
      }

      if (isSupportRequest) {
        withSupport++;
        totalCreatedWithSupport++;

        if (supportMap[template]) {
          supportMap[template]++;
        } else {
          supportMap[template] = 1;
        }
      }

      if (isAutoGenerated) {
        autoGenerated++;

        if (autoGeneratedMap[template]) {
          autoGeneratedMap[template]++;
        } else {
          autoGeneratedMap[template] = 1;
        }
      }

      if (isAdminRequest && !isSupportRequest) {
        // Support requests on admin resource does not count
        // towards this count.
        withAdminApi++;
        totalCreatedWithAdminApi++;

        if (adminApiMap[template]) {
          adminApiMap[template]++;
        } else {
          adminApiMap[template] = 1;
        }

      } else {
        totalCreatedWithClientApi++;
      }

      const dataObject = (() => {
        if (todayInitQuery.empty) return {};

        return todayInitQuery.docs[0].data() || {};
      })();

      dataObject.totalActivities = totalActivities;
      dataObject.activitiesAddedToday = activitiesAddedToday;
      dataObject.withAdminApi = withAdminApi;
      dataObject.autoGenerated = autoGenerated;
      dataObject.withSupport = withSupport;
      dataObject.createApi = createApi;
      dataObject.updateApi = updateApi;
      dataObject.changeStatusApi = changeStatusApi;
      dataObject.shareApi = shareApi;
      dataObject.commentApi = commentApi;
      dataObject.report = reportNames.DAILY_STATUS_REPORT;
      dataObject.date = locals.dateObject.getDate();
      dataObject.month = locals.dateObject.getMonth();
      dataObject.year = locals.dateObject.getFullYear();

      if (!dataObject.templateUsageObject) {
        dataObject.templateUsageObject = {};
      }

      if (!dataObject.templateUsageObject[template]) {
        dataObject.templateUsageObject[template] = {};
      }

      if (!dataObject.templateUsageObject[template][action]) {
        dataObject.templateUsageObject[template][action] = 0;
      }

      dataObject.templateUsageObject[template][action] =
        dataObject.templateUsageObject[template][action] + 1;

      batch.set(initDoc, dataObject, {
        merge: true,
      });

      batch.set(counterDocsQuery.docs[0].ref, {
        totalActivities,
        adminApiMap,
        autoGeneratedMap,
        supportMap,
        totalByTemplateMap,
        totalCreatedWithAdminApi,
        totalCreatedWithClientApi,
        totalCreatedWithSupport,
      }, {
          merge: true,
        });

      return batch.commit();
    })
    .catch(console.error);
};


const handleLeaveReport = (addendumDoc, locals) => {
  const status = addendumDoc.get('activityData.status');
  const activityId = addendumDoc.get('activityId');
  const office = addendumDoc.get('activityData.office');
  const user = addendumDoc.get('user');
  const action = addendumDoc.get('action');
  const template = addendumDoc.get('activityData.template');

  if (template !== reportNames.LEAVE) {
    return Promise.resolve();
  }

  return rootCollections
    .inits
    .where('report', '==', reportNames.LEAVE)
    .where('month', '==', locals.dateObject.getMonth())
    .where('year', '==', locals.dateObject.getFullYear())
    .limit(1)
    .get()
    .then((snapShot) => {
      const ref = initDocRef(snapShot);
      const leaveObject = getObject(snapShot, 'leaveObject');

      if (!leaveObject[activityId]) {
        leaveObject[activityId] = {
          approvedBy: '',
          timestamp: Date.now(),
        };
      }

      if (status === 'CONFIRMED' && action === httpsActions.changeStatus) {
        leaveObject[activityId].approvedBy = user;
      }

      if (status === 'CANCELLED') {
        leaveObject[activityId] = deleteField();
      }

      locals.batch.set(ref, {
        office,
        month: locals.dateObject.getMonth(),
        year: locals.dateObject.getFullYear(),
        report: reportNames.LEAVE,
        leaveObject,
      }, {
          merge: true,
        });

      return Promise.resolve();
    })
    .catch(console.error);
};

const logLocations = (addendumDoc, locals) => {
  const geopointAccuracy = addendumDoc.get('geopointAccuracy');

  // Only user app sends `geopointAccuracy`;
  if (!geopointAccuracy || geopointAccuracy < 350) {
    return Promise.resolve();
  }

  const message = 'lowGeopointAccuracy';
  const isPoor = geopointAccuracy > 350 && geopointAccuracy < 1200;
  const isBad = geopointAccuracy > 1200;
  const date = locals.momentWithOffset.date();
  const month = locals.momentWithOffset.month();
  const year = locals.momentWithOffset.year();

  return rootCollections
    .errors
    .where('message', '==', message)
    .where('date', '==', date)
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((docs) => {
      const ref = (() => {
        if (docs.empty) {
          return rootCollections.errors.doc();
        }

        return docs.docs[0].ref;
      })();

      console.log('error doc:', ref.path, { isPoor, isBad });

      const accuracyType = (() => {
        if (isPoor) {
          return 'poor';
        }

        return 'bad';
      })();

      const docRefsArray = (() => {
        if (docs.empty) {
          return [];
        }

        return docs.docs[0].get('docRefsArray') || [];
      })();

      docRefsArray.push(addendumDoc.ref.path);

      return ref
        .set({
          message,
          date,
          month,
          isPoor,
          isBad,
          year,
          accuracyType,
          docRefsArray,
          // No need in the report because these are simply 
          // paths to the docs.
          skipFromErrorReport: true,
        }, {
            merge: true,
          });
    })
    .catch(console.error);
};


module.exports = (addendumDoc) => {
  const phoneNumber = addendumDoc.get('user');
  const officeId = addendumDoc.get('activityData.officeId');
  const timezone = addendumDoc.get('activityData.timezone') || 'Asia/Kolkata';
  const locals = {
    dateObject: new Date(),
    momentWithOffset: momentTz().tz(timezone),
  };

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .where('user', '==', phoneNumber)
    .orderBy('timestamp', 'desc')
    .limit(2)
    .get()
    .then((docs) => {
      console.log('size', docs.size);

      locals
        .previousAddendumDoc = (() => {
          if (docs.docs[0] && docs.docs[0].id !== addendumDoc.id) {
            return docs.docs[0];
          }

          return docs.docs[1];
        })();

      const promises = [
        googleMapsClient
          .reverseGeocode({
            latlng: getLatLngString(addendumDoc.get('location')),
          })
          .asPromise(),
      ];

      if (locals.previousAddendumDoc) {
        promises.push(googleMapsClient
          .distanceMatrix({
            origins: getLatLngString(locals.previousAddendumDoc.get('location')),
            destinations: getLatLngString(addendumDoc.get('location')),
            units: 'metric',
          })
          .asPromise());
      }

      return Promise.all(promises);
    })
    .then((result) => {
      const [
        mapsApiResult,
        distanceMatrixApiResult,
      ] = result;

      locals
        .placeInformation = getPlaceInformation(
          mapsApiResult,
          addendumDoc.get('location')
        );

      if (mapsApiResult.json.results.length > 0) {
        const components = mapsApiResult.json.results[0].address_components;

        const { city, state, locality } = getLocalityCityState(components);

        locals.city = city;
        locals.state = state;
        locals.locality = locality;

        console.log({ city, state, locality });
      }

      const distanceData = (() => {
        if (!locals.previousAddendumDoc) {
          return {
            accumulatedDistance: 0,
            distanceTravelled: 0,
          };
        }

        const value = (() => {
          const distanceData = distanceMatrixApiResult
            .json
            .rows[0]
            .elements[0]
            .distance;

          // maps api result in meters
          if (distanceData) {
            return distanceData.value / 1000;
          }

          const geopointOne = locals.previousAddendumDoc.get('location');
          const geopointTwo = addendumDoc.get('location');
          const result = haversineDistance(geopointOne, geopointTwo);

          // in KM
          return result;
        })();

        const accumulatedDistance =
          Number(locals.previousAddendumDoc.get('accumulatedDistance') || 0)
          // value is in meters
          + value;

        return {
          accumulatedDistance: accumulatedDistance.toFixed(2),
          distanceTravelled: value,
        };
      })();

      const updateObject = {
        city: locals.city,
        state: locals.state,
        locality: locals.locality,
        url: locals.placeInformation.url,
        identifier: locals.placeInformation.identifier,
        distanceTravelled: distanceData.distanceTravelled,
        date: locals.momentWithOffset.date(),
        month: locals.momentWithOffset.month(),
        year: locals.momentWithOffset.year(),
      };

      console.log(JSON.stringify({
        phoneNumber,
        updateObject,
        currPath: addendumDoc.ref.path,
        prevPath: locals.previousAddendumDoc ? locals
          .previousAddendumDoc
          .ref
          .path : null,
      }, ' ', 2));

      locals.batch = db.batch();

      /** 
       * Seperating this part out because handling even a single crash
       * with `addendumOnCreate` cloud function messes up whole data for the user
       * after the time of the crash. This part should remain seperated
       * because further object/data in the `Inits` collection is pretty simple 
       * to recreate.
       */
      return addendumDoc
        .ref
        .set(updateObject, {
          merge: true,
        });
    })
    .then(() => handleLeaveReport(addendumDoc, locals))
    .then(() => handleDutyRosterReport(addendumDoc, locals))
    .then(() => handleExpenseClaimReport(addendumDoc, locals))
    .then(() => locals.batch.commit())
    /** DSR doesn't use a batch */
    .then(() => handleDsr(addendumDoc, locals))
    .then(() => handleDailyStatusReport(addendumDoc, locals))
    .then(() => logLocations(addendumDoc, locals))
    .catch((error) => {
      const context = {
        error,
        docPath: addendumDoc.ref.path,
      };

      console.error('Context:', context);

      return Promise.resolve();
    });
};
