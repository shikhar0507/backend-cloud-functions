const {
  users,
  rootCollections,
  batch,
} = require('../../admin/admin');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  isValidDate,
  isValidLocation,
  getDateObject,
  isValidString,
} = require('./helperLib');

const {
  activities,
  profiles,
  updates,
  activityTemplates,
} = rootCollections;


const fetchSubscriptions = (conn, jsonResult) => {
  Promise.all(conn.templatesList).then((snapShot) => {
    snapShot.forEach((doc) => {
      if (doc.exists) {
        // console.log(doc.ref.path.split('/')[1]);
        jsonResult.templates[doc.ref.path.split('/')[1]] = {
          schedule: doc.get('schedule'),
          venue: doc.get('venue'),
          template: doc.get('defaultTitle'),
          comment: doc.get('comment'),
          status: doc.get('statusOnCreate'),
        };
      }
    });

    conn.headers['Content-Type'] = 'application/json';
    conn.res.writeHead(200, conn.headers);
    conn.res.end(JSON.stringify(jsonResult));

    return;
  }).catch((error) => handleError(conn, error));
};

const getTemplates = (conn, jsonResult) => {
  profiles.doc(conn.creator.phoneNumber).collection('Subscriptions')
    .where('timestamp', '>=', getDateObject(conn.req.query.from))
    .get().then((snapShot) => {
      conn.templatesList = [];

      snapShot.forEach((doc) =>
        conn.templatesList.push(
          activityTemplates.doc(doc.get('template')).get())
      );

      fetchSubscriptions(conn, jsonResult);
      return;
    }).catch((error) => handleError(conn, error));
};

const addActivityRoot = (conn, jsonResult) => {
  const activitiesList = [];

  jsonResult.addendum.forEach((val) =>
    activitiesList.push(activities.doc(val.activityId).get()));

  Promise.all(activitiesList).then((snapShot) => {
    snapShot.forEach((doc) => {
      // doc.ref.path.split('/')[1]} --> activityId
      jsonResult.activities[`${doc.ref.path.split('/')[1]}`] = {
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

    getTemplates(conn, jsonResult);
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
  jsonResult.activities = {};
  jsonResult.templates = {};

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
