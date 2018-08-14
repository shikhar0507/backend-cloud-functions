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


const { rootCollections, serverTimestamp, } = require('../admin/admin');

const { code, } = require('../admin/responses');

const {
  handleError,
  sendResponse,
  sendJSON,
  isValidDate,
  getISO8601Date,
} = require('../admin/utils');


/**
 * Writes the log to `/DailyReads` about the user, timestamp and the
 * query string they provided in the request.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 * @returns {void}
 */
const updateDailyCollection = (conn, jsonResult) => {
  /** Anyone who sends the `from` query pram as `0`, must be
   * initializing the app first time, so this function logs
   * their request in `/DailyInits/(Date)/(phoneNumber)/(auto-id)`.
   */
  if (conn.req.query.from !== '0') {
    sendJSON(conn, jsonResult);

    return;
  }

  const timestamp = new Date();

  rootCollections
    .dailyInits
    .doc(getISO8601Date(timestamp))
    .collection(conn.requester.phoneNumber)
    .doc()
    .set({ timestamp: serverTimestamp, })
    .then(() => sendJSON(conn, jsonResult))
    .catch((error) => handleError(conn, error));
};


/**
 * Adds the `office` field to the template based on the document
 * where the subscription was found.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const addOfficeToTemplates = (conn, jsonResult, locals) => {
  jsonResult
    .templates
    .forEach((templateObject, index) =>
      templateObject.office = locals.officesArray[`${index}`]);

  updateDailyCollection(conn, jsonResult);
};


/**
 * Converts the `jsonResult.activities` object to an array in the
 * final response.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 * @description `Amardeep` was having problem parsing Activity objects
   * when they were inside an `Object`. This function is made on his request.
   * It takes each activity object and restructures it in order to push
   * them in an array.
 */
const mutateActivityToArray = (conn, jsonResult, locals) => {
  jsonResult.activitiesArr = [];
  let activityObj;

  Object
    .keys(jsonResult.activities)
    .forEach((activityId) => {
      activityObj = jsonResult.activities[`${activityId}`];
      activityObj.activityId = activityId;

      jsonResult.activitiesArr.push(activityObj);
    });

  jsonResult.activities = jsonResult.activitiesArr;

  /**
   * `jsonResult.activitiesArr` is temporary object for storing
   * the array with the activity objects. This object is not required
   * in the response body.
   */
  delete jsonResult.activitiesArr;

  addOfficeToTemplates(conn, jsonResult, locals);
};


/**
 * Fetches the template data for each template that the user has subscribed
 * to and adds that data to the jsonResult object.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const fetchSubscriptions = (conn, jsonResult, locals) =>
  Promise
    .all(locals.templatesList)
    .then((docs) => {
      docs.forEach((doc) => {
        if (!doc.exists) return;

        jsonResult.templates.push({
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          template: doc.get('name'),
          attachment: doc.get('attachment'),
        });
      });

      mutateActivityToArray(conn, jsonResult, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


/**
 * Fetches the template refs that the user has subscribed to.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const getTemplates = (conn, jsonResult, locals) =>
  rootCollections
    .profiles
    .doc(conn.requester.phoneNumber)
    .collection('Subscriptions')
    .where('timestamp', '>', locals.from)
    .where('timestamp', '<=', jsonResult.upto)
    .get()
    .then((docs) => {
      locals.templatesList = [];
      locals.officesArray = [];

      docs.forEach((doc) => {
        /** The `office` is required inside each template. */
        locals.officesArray.push(doc.get('office'));

        locals.templatesList.push(rootCollections
          .activityTemplates
          .doc(doc.get('template'))
          .get()
        );
      });

      fetchSubscriptions(conn, jsonResult, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


/**
 * Fetches the assignees of the activities.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const fetchAssignees = (conn, jsonResult, locals) =>
  Promise
    .all(locals.assigneeFetchPromises)
    .then((snapShots) => {
      snapShots.forEach((snapShot) => {
        snapShot.forEach((doc) => {
          /** Activity-id: `doc.ref.path.split('/')[1]` */
          const activityObj = jsonResult.activities[doc.ref.path.split('/')[1]];
          activityObj.assignees.push(doc.id);
        });
      });

      getTemplates(conn, jsonResult, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


const beautifySchedule = (schedules) => {
  const array = [];

  schedules.forEach((schedule) => {
    const name = schedule.name;
    const startTime = schedule.startTime.toDate();
    const endTime = schedule.endTime.toDate();

    array.push({ name, startTime, endTime, });
  });

  return array;
};

/**
 * Fetches all the activity data in which the user is an assignee of.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const fetchActivities = (conn, jsonResult, locals) =>
  Promise
    .all(locals.activityFetchPromises)
    .then((docs) => {
      docs.forEach((doc) => {
        /** Activity-id: doc.ref.path.split('/')[1] */
        const activityObj = jsonResult.activities[doc.id];
        const schedule = beautifySchedule(doc.get('schedule'));

        activityObj.schedule = schedule;
        activityObj.status = doc.get('status');
        activityObj.venue = doc.get('venue');
        activityObj.timestamp = doc.get('timestamp').toDate();
        activityObj.template = doc.get('template');
        activityObj.activityName = doc.get('activityName');
        activityObj.description = doc.get('description');
        activityObj.office = doc.get('office');
        /** Added further down the line. */
        activityObj.assignees = [];
        activityObj.attachment = doc.get('attachment');
      });

      fetchAssignees(conn, jsonResult, locals);

      return;
    })
    .catch((error) => handleError(conn, error));


/**
 * Fetches the list of activities from the user profile.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const getActivityIds = (conn, jsonResult, locals) => {
  locals.activityFetchPromises = [];
  locals.assigneeFetchPromises = [];

  rootCollections
    .profiles
    .doc(conn.requester.phoneNumber)
    .collection('Activities')
    .where('timestamp', '>', locals.from)
    .where('timestamp', '<=', jsonResult.upto)
    .get()
    .then((docs) => {
      docs.forEach((doc) => {
        locals.activityFetchPromises.push(
          rootCollections.activities.doc(doc.id).get()
        );

        locals.assigneeFetchPromises.push(
          rootCollections.activities.doc(doc.id).collection('Assignees').get()
        );

        jsonResult.activities[doc.id] = {};
        jsonResult.activities[doc.id]['canEdit'] = doc.get('canEdit');
      });

      fetchActivities(conn, jsonResult, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


/**
 * Fetches the `addendum` and adds them to a a temporary object in memory.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} locals Object containing local data.
 * @returns {void}
 */
const readAddendumByQuery = (conn, locals) => {
  const jsonResult = {
    addendum: [],
    activities: {},
    templates: [],
    from: locals.from,
    /** When  no docs are found in `Addendum` for the given timestamp,
     * the from and upto time will remain same.
     */
    upto: locals.from,
  };

  rootCollections
    .updates
    .doc(conn.requester.uid)
    .collection('Addendum')
    .where('timestamp', '>', locals.from)
    .orderBy('timestamp', 'asc')
    .get()
    .then((snapShot) => {
      if (snapShot.empty) {
        /** `activities` object is an array for the final response. */
        jsonResult.activities = [];

        /** Response ends here because addendum are empty. */
        sendJSON(conn, jsonResult);

        return;
      }

      snapShot.forEach((doc) => {
        jsonResult.addendum.push({
          addendumId: doc.id,
          activityId: doc.get('activityId'),
          comment: doc.get('comment'),
          timestamp: doc.get('userDeviceTimestamp').toDate(),
          location: doc.get('location'),
          user: doc.get('user'),
        });
      });

      jsonResult
        .upto = snapShot.docs[snapShot.size - 1].get('timestamp').toDate();

      getActivityIds(conn, jsonResult, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  if (conn.req.method !== 'GET') {
    sendResponse(
      conn,
      code.methodNotAllowed,
      `'${conn.req.method}' is not allowed for '/read'. Use 'GET'.`
    );

    return;
  }

  if (!conn.req.query.hasOwnProperty('from')) {
    sendResponse(
      conn,
      code.badRequest,
      `Missing the query param 'from' in the request URL.`
    );

    return;
  }

  if (!isValidDate(conn.req.query.from)) {
    sendResponse(
      conn,
      code.badRequest,
      `'${conn.req.query.from}' is not a valid unix timestamp.`
    );

    return;
  }

  /** Object to store local data during the cloud function instance. */
  const locals = {
    /**
     * Converting `from` query string to a date multiple times
     * is wasteful. Storing it here by calculating it once for use
     * throughout the instance.
     */
    from: new Date(parseInt(conn.req.query.from)),
  };

  readAddendumByQuery(conn, locals);
};
