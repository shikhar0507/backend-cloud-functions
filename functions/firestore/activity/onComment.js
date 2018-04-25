const admin = require('../../admin/admin');
const utils = require('../../admin/utils');
const helpers = require('./helpers');

const rootCollections = admin.rootCollections;
const activities = rootCollections.activities;

const sendResponse = utils.sendResponse;
const handleError = utils.handleError;
const handleCanEdit = helpers.handleCanEdit;
const getDateObject = helpers.getDateObject;
const scheduleCreator = helpers.scheduleCreator;
const venueCreator = helpers.venueCreator;
const stripPlusFromMobile = helpers.stripPlusFromMobile;
const isValidLocation = helpers.isValidLocation;
const isValidString = helpers.isValidString;
const isValidDate = helpers.isValidDate;

const commitBatch = (conn) => {
  batch.commit().then(() => {
    sendResponse(conn, 201, 'CREATED');
    return null;
  }).catch((error) => handleError(conn, error));
};

const addCommentToActivity = (conn) => {
  const batch = admin.batch;

  batch.set(activities.doc(conn.req.body.activityId), {
    lastUpdateTime: getDateObject(conn.req.body.updateTime),
  }, {
      merge: true,
    });

  batch.set(activities.doc(conn.req.body.activityId)
    .collection('Addendum').doc(), {
      activityId: conn.req.body.activityId,
      user: admin.rootCollections.profiles.doc(conn.phoneNumber).id,
      comment: conn.req.body.comment,
      location: admin.getGeopointObject(
        conn.req.body.updateLocation[0],
        conn.req.body.updateLocation[1]
      ),
      timestamp: getDateObject(conn.req.body.updateTime),
      changes: [], // comment doesn't change the activity
    });

  commitBatch(conn);
};

const checkAssignToList = (conn) => {
  activities.doc(conn.req.body.activityId).collection('AssignTo')
    .doc(conn.phoneNumber).get().then((doc) => {
      doc.exists ? addCommentToActivity(conn) :
        sendResponse(conn, 401, 'UNAUTHORIZED');
      return null;
    }).catch((error) => handleError(conn, error));
};

const getMobileNumber = (conn) => {
  admin.manageUsers.getUserByUid(conn.uid).then((userRecord) => {
    conn.phoneNumber = stripPlusFromMobile(userRecord.phoneNumber);
    checkAssignToList(conn);
    return null;
  }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.updateTime)
    && isValidLocation(conn.req.body.updateLocation)
    && isValidString(conn.req.body.activityId)
    && isValidDate(conn.req.body.comment)) {
    getMobileNumber(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

module.exports = app;
