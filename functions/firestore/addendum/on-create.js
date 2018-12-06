'use strict';


const {
  rootCollections,
  db,
  deleteField,
} = require('../../admin/admin');

const {
  httpsActions,
} = require('../../admin/constants');
const {
  haversineDistance,
} = require('../activity/helper');

const googleMapsClient =
  require('@google/maps')
    .createClient({
      key: require('../../admin/env').mapsApiKey,
      Promise: Promise,
    });

const initDocRef = (snapShot) => {
  if (snapShot.empty) return rootCollections.inits.doc();

  return snapShot.docs[0].ref;
};

const getLatLngString = (location) =>
  `${location._latitude},${location._longitude}`;

const getLocationUrl = (plusCode) => `https://plus.codes/${plusCode}`;

const getPlaceInformation = (mapsApiResult) => {
  if (!mapsApiResult) {
    return {
      url: '',
      identifier: '',
    };
  }

  const firstResult = mapsApiResult.json.results[0];
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


const getDisplayText = (addendumDoc) => {
  let displayText = '';
  const status = addendumDoc.get('activityData.status');
  const template = addendumDoc.get('activityData.template');

  if (status === 'CANCELLED') {
    return deleteField();
  }

  if (template === 'leave') {
    displayText = (() => {
      const leaveType =
        addendumDoc.get('activityData.attachment.Leave Type.value');

      if (leaveType) return `LEAVE - ${leaveType}`;

      return `LEAVE`;
    })();
  }

  if (template === 'tour plan') {
    displayText = 'ON DUTY';
  }

  return displayText;
};


const getPayrollObject = (addendumDoc, payrollInitDocQuery) => {
  const NUM_MILLI_SECS_IN_DAY = 86400000;
  const initDoc = payrollInitDocQuery.docs[0];
  const displayText = getDisplayText(addendumDoc);
  const phoneNumber = addendumDoc.get('user');
  const schedulesArray = addendumDoc.get('activityData.schedule');

  let payrollObject = {};

  if (initDoc) {
    payrollObject = initDoc.get('payrollObject') || {};
  }

  if (!payrollObject[phoneNumber]) {
    payrollObject[phoneNumber] = {};
  }

  const shouldBreak = (startDateMonth, checkingMonth) => {
    return startDateMonth !== checkingMonth;
  };

  if (addendumDoc.get('action') === httpsActions.update) {
    console.log('inside update');

    const oldSchedulesArray = addendumDoc.get('activityOld.schedule');

    oldSchedulesArray.forEach((schedule) => {
      let startTime = schedule.startTime;
      const endTime = schedule.endTime;

      if (!startTime || !endTime) return;
      // const startTimeValue = new Date(startTime).getMonth();

      while (startTime <= endTime) {
        // const date = new Date(startTime);

        // Not breaking the loop will overwrite the current
        // month's data.
        // if (shouldBreak(startTime, startTime)) break;

        delete payrollObject[phoneNumber][new Date(startTime).getDate()];

        startTime += NUM_MILLI_SECS_IN_DAY;
      }
    });
  }

  schedulesArray.forEach((schedule) => {
    let startTime = schedule.startTime;
    const endTime = schedule.endTime;

    if (!startTime || !endTime) return;
    const startTimeMonth = new Date(startTime).getMonth();

    while (startTime <= endTime) {
      const date = new Date(startTime);

      // Not breaking the loop will overwrite the current 
      // month's data
      // if (startTimeMonth !== date.getMonth()) break;
      // if (shouldBreak(startTimeMonth, date.getMonth())) break;

      payrollObject[phoneNumber][date.getDate()] = displayText;

      startTime += NUM_MILLI_SECS_IN_DAY;
    }
  });

  const nonEmptyItemsArray
    = Object
      .keys(payrollObject[phoneNumber])
      .filter((item) => item !== '');

  if (addendumDoc.get('action') === httpsActions.changeStatus
    && addendumDoc.get('activityData.status') === 'CANCELLED') {
    schedulesArray.forEach((schedule) => {
      let startTime = schedule.startTime;
      const endTime = schedule.endTime;

      if (!startTime || !endTime) return;

      while (startTime <= endTime) {
        const date = new Date(startTime).getDate();

        // if (shouldBreak(startTimeMonth, date.getMonth())) break;

        /** Leave CANCELLED, so not reflecting that in the final payroll report */
        payrollObject[phoneNumber][date] = deleteField();

        startTime += NUM_MILLI_SECS_IN_DAY;
      }
    });
  }

  /**
   * When the whole object contains empty string, the recipients onUpdate
   * should query the addendumDocs for this user's day activity. Leaving this field
   * here even when it is filled with objects will make the Recipients onUpdate
   * function to skip this user.
   */
  if (nonEmptyItemsArray.length === 0) {
    delete payrollObject[phoneNumber];
  }

  return payrollObject;
};


const getVisitObject = (addendumDoc, dsrInitDocsQuery, locals) => {
  const visitObject = (() => {
    if (dsrInitDocsQuery.empty) return {};

    return dsrInitDocsQuery
      .docs[0]
      .get('visitObject');
  })();
  const activityData = addendumDoc.get('activityData');
  const [
    visitDateSchedule,
    followUpDateSchedule,
  ] = activityData.schedule;

  const activityId = addendumDoc.get('activityId');
  const template = addendumDoc.get('activityData.template');

  const objectData = (() => {
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

  if (visitDateSchedule.startTime) {
    visitObject[activityId] = {
      firstContact: objectData.firstContact,
      secondContact: objectData.secondContact,
      purpose: addendumDoc.get('activityData.template'),
      phoneNumber: addendumDoc.get('user'),
      visitStartTimestamp: visitDateSchedule.startTime,
      visitEndTimestamp: visitDateSchedule.endTime,
      customer: activityData.attachment.Customer.value,
      product1: objectData.product1,
      product2: objectData.product2,
      product3: objectData.product3,
      comment: activityData.attachment.Comment.value,
      // TODO: Not in scopre. Pass the value from the starting of this flow.
      actualLocation: locals.placeInformation,
    };

    if (template === 'dsr') {
      visitObject[activityId].followUpStartTimestamp =
        followUpDateSchedule.startTime;
      visitObject[activityId].followUpEndTimestamp =
        followUpDateSchedule.endTime;
    }
  }

  console.log({ visitObject });

  return visitObject;
};

const getFollowUpObject = (addendumDoc, dsrInitDocsQuery) => {
  const followUpObject = (() => {
    if (dsrInitDocsQuery.empty) return {};

    return dsrInitDocsQuery
      .docs[0]
      .get('followUpObject');
  })();

  const activityId = addendumDoc.get('activityId');
  const activityData = addendumDoc.get('activityData');
  const [
    visitDateSchedule,
    followUpDateSchedule,
    closureDateSchedule,
  ] = activityData.schedule;

  // if (!visitDateSchedule.startTime || !followUpDateSchedule.startTime) {
  //   return followUpObject;
  // }

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
      actualLocation: '',
    };
  }

  console.log({ followUpObject });

  return followUpObject;
};


const getDutyRosterObject = (addendumDoc, dutyRosterInitDocsQuery) => {
  const dutyRosterObject = (() => {
    if (dutyRosterInitDocsQuery.empty) return {};

    return dutyRosterInitDocsQuery.docs[0].get('dutyRosterObject');
  })();

  const action = addendumDoc.get('action');
  const status = addendumDoc.get('activityData.status');
  const schedule = addendumDoc.get('activityData.schedule')[0];
  const venue = addendumDoc.get('activityData.venue')[0];
  const activityId = addendumDoc.get('activityId');
  const description = addendumDoc.get('activityData.attachment.Description.value');

  if (!dutyRosterObject[activityId]) dutyRosterObject[activityId] = {};

  dutyRosterObject[activityId].status = status;
  dutyRosterObject[activityId].dutyType = addendumDoc.get('activityData.attachment.Duty Type.value');
  dutyRosterObject[activityId].description = description;
  dutyRosterObject[activityId].reportingTime = schedule.startTime;
  dutyRosterObject[activityId].reportingLocation = venue.address;
  dutyRosterObject[activityId].reportingTimeStart = schedule.startTime;
  dutyRosterObject[activityId].reportingTimeEnd = schedule.endTime;

  if (action === httpsActions.create) {
    dutyRosterObject[activityId].createdBy = addendumDoc.get('user');
    dutyRosterObject[activityId].createdOn = addendumDoc.get('timestamp');
  }

  /** 
   * Default is empty string because unless someone updates the activity
   * status to `CONFIRMED` or `CANCELLED` 
   */
  const place = '';

  if (action === httpsActions.changeStatus) {
    dutyRosterObject[activityId].when = addendumDoc.get('timestamp');
    dutyRosterObject[activityId].user = addendumDoc.get('user');
    dutyRosterObject[activityId].place = place;
  }

  console.log({ dutyRosterObject });

  return dutyRosterObject;
};


const getExpenseClaimObject = (addendumDoc, expenseClaimInitDocsQuery) => {
  const expenseClaimObject = (() => {
    if (expenseClaimInitDocsQuery.empty) return {};

    return expenseClaimInitDocsQuery.docs[0].get('expenseClaimObject');
  })();

  const activityData = addendumDoc.get('activityData');
  const activityId = addendumDoc.get('activityId');

  if (!expenseClaimObject[activityId]) {
    expenseClaimObject[activityId] = {};
  }

  const expenseDateStartTime = activityData.schedule[0].startTime;

  if (!expenseDateStartTime) return expenseClaimObject;

  expenseClaimObject[activityId] = {
    expenseDateStartTime,
    phoneNumber: addendumDoc.get('user'),
    amount: activityData.attachment.Amount.value,
    status: activityData.status,
    expenseType: activityData.attachment['Expense Type'].value,
    reason: activityData.attachment.Reason.value,
    referenceNumber: activityData.attachment['Reference Number'].value,
    expenseLocation: '',
  };

  return expenseClaimObject;
};


const handleExpenseClaimReport = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== 'expense claim') {
    // return locals.batch;

    return Promise.resolve();
  }

  const startTime = addendumDoc.get('activityData').schedule[0].startTime;
  const endTime = addendumDoc.get('activityData').schedule[0].endTime;

  if (!startTime || !endTime) {
    return Promise.resolve();
  }

  const month = new Date(startTime).getMonth();
  const year = new Date(startTime).getFullYear();

  return rootCollections
    .inits
    .where('report', '==', 'expense claim')
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((expenseClaimInitDocsQuery) => {
      const ref = initDocRef(expenseClaimInitDocsQuery);
      const expenseClaimObject =
        getExpenseClaimObject(addendumDoc, expenseClaimInitDocsQuery);

      if (addendumDoc.get('activityData.schedule')[0].startTime) {
        expenseClaimObject[addendumDoc.get('activityId')]
          .expenseLocation = locals.placeInformation.identifier;
      }

      console.log('Ref:', ref.path);

      locals.batch.set(ref, {
        month,
        year,
        expenseClaimObject,
        report: 'expense claim',
        office: addendumDoc.get('activityData.office'),
        officeId: addendumDoc.get('activityData.officeId'),
      }, {
          merge: true,
        });

      return Promise.resolve();
    })
    .catch(console.error);
};


const handleLeaveReport = (addendumDoc, locals) => {
  // if (addendumDoc.get('template') !== 'leave') {
  //   return handleExpenseClaimReport(addendumDoc, locals);
  // }

  // run leave report logic

  // return handleExpenseClaimReport(addendumDoc, locals);

  return Promise.resolve();
};


const handleDutyRosterReport = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== 'duty roster') {
    // return handleLeaveReport(addendumDoc, locals);
    return Promise.resolve();
  }

  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');

  const startTime = addendumDoc.get('activityData.schedule')[0].startTime;
  const endTime = addendumDoc.get('activityData.schedule')[0].endTime;

  if (!startTime || !endTime) {
    return Promise.resolve();
  }

  const date = new Date(startTime);
  const month = date.getMonth();
  const year = date.getFullYear();

  return Promise
    .all([
      rootCollections
        .inits
        .where('report', '==', 'duty roster')
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
        = getDutyRosterObject(addendumDoc, dutyRosterInitDocsQuery);

      dutyRosterObject.assignees = assigneesSnapshot.docs.map((doc) => doc.id);

      locals.batch.set(ref, {
        month,
        year,
        office,
        officeId,
        dutyRosterObject,
        report: 'duty roster',
      }, {
          merge: true,
        });

      return Promise.resolve();
    })
    .catch(console.error);
};

const handleVisitDate = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== 'dsr'
    && addendumDoc.get('activityData.template') !== 'tour plan'
    || !addendumDoc.get('activityData.schedule')[0]) {
    console.log('In handleVisitDate: resolving early');

    return Promise.resolve();
  }

  const visitStartTime = addendumDoc.get('activityData.schedule')[0].startTime;
  const date = new Date(visitStartTime);
  const dateString = date.toDateString();

  return rootCollections
    .inits
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('report', '==', 'dsr')
    .where('dateString', '==', dateString)
    .limit(1)
    .get()
    .then((snapShot) => {
      const ref = initDocRef(snapShot);

      const docData = {
        dateString,
        report: 'dsr',
        month: date.getMonth(),
        year: date.getFullYear(),
        office: addendumDoc.get('activityData.office'),
        officeId: addendumDoc.get('activityData.officeId'),
        visitObject: getVisitObject(addendumDoc, snapShot, locals),
      };

      if (snapShot.empty) {
        docData.followUpObject = {};
      }

      console.log('visit:', ref.path);

      return ref.set(docData, { merge: true });
    })
    .catch(console.error);
};


const handleFollowUpDate = (addendumDoc, locals) => {
  if (addendumDoc.get('activityData.template') !== 'dsr'
    || !addendumDoc.get('activityData.schedule')[1]) {
    console.log('resolving early follow up');

    return Promise.resolve();
  }

  const followUpStartTime = addendumDoc.get('activityData.schedule')[1].startTime;
  const date = new Date(followUpStartTime);
  const dateString = date.toDateString();

  return rootCollections
    .inits
    .where('office', '==', addendumDoc.get('activityData.office'))
    .where('report', '==', 'dsr')
    .where('dateString', '==', dateString)
    .limit(1)
    .get()
    .then((snapShot) => {
      const ref = initDocRef(snapShot);

      const docData = {
        dateString,
        month: date.getMonth(),
        year: date.getFullYear(),
        office: addendumDoc.get('activityData.office'),
        officeId: addendumDoc.get('activityData.officeId'),
        report: 'dsr',
        followUpObject: getFollowUpObject(addendumDoc, snapShot),
      };

      if (snapShot.empty) docData.visitObject = {};

      console.log('follow up:', ref.path);

      return ref.set(docData, { merge: true });
    })
    .catch(console.error);
};


const handleDsr = (addendumDoc, locals) => {
  if (!new Set()
    .add('dsr')
    .add('tour plan')
    .has(addendumDoc.get('activityData.template'))) {
    return Promise.resolve();
  }

  return handleVisitDate(addendumDoc, locals)
    .then(() => handleFollowUpDate(addendumDoc, locals))
    .catch(console.error);
};


const handlePayrollReport = (addendumDoc, locals) => {
  const template = addendumDoc.get('activityData.template');

  if (!new Set()
    .add('leave')
    .add('check-in')
    .add('tour plan')
    .has(template)) {
    return Promise.resolve();
  }

  const office = addendumDoc.get('activityData.office');
  const officeId = addendumDoc.get('activityData.officeId');
  const timestamp = new Date(addendumDoc.get('timestamp'));

  const month = (() => {
    if (template === 'check-in') {
      return timestamp.getMonth();
    }

    const schedule = addendumDoc.get('activityData.schedule')[0];

    if (!schedule) return '';

    const startTime = addendumDoc.get('activityData.schedule')[0].startTime;

    if (!startTime) return '';

    return new Date(startTime).getMonth();
  })();

  const year = (() => {
    if (template === 'check-in') {
      return timestamp.getFullYear();
    }

    const schedule = addendumDoc.get('activityData.schedule')[0];
    if (!schedule) return '';
    const startTime = addendumDoc.get('activityData.schedule')[0].startTime;
    if (!startTime) return '';

    return new Date(startTime).getFullYear();
  })();

  if (!month || !year) {
    return Promise.resolve();
  }

  return rootCollections
    .inits
    .where('office', '==', office)
    .where('report', '==', 'payroll')
    .where('month', '==', month)
    .where('year', '==', year)
    .limit(1)
    .get()
    .then((payrollInitDocQuery) => {
      const ref = initDocRef(payrollInitDocQuery);

      locals.batch.set(ref, {
        office,
        officeId,
        month,
        year,
        report: 'payroll',
        payrollObject: getPayrollObject(addendumDoc, payrollInitDocQuery),
      }, {
          merge: true,
        });

      return handleDsr(addendumDoc, locals);
    })
    .catch(console.error);
};


module.exports = (addendumDoc) => {
  const phoneNumber = addendumDoc.get('user');
  const officeId = addendumDoc.get('activityData.officeId');
  const timestamp = new Date(addendumDoc.get('timestamp'));
  const locals = {
    batch: db.batch(),
  };

  return rootCollections
    .offices
    .doc(officeId)
    .collection('Addendum')
    .where('user', '==', phoneNumber)
    .where('dateString', '==', timestamp.toDateString())
    .orderBy('timestamp', 'desc')
    .limit(2)
    .get()
    .then((docs) => {
      // const previousAddendumDoc = docs.docs[1];

      const previousAddendumDoc = (() => {
        if (docs.docs[0] && docs.docs[0].id !== addendumDoc.id) {
          return docs.docs[0];
        }

        return docs.docs[1];
      })();

      /**
       * User has no activity before the creation of this
       * addendum doc. This means that the distance travelled
       * and accumulated will be `ZERO`.
       */
      const distance = (() => {
        if (!previousAddendumDoc) {
          return {
            accumulated: 0,
            travelled: 0,
          };
        }

        const geopointOne = previousAddendumDoc.get('location');
        const geopointTwo = addendumDoc.get('location');
        const distanceTravelled
          = haversineDistance(geopointOne, geopointTwo);
        const accumulatedDistance
          = Number(previousAddendumDoc.get('accumulatedDistance') || 0);

        return {
          accumulated: accumulatedDistance + distanceTravelled,
          travelled: distanceTravelled,
        };
      })();

      return Promise
        .all([
          googleMapsClient
            .reverseGeocode({
              latlng: getLatLngString(addendumDoc.get('location')),
            })
            .asPromise(),
          Promise
            .resolve(distance),
          Promise
            .resolve(previousAddendumDoc),
        ]);
    })
    .then((result) => {
      const [
        mapsApiResult,
        distance,
        previousAddendumDoc,
      ] = result;

      const placeInformation = getPlaceInformation(mapsApiResult);
      locals.placeInformation = placeInformation;

      const updateObject = {
        url: placeInformation.url,
        identifier: placeInformation.identifier,
        accumulatedDistance: distance.accumulated.toFixed(2),
        distanceTravelled: distance.travelled,
      };

      console.log({
        phoneNumber,
        updateObject,
        distance,
        previousAddendumDocExists: Boolean(previousAddendumDoc),
        currPath: addendumDoc.ref.path,
        prevPath: previousAddendumDoc ? previousAddendumDoc.ref.path : null,
      });

      locals.batch.set(addendumDoc.ref, updateObject, {
        merge: true,
      });

      return locals.batch;
    })
    .then(() => handlePayrollReport(addendumDoc, locals))
    .then(() => handleDsr(addendumDoc, locals))
    .then(() => handleDutyRosterReport(addendumDoc, locals))
    .then(() => handleLeaveReport(addendumDoc, locals))
    .then(() => handleExpenseClaimReport(addendumDoc, locals))
    .then(() => locals.batch.commit())
    .catch((error) => {
      console.error(error);

      const instantDocRef = rootCollections.instant.doc();

      console.log('crash id:', instantDocRef.id);

      const context = {
        error,
        addendumId: addendumDoc.id,
        doc: addendumDoc.data(),
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
