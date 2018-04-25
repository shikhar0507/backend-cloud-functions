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
const validateLocation = helpers.validateLocation;
const isValidString = helpers.isValidString;
const isValidDate = helpers.isValidDate;

const commitBatch = (conn) => {
  conn.batch.commit().then(() => {
    utils.sendResponse(conn, 204, '');
    return null;
  }).catch((error) => utils.handleError(conn, error));
};

const addActivityDataToBatch = (conn, result) => {
  if (conn.req.body.addAssignTo) {
    if (Array.isArray(conn.req.body.addAssignTo)) {
      conn.changes.add('AssignTo');
      conn.req.body.addAssignTo.forEach((val) => {
        if (!isValidString(val)) return;

        conn.batch.set(activities.doc(conn.req.body.activityId)
          .collection('AssignTo').doc(val), {
            // get a boolean true/false from the string 'true/'/'false'
            canEdit: handleCanEdit(conn.templateData.canEditRule),
          });
      });
    }
  }

  if (conn.req.body.title || conn.req.body.description ||
    conn.req.body.status) {
    // if either of these values have arrived in the request body, then
    // we can safely assume that Root has changed
    conn.changes.add('Root');
  }

  conn.batch.set(activities.doc(conn.req.body.activityId), {
    title: conn.req.body.title || result[0].data().title || '',
    description: conn.req.body.description ||
      result[0].get('description') || '',
    status: result[1].get('ACTIVITYSTATUS')
      .indexOf(conn.req.body.status) > -1 ?
      conn.req.body.status : result[0].get('status'),
    schedule: scheduleCreator(conn),
    venue: venueCreator(conn),
    lastUpdateTime: getDateObject(conn.req.body.updateTime),
  }, {
      merge: true,
    });

  conn.batch.set(activities.doc(conn.req.body.activityId)
    .collection('Addendum').doc(), {
      activityId: conn.req.body.activityId,
      user: rootCollections.profiles.doc(conn.phoneNumber).id,
      comment: `${conn.displayName || conn.phoneNumber
        || 'someone'} updated ${conn.templateData.name}`,
      location: admin.getGeopointObject(
        conn.req.body.updateLocation[0],
        conn.req.body.updateLocation[1]
      ),
      timestamp: helpers.getDateObject(conn.req.body.updateTime),
      changes: [...conn.changes], // name of collections that changed
    });

  commitBatch(conn);
};

const updateActivityWithBatch = (conn, result) => {
  conn.batch = admin.batch;
  conn.changes = new Set();

  if (conn.req.body.deleteAssignTo) {
    if (Array.isArray(conn.req.body.deleteAssignTo)) {
      conn.changes.add('AssignTo'); // assignTo changed
      conn.req.body.deleteAssignTo.forEach((val) => {
        conn.batch.delete(activities.doc(conn.req.body.activityId)
          .collection('AssignTo').doc(val));
      });
    }
  }

  // result[0] --> activity data
  rootCollections.templates.doc(result[0].get('template')).get()
    .then((doc) => {
      conn.templateData = doc.data();
      addActivityDataToBatch(conn, result);
      return null;
    }).catch((error) => handleError(conn, error));
};

const fetchDocs = (conn) => {
  const activityRef = activities.doc(conn.req.body.activityId).get();
  const activityStatusRef = rootCollections.enums.doc('ACTIVITYSTATUS').get();

  Promise.all([activityRef, activityStatusRef]).then((result) => {
    !result[0].exists ?
      sendResponse(conn, 400, 'BAD REQUEST'()) :
      updateActivityWithBatch(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};

const checkAssignToListInActivity = (conn) => {
  activities.doc(conn.req.body.activityId).collection('AssignTo')
    .doc(conn.phoneNumber).get().then((doc) => {
      if (!doc.exists) {
        sendResponse(conn, 401, 'UNAUTHORIZED');
      } else if (handleCanEdit(doc.get('canEdit'))) {
        fetchDocs(conn);
      }
      return null;
    }).catch((error) => handleError(conn, error));
};

const getPhoneNumberFromAuth = (conn) => {
  admin.manageUsers.getUserByUid(conn.uid).then((userRecord) => {
    conn.phoneNumber = stripPlusFromMobile(userRecord.phoneNumber);
    conn.displayName = userRecord.displayName;
    checkAssignToListInActivity(conn);
    return null;
  }).catch((error) => {
    console.log(error);
    sendResponse(conn, 401, 'UNAUTHORIZED');
  });
};


const app = (conn) => {
  if (validateLocation(conn.req.body.updateLocation)
    && isValidString(conn.req.body.activityId)
    && isValidDate(conn.req.body.updateTime)) {
    getPhoneNumberFromAuth(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

module.exports = app;
