const admin = require('../../admin/admin');
const utils = require('../../admin/utils');
const helpers = require('./helperLib');

const rootCollections = admin.rootCollections;
const users = admin.users;

const activities = rootCollections.activities;
const updates = rootCollections.updates;
const profiles = rootCollections.profiles;

const handleError = utils.handleError;
const sendResponse = utils.sendResponse;

const isValidDate = helpers.isValidDate;
const isValidString = helpers.isValidString;
const isValidLocation = helpers.isValidLocation;
const isValidPhoneNumber = helpers.isValidPhoneNumber;
const getDateObject = helpers.getDateObject;

const commitBatch = (conn) => {
  conn.batch.commit().then(() => sendResponse(conn, 204, 'NO CONTENT'))
    .catch((error) => handleError(conn, error));
};

const addAddendumForUsersWithAuth = (conn) => {
  conn.usersWithAuth.forEach((uid) => {
    conn.batch.set(updates.doc(uid).collection('Addendum').doc(), {
      activityId: conn.req.body.activityId,
      user: conn.creator.displayName || conn.creator.phoneNumber,
      comment: conn.req.body.comment,
      location: admin.getGeopointObject(
        conn.req.body.geopoint[0],
        conn.req.body.geopoint[1]
      ),
      timestamp: getDateObject(conn.req.body.timestamp),
      changes: [], // comment doesn't change the activity
    });
  });

  commitBatch(conn);
};

const queryUpdatesForAsigneesUid = (conn) => {
  const promises = [];
  conn.batch = admin.batch;

  conn.assigneesList.forEach((val) => {
    promises.push(updates.where('phoneNumber', '==', val).limit(1).get());
  });

  conn.usersWithAuth = [];

  Promise.all(promises).then((snapShotsArray) => {
    snapShotsArray.forEach((snapShot) => {
      if (!snapShot.empty) {
        conn.usersWithAuth.push(snapShot.docs[0].id);
      }
    });

    addAddendumForUsersWithAuth(conn);
    return;
  }).catch((error) => handleError(conn, error));
};

const getActivityAssignees = (conn) => {
  conn.assigneesList = [];

  activities.doc(conn.req.body.activityId).collection('AssignTo').get()
    .then((snapShot) => {
      snapShot.forEach((doc) => {
        conn.assigneesList.push(doc.id);
      });

      queryUpdatesForAsigneesUid(conn);
      return;
    }).catch((error) => handleError(conn, error));
};

const checkCommentPermission = (conn) => {
  profiles.doc(conn.creator.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists) {
        sendResponse(conn, 403, 'FORBIDDEN');
        return;
      }

      getActivityAssignees(conn);
      return;
    }).catch((error) => handleError(conn, error));
};

const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp) &&
    isValidLocation(conn.req.body.geopoint) &&
    isValidString(conn.req.body.activityId)) {
    checkCommentPermission(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

module.exports = app;
