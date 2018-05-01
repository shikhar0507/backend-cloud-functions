const admin = require('../../admin/admin');
const utils = require('../../admin/utils');
const helpers = require('./helperLib');

const rootCollections = admin.rootCollections;
const users = admin.users;

const activities = rootCollections.activities;
const profiles = rootCollections.profiles;
const updates = rootCollections.updates;
const enums = rootCollections.enum; // 'enum' is a reserved word
const activityTemplates = rootCollections.activityTemplates;
const offices = rootCollections.offices;

const handleError = utils.handleError;
const sendResponse = utils.sendResponse;

const isValidDate = helpers.isValidDate;
const isValidString = helpers.isValidString;
const isValidLocation = helpers.isValidLocation;
const getDateObject = helpers.getDateObject;

const getAllowedTemplates = (conn, jsonResult) => {

  profiles.doc(conn.creator.phoneNumber).collection('AllowedTemplates').get()
    .then((snapShot) => {
      snapShot.docs.forEach((doc, index) => {
        jsonResult.allowedTemplates[`${index}`] = doc.get('template');
      });

      conn.headers['Content-Type'] = 'application/json';
      conn.res.writeHead(200, conn.headers);
      conn.res.end(JSON.stringify(jsonResult));
    }).catch((error) => handleError(conn, error));
};

const addActivityRoot = (conn, jsonResult) => {
  const promises = [];

  for (key in jsonResult.updates) {
    if (jsonResult.updates.hasOwnProperty(key)) {
      promises.push(activities.doc(key).get());
    }
  }

  Promise.all(promises).then((result) => {
    result.forEach((val) => {
      jsonResult.updates[`${val.ref.path.split('/')[1]}`] = {
        status: val.get('status'),
        schedule: val.get('schedule'),
        venue: val.get('venue'),
        timestamp: val.get('timestamp').toUTCString(),
        template: val.get('template'),
        title: val.get('title'),
        description: val.get('description'),
        office: val.get('office'),
      }
    });

    getAllowedTemplates(conn, jsonResult);
    return;
  }).catch((error) => handleError(conn, error));
};

const readAddendumsByQuery = (conn) => {
  const jsonResult = {};

  // adding readFrom timestamp to the listOfTimestamps in order to
  // avoid the situtation where the query inside the 'Addendum' collection
  // yeilds no results. Since we actually have to send at least a single date
  // to the client.
  conn.listOfTimestamps = [Date.parse(conn.req.query.from)];

  jsonResult.addendum = {};
  jsonResult.updates = {};
  jsonResult.allowedTemplates = {};

  updates.doc(conn.creator.uid).collection('Addendum')
    .where('timestamp', '>=', getDateObject(conn.req.query.from))
    .orderBy('timestamp', 'asc').get().then((snapShot) => {
      snapShot.docs.forEach((doc, index) => {
        jsonResult.addendum[index] = {
          activityId: doc.get('activityId'),
          comment: doc.get('comment'),
          timestamp: doc.get('timestamp').toUTCString(),
          location: [
            doc.get('location')._latitude,
            doc.get('location')._longitude,
          ],
          user: doc.get('user'),
        };

        jsonResult.updates[`${doc.get('activityId')}`] = {};

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
