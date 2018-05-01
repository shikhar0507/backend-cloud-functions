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

const handleError = utils.handleError;
const sendResponse = utils.sendResponse;
const handleCanEdit = helpers.handleCanEdit;
const isValidDate = helpers.isValidDate;
const isValidString = helpers.isValidString;
const isValidLocation = helpers.isValidLocation;
const isValidPhoneNumber = helpers.isValidPhoneNumber;
const getDateObject = helpers.getDateObject;
const scheduleCreator = helpers.scheduleCreator;
const venueCreator = helpers.venueCreator;


const commitBatch = (conn) => {
  conn.batch.commit().then(() => sendResponse(conn, 204, 'NO CONTENT'))
    .catch((error) => handleError(conn, error));
};


const writeActivityRoot = (conn, result) => {
  if (!conn.req.body.description) conn.req.body.description = '';

  conn.batch.set(activities.doc(conn.req.body.activityId), {
    title: conn.req.body.title || result[0].data().title,
    description: conn.req.body.description ||
      result[0].data().description,
    status: result[1].data().ACTIVITYSTATUS
      .indexOf(conn.req.body.status) > -1 ?
      conn.req.body.status : result[0].data().status,
    schedule: scheduleCreator(conn.req.body.schedule),
    venue: venueCreator(conn.req.body.schedule),
  }, {
      merge: true,
    });

  conn.batch.set(updates.doc(conn.creator.uid)
    .collection('Addendum').doc(), conn.addendumData);

  commitBatch(conn);
};


const addAddendumForUsersWithAuth = (conn, result) => {
  conn.usersWithAuth.forEach((uid) => {
    conn.batch.set(updates.doc(uid).collection('Addendum')
      .doc(), conn.addendumData);
  });

  writeActivityRoot(conn, result);
};


const processAsigneesList = (conn, result) => {
  if (Array.isArray(conn.req.body.deleteAssignTo)) {
    conn.req.body.deleteAssignTo.forEach((val) => {
      if (!isValidPhoneNumber(val)) return;

      conn.batch.delete(activities.doc(conn.req.body.activityId)
        .collection('AssignTo').doc(val));

      conn.batch.delete(profiles.doc(val).collection('Activities')
        .doc(conn.req.body.activityId));
    });
  }

  if (Array.isArray(conn.req.body.addAssignTo)) {
    conn.req.body.addAssignTo.forEach((val) => {
      if (!isValidPhoneNumber(val)) return;

      conn.activityAssignees.push(val);
    });
  }

  const promises = [];

  conn.activityAssignees.forEach((val) => {
    conn.batch.set(activities.doc(conn.req.body.activityId)
      .collection('AssignTo').doc(val), {
        canEdit: handleCanEdit(conn.templateData.canEditRule),
      });

    conn.batch.set(profiles.doc(val).collection('Activities')
      .doc(conn.req.body.activityId), {
        canEdit: handleCanEdit(conn.templateData.canEditRule),
        timestamp: getDateObject(conn.req.body.timestamp),
      });

    promises.push(updates.where('phoneNumber', '==', val).limit(1).get());
  });

  conn.usersWithAuth = [];

  Promise.all(promises).then((snapShotsArray) => {
    snapShotsArray.forEach((snapShot) => {
      if (!snapShot.empty) conn.usersWithAuth.push(snapShot.docs[0].id);
    });

    addAddendumForUsersWithAuth(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};


const getTemplateAndAssigneesFromActivity = (conn, result) => {
  const templateRef = activityTemplates.doc(result[0].get('template')).get();
  const assignToCollectionRef = activities.doc(conn.req.body.activityId)
    .collection('AssignTo').get();

  Promise.all([templateRef, assignToCollectionRef]).then((resultingData) => {
    conn.templateData = resultingData[0].data();

    if (!resultingData[1].empty) {
      conn.activityAssignees = [];
      // list of assignees inside the activity is not empty
      resultingData[1].forEach((doc) => {
        conn.activityAssignees.push(doc.id);
      });
    }

    conn.batch = admin.batch;

    conn.addendumData = {
      activityId: conn.req.body.activityId,
      user: conn.creator.displayName || conn.creator.phoneNumber,
      comment: `${conn.creator.displayName || conn.creator.phoneNumber}
        updated ${conn.templateData.name}`,
      location: admin.getGeopointObject(
        conn.req.body.geopoint[0],
        conn.req.body.geopoint[1]
      ),
      timestamp: getDateObject(conn.req.body.timestamp),
    };

    if (conn.req.body.addAssignTo || conn.req.body.deleteAssignTo) {
      processAsigneesList(conn, result);
    } else {
      writeActivityRoot(conn, result);
    }

    return;
  }).catch((error) => handleError(conn, error));
};


const fetchDocs = (conn) => {
  const activityRef = activities.doc(conn.req.body.activityId).get();
  const activityStatusRef = enums.doc('ACTIVITYSTATUS').get();

  Promise.all([activityRef, activityStatusRef]).then((result) => {
    if (!result[0].exists) {
      sendResponse(conn, 400, 'BAD REQUEST');
      return;
    }

    getTemplateAndAssigneesFromActivity(conn, result);
    return;
  }).catch((error) => {
    console.log(error);
    sendResponse(conn, 400, 'BAD REQUEST');
  });
};

const verifyPermissionToUpdateActivity = (conn) => {
  profiles.doc(conn.creator.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists) {
        sendResponse(conn, 403, 'FORBIDDEN');
        return;
      }

      doc.get('canEdit') ? fetchDocs(conn) :
        sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }).catch((error) => {
      handleError(conn, error);
    });
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp) &&
    isValidString(conn.req.body.activityId) &&
    isValidLocation(conn.req.body.geopoint)) {
    verifyPermissionToUpdateActivity(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

module.exports = app;
