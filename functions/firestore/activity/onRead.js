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

const getAllowedTemplates = (conn, jsonResult) => {
  profiles.doc(conn.creator.phoneNumber).collection('AllowedTemplates')
    .where('timestamp', '>=', getDateObject(conn.req.query.from)).get()
    .then((snapShot) => {
      snapShot.forEach((doc) => {
        jsonResult.allowedTemplates[
          `${doc.ref.path[0].split('/')[3]}`
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
    if (jsonResult.updates.hasOwnProperty(key)) {
      activitiesList.push(activities
        .where('timestamp', '>=', getDateObject(conn.req.query.from)).get());
    }
  }

  let activityId;

  Promise.all(activitiesList).then((snapShotsArray) => {
    snapShotsArray.forEach((snapShot) => {
      snapShot.forEach((doc) => {
        activityId = doc.ref.path.split('/')[1];

        jsonResult.updates[`${activityId}`] = {
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

    getAllowedTemplates(conn, jsonResult);
    return;
  }).catch((error) => handleError(conn, error));
};

const readAddendumsByQuery = (conn) => {
  const jsonResult = {};

  jsonResult.addendum = [];
  jsonResult.updates = {};
  jsonResult.allowedTemplates = {};

  // adding the 'from' timestamp to the listOfTimestamps in order to
  // avoid the situtation where the query inside the 'Addendum' collection
  // yeilds no results. Since we actually have to send at least a one date
  // to the client.
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

        // jsonResult.updates[`${doc.get('activityId')}`] = {};

        conn.listOfTimestamps.push(Date.parse(doc.get('timestamp')));
      });

      jsonResult.from = getDateObject(conn.req.query.from).toUTCString();
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
