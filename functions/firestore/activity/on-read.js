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


const {
  rootCollections,
} = require('../../admin/admin');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  isValidDate,
} = require('./helper');

const {
  code,
} = require('../../admin/responses');

const {
  activities,
  profiles,
  updates,
  activityTemplates,
} = rootCollections;


/**
 * Ends the response by sending the JSON to the client.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 */
const sendJSON = (conn, jsonResult) => {
  conn.headers['Content-Type'] = 'application/json';
  conn.res.writeHead(code.ok, conn.headers);
  conn.res.end(JSON.stringify(jsonResult));
};


/**
 * Converts the jsonResult.activities object to an array in the final response.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 */
const convertActivityObjectToArray = (conn, jsonResult) => {
  jsonResult.activitiesArr = [];
  let activityObj;

  Object.keys(jsonResult.activities).forEach((activityId) => {
    activityObj = jsonResult.activities[activityId];

    jsonResult.activitiesArr.push({
      activityId,
      canEdit: activityObj.canEdit,
      schedule: activityObj.schedule,
      venue: activityObj.venue,
      timestamp: activityObj.timestamp,
      template: activityObj.template,
      title: activityObj.title,
      description: activityObj.description,
      office: activityObj.office,
      assignees: activityObj.assignees,
      attachment: activityObj.attachment,
    });
  });

  jsonResult.activities = jsonResult.activitiesArr;

  /** jsonResult.activitiesArr is temporary object for storing
   * the array with the activity objects. This is not in the final
   * response.
   */
  delete jsonResult.activitiesArr;

  sendJSON(conn, jsonResult);
};


/**
 * Fetches the template data for each template that the user has subscribed
 * to and adds that data to the jsonResult object.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 */
const fetchSubscriptions = (conn, jsonResult) => {
  Promise.all(conn.templatesList).then((snapShot) => {
    snapShot.forEach((doc) => {
      if (doc.exists) {
        jsonResult.templates.push({
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          template: doc.get('defaultTitle'),
          office: doc.get('office'),
          status: doc.get('statusOnCreate'),
          attachment: doc.get('attachment') || null,
        });
      }
    });

    convertActivityObjectToArray(conn, jsonResult);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the template refs that the user has subscribed to.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {*Object} jsonResult The fetched data from Firestore.
 */
const getTemplates = (conn, jsonResult) => {
  profiles.doc(conn.requester.phoneNumber).collection('Subscriptions')
    .where('timestamp', '>', conn.from)
    .where('timestamp', '<=', jsonResult.upto)
    .get().then((snapShot) => {
      conn.templatesList = [];

      snapShot.forEach((doc) => {
        conn.templatesList.push(
          activityTemplates.doc(doc.get('template')).get()
        );
      });

      fetchSubscriptions(conn, jsonResult);
      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the assignees of the activities.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 */
const fetchAssignees = (conn, jsonResult) => {
  Promise.all(conn.assigneeFetchPromises).then((snapShotsArray) => {
    let activityObj;

    snapShotsArray.forEach((snapShot) => {
      snapShot.forEach((doc) => {
        // activity-id --> doc.ref.path.split('/')[1]
        activityObj = jsonResult.activities[doc.ref.path.split('/')[1]];
        activityObj.assignees.push(doc.id);
      });
    });

    getTemplates(conn, jsonResult);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 *  Fetches all the attachments using the activity root docRef field.
 *
 * @param {Object} conn Contains Express Request and Response Objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 */
const fetchAttachments = (conn, jsonResult) => {
  Promise.all(conn.docRefsArray).then((snapShots) => {
    snapShots.forEach((doc) => {
      if (doc.exists) {
        jsonResult.activities[doc.get('activityId')].attachment = doc.data();
      }
    });

    fetchAssignees(conn, jsonResult);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Fetches all the activity data in which the user is an assignee of.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 */
const fetchActivities = (conn, jsonResult) => {
  Promise.all(conn.activityFetchPromises).then((snapShot) => {
    let activityObj;
    conn.docRefsArray = [];

    snapShot.forEach((doc) => {
      activityId = doc.ref.path.split('/')[1];

      activityObj = jsonResult.activities[doc.ref.path.split('/')[1]];

      activityObj.status = doc.get('status');
      activityObj.schedule = doc.get('schedule');
      activityObj.venue = doc.get('venue');
      activityObj.timestamp = doc.get('timestamp');
      activityObj.template = doc.get('template');
      activityObj.title = doc.get('title');
      activityObj.description = doc.get('description');
      activityObj.office = doc.get('office');
      activityObj.assignees = [];
      activityObj.attachment = {};

      if (doc.get('docRef')) {
        conn.docRefsArray.push(doc.get('docRef').get());
      }
    });

    fetchAttachments(conn, jsonResult);
    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the list of activities from the user profile.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 * @param {Object} jsonResult The fetched data from Firestore.
 */
const getActivityIdsFromProfileCollection = (conn, jsonResult) => {
  conn.activityFetchPromises = [];
  conn.assigneeFetchPromises = [];
  conn.activityData = {};

  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .where('timestamp', '>', conn.from)
    .where('timestamp', '<=', jsonResult.upto).get().then((snapShot) => {
      snapShot.forEach((doc) => {
        conn.activityFetchPromises.push(activities.doc(doc.id).get());
        conn.assigneeFetchPromises
          .push(activities.doc(doc.id).collection('Assignees').get());

        jsonResult.activities[doc.id] = {};
        jsonResult.activities[doc.id]['canEdit'] = doc.get('canEdit');
      });

      fetchActivities(conn, jsonResult);
      return;
    }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the addendums and adds them to a a temporary object in memory.
 *
 * @param {Object} conn Contains Express' Request and Response objects.
 */
const readAddendumsByQuery = (conn) => {
  const jsonResult = {};

  jsonResult.addendum = [];
  jsonResult.activities = {};
  jsonResult.templates = [];
  jsonResult.from = conn.from;
  jsonResult.upto = jsonResult.from; /** when  no docs are found in Addendum */

  updates.doc(conn.requester.uid).collection('Addendum')
    .where('timestamp', '>', conn.from)
    .orderBy('timestamp', 'asc').get().then((snapShot) => {
      snapShot.forEach((doc) => {
        jsonResult.addendum.push({
          activityId: doc.get('activityId'),
          comment: doc.get('comment'),
          timestamp: doc.get('timestamp'),
          location: doc.get('location'),
          user: doc.get('user'),
        });
      }); // forEach end

      if (!snapShot.empty) {
        /** timestamp value of the last addendum sorted on timestamp */
        jsonResult.upto = snapShot.docs[snapShot.size - 1].get('timestamp');
      }

      getActivityIdsFromProfileCollection(conn, jsonResult);
      return;
    }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (!isValidDate(conn.req.query.from)) {
    sendResponse(
      conn,
      code.badRequest,
      conn.req.query.from + ' is not a valid timestamp'
    );
    return;
  }

  conn.from = new Date(parseInt(conn.req.query.from));
  readAddendumsByQuery(conn);
};

module.exports = app;
