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
  toMapsUrl,
} = require('../recipients/report-utils');
const momentTz = require('moment-timezone');

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


const getFieldValue = (snapShot, field) => {
  if (snapShot.empty) {
    return {};
  }

  return snapShot.docs[0].get(field) || {};
};


const getVisitObject = (addendumDoc, initQuery, locals) => {
  const visitObject = getFieldValue(initQuery, 'visitObject');
  const activityData = addendumDoc.get('activityData');
  const activityId = addendumDoc.get('activityId');
  const template = addendumDoc.get('activityData.template');
  const status = addendumDoc.get('activityData.status');
  const [
    visitDateSchedule,
    followUpDateSchedule,
  ] = activityData.schedule;

  const dataObject = (() => {
    if (template === 'tour plan') {
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

  if (!visitObject[activityId]) {
    visitObject[activityId] = {};
  }

  if (visitDateSchedule.startTime) {
    visitObject[activityId] = {
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
      visitObject[activityId].followUpStartTimestamp =
        followUpDateSchedule.startTime;
      visitObject[activityId].followUpEndTimestamp =
        followUpDateSchedule.endTime;
    }
  }

  if (status === 'CANCELLED') {
    visitObject[activityId] = deleteField();
  }

  console.log({ visitObject });

  return visitObject;
};


const getFollowUpObject = (addendumDoc, initQuery) => {
  const followUpObject = getFieldValue(initQuery, 'followUpObject');
  const activityId = addendumDoc.get('activityId');
  const activityData = addendumDoc.get('activityData');
  const status = addendumDoc.get('activityData.status');
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

  if (followUpDateSchedule.startTime || closureDateSchedule.startTime) {
    followUpObject[activityId] = {
      visitType,
      visitStartTime: visitDateSchedule.startTime,
      phoneNumber: addendumDoc.get('user'),
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
      // Popluating in the parent function.
      actualLocation: '',
    };
  }

  if (status === 'CANCELLED') {
    followUpObject[activityId] = deleteField();
  }

  console.log({ followUpObject });

  return followUpObject;
};


const getDutyRosterObject = (addendumDoc, initQuery, locals) => {
  const dutyRosterObject = getFieldValue(initQuery, 'dutyRosterObject');
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
  const expenseClaimObject = getFieldValue(initQuery, 'expenseClaimObject');
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
      // `PENDING` or `CONFIRMED`
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
          expenseClaimObject:
            getExpenseClaimObject(addendumDoc, expenseClaimInitDocsQuery, locals),
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


const handleVisitDate = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== reportNames.DSR
    && addendumDoc.get('activityData.template') !== reportNames.TOUR_PLAN
    || !addendumDoc.get('activityData.schedule')[0]) {
    console.log('In handleVisitDate: resolving early');

    return Promise.resolve();
  }

  const visitStartSchedule = addendumDoc.get('activityData.schedule')[0];
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

      const docData = {
        date,
        month,
        year,
        report: reportNames.DSR,
        office: addendumDoc.get('activityData.office'),
        officeId: addendumDoc.get('activityData.officeId'),
        visitObject: getVisitObject(addendumDoc, snapShot, locals),
      };

      if (snapShot.empty) {
        docData.followUpObject = {};
      }

      console.log('visit:', ref.path);

      return Promise.resolve();
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
  const followUpStartTimestamp = new Date(followUpSchedule.startTime);
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

      const docData = {
        date,
        month,
        year,
        report: reportNames.DSR,
        office: addendumDoc.get('activityData.office'),
        officeId: addendumDoc.get('activityData.officeId'),
        followUpObject: getFollowUpObject(addendumDoc, snapShot),
      };

      if (snapShot.empty) docData.visitObject = {};

      console.log('follow up:', ref.path);

      // return ref.set(docData, { merge: true });

      locals.batch.set(ref, docData, { merge: true });

      return Promise.resolve();
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

  console.log({
    action,
    isSupportRequest,
    isAdminRequest,
    isAutoGenerated,
  });

  const momentToday = momentTz().toObject();
  const momentYesterday = momentTz().subtract(1, 'days').toObject();

  console.log({ momentToday, momentYesterday });

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
      }

      if (isAutoGenerated) {
        autoGenerated++;
      }

      if (isAdminRequest && !isSupportRequest) {
        // Support requests on admin resource does not count
        // towards this count.
        withAdminApi++;
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

      const leaveObject = (() => {
        if (snapShot.empty) {
          return {};
        }

        return snapShot.docs[0].get('leaveObject');
      })();

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


module.exports = (addendumDoc, context) => {
  const phoneNumber = addendumDoc.get('user');
  const officeId = addendumDoc.get('activityData.officeId');
  const locals = {
    batch: db.batch(),
    dateObject: new Date(),
  };

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .where('user', '==', phoneNumber)
    .where('date', '==', locals.dateObject.getDate())
    .where('month', '==', locals.dateObject.getMonth())
    .where('year', '==', locals.dateObject.getFullYear())
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

      locals.placeInformation = getPlaceInformation(
        mapsApiResult,
        addendumDoc.get('location')
      );

      const distanceData = (() => {
        if (!locals.previousAddendumDoc) {
          return {
            accumulatedDistance: 0,
            distanceTravelled: 0,
          };
        }

        const value =
          distanceMatrixApiResult
            .json
            .rows[0]
            .elements[0]
            .distance
            .value;

        console.log({ value });

        const accumulatedDistance =
          Number(locals.previousAddendumDoc.get('accumulatedDistance') || 0)
          // value is in meters
          + value / 1000;

        return {
          accumulatedDistance: accumulatedDistance.toFixed(2),
          distanceTravelled: 0,
        };
      })();

      const updateObject = {
        url: locals.placeInformation.url,
        identifier: locals.placeInformation.identifier,
        accumulatedDistance: distanceData.accumulatedDistance,
        distanceTravelled: distanceData.distanceTravelled,
      };

      console.log({
        phoneNumber,
        updateObject,
        placeInformation: locals.placeInformation,
        currPath: addendumDoc.ref.path,
        prevPath:
          locals.previousAddendumDoc ? locals
            .previousAddendumDoc
            .ref
            .path : null,
      });

      locals.batch.set(addendumDoc.ref, updateObject, {
        merge: true,
      });

      return;
    })
    .then(() => handleDsr(addendumDoc, locals))
    .then(() => handleLeaveReport(addendumDoc, locals))
    .then(() => handleDutyRosterReport(addendumDoc, locals))
    .then(() => handleExpenseClaimReport(addendumDoc, locals))
    .then(() => locals.batch.commit())
    .then(() => handleDailyStatusReport(addendumDoc, locals))
    .catch((error) => {
      console.error(error);

      const instantDocRef = rootCollections.instant.doc();
      console.log('crash id:', instantDocRef.id);
      const doc = addendumDoc.data();
      delete doc.activityData.addendumDocRef;

      const context = {
        // error,
        doc,
        addendumId: addendumDoc.id,
        instantDocId: instantDocRef.id,
      };

      return instantDocRef
        .set({
          subject: `${process.env.FUNCTION_NAME}`
            + ` Crash ${process.env.GCLOUD_PROJECT}`,
          messageBody: JSON.stringify(context, ' ', 2),
        });
    });
};
