const admin = require('../../admin/admin');
const utils = require('../../admin/utils');
const helpers = require('./helperLib');

const rootCollections = admin.rootCollections;
const users = admin.users;

const activities = rootCollections.activities;
const profiles = rootCollections.profiles;
const updates = rootCollections.updates;

const handleError = utils.handleError;
const sendResponse = utils.sendResponse;

const isValidDate = helpers.isValidDate;
const isValidString = helpers.isValidString;
const isValidLocation = helpers.isValidLocation;
const getDateObject = helpers.getDateObject;

const getSubscriptions = (conn, jsonResult) => {
  profiles.doc(conn.creator.phoneNumber).collection('Subscriptions')
    .doc('subscriptions').collection('Personal')
    .where('timestamp', '>=', getDateObject(conn.req.query.from))
    .get().then((snapShot) => {
      snapShot.forEach((doc) => {
        // Profiles/+918178135274/Subscriptions/subscriptions/Personal
        // doc.ref.path.split('/')[5]/doc.ref.path.split('/')[6]: personal/plan
        // TODO: verify if this structure is correct.
        jsonResult.subscriptions[
          `${doc.ref.path[0].split('/')[5]} / ${doc.ref.path[0].split('/')[6]}`
        ] = doc.get('template');
      });

      conn.headers['Content-Type'] = 'application/json';
      conn.res.writeHead(200, conn.headers);
      conn.res.end(JSON.stringify(jsonResult));

      return;
    }).catch((error) => handleError(conn, error));
};

const addActivityRoot = (conn, jsonResult) => {
  const activitiesList = [];

  for (key in jsonResult.updates) {
    // skip iteration for inherited properties for the jsonResult object
    if (jsonResult.updates.hasOwnProperty(key)) {
      activitiesList.push(activities
        .where('timestamp', '>=', getDateObject(conn.req.query.from)).get());
    }
  }

  Promise.all(activitiesList).then((snapShotsArray) => {
    snapShotsArray.forEach((snapShot) => {
      snapShot.forEach((doc) => {
        // doc.ref.path.split('/')[1] ==> activity-id
        jsonResult.updates[`${doc.ref.path.split('/')[1]}`] = {
          status: doc.get('status'),
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          timestamp: doc.get('timestamp').toUTCString(),
          template: doc.get('template'),
          title: doc.get('title'),
          description: doc.get('description'),
          office: doc.get('office'),
        };
      });
    });

    getSubscriptions(conn, jsonResult);
    return;
  }).catch((error) => handleError(conn, error));
};

/**
 * Fetches the addendums and adds them to a a temporary object in memory.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const readAddendumsByQuery = (conn) => {
  const jsonResult = {};

  jsonResult.addendum = [];
  jsonResult.updates = {};
  jsonResult.subscriptions = {};

  /** adding the 'from' timestamp to the listOfTimestamps in order to
  avoid the situtation where the query inside the 'Addendum' collection
  yeilds no results. Since we actually have to send at least a one date
  to the client. **/
  conn.listOfTimestamps = [Date.parse(conn.req.query.from)];

  updates.doc(conn.creator.uid).collection('Addendum')
    .where('timestamp', '>=', getDateObject(conn.req.query.from)).get()
    .then((snapShot) => {
      snapShot.forEach((doc) => {
        jsonResult.addendum.push({
          activityId: doc.get('activityId'),
          comment: doc.get('comment'),
          timestamp: doc.get('timestamp').toUTCString(),
          location: [
            doc.get('location')._latitude,
            doc.get('location')._longitude,
          ],
          user: doc.get('user'),
        });

        conn.listOfTimestamps.push(Date.parse(doc.get('timestamp')));
      });

      jsonResult.from = new Date(conn.req.query.from).toUTCString();
      jsonResult.upto = new Date(Math.max(...conn.listOfTimestamps))
        .toUTCString();

      addActivityRoot(conn, jsonResult);
      return;
    }).catch((error) => handleError(conn, error));
};

const app = (conn) => {
  if (!isValidDate(conn.req.query.from)) {
    sendResponse(conn, 400, 'BAD REQUEST');
    return;
  }

  readAddendumsByQuery(conn);
};

module.exports = app;
