/** {
  "activityId": "6EDaPe5BNjcJ0qQKLCg1",
  "timestamp": 1522598642000,
  "geopoint": [80.2333, 30.3434],
  "title": "new updated title",
  "description": "new changed description",
  "status": "new status ",
  "deleteAssignTo": [
      "Drs69n0jAkEPZqSsrQGf",
      "clLv762LgYskWbvVe5rR"
  ],
  "addAssignTo": [
      "wu1zOnEcNqJFTndBYxH4",
      "rrrPpzHNz5sDU3wOIzJ5"
  ]
}*/

const {
  rootCollections,
  users,
  batch,
  getGeopointObject,
} = require('../../admin/admin');

const {
  handleError,
  sendResponse,
} = require('../../admin/utils');

const {
  handleCanEdit,
  isValidDate,
  isValidString,
  isValidLocation,
  isValidPhoneNumber,
  scheduleCreator,
  venueCreator,
} = require('./helperLib');

const {
  activities,
  profiles,
  updates,
  enums,
  activityTemplates,
} = rootCollections;

/**
 * Commits the batch and sends a response to the client of the result.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const commitBatch = (conn) => batch.commit()
  .then((data) => sendResponse(conn, 202, 'ACCEPTED'))
  .catch((error) => handleError(conn, error));

/**
 * Adds the activity root data to the batch.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
const writeActivityRoot = (conn, result) => {
  if (!conn.req.body.description) conn.req.body.description = '';

  batch.set(activities.doc(conn.req.body.activityId), {
    title: conn.req.body.title || result[0].data().title,
    description: conn.req.body.description ||
      result[0].data().description,
    status: result[1].data().ACTIVITYSTATUS
      .indexOf(conn.req.body.status) > -1 ?
      conn.req.body.status : result[0].get('status'),
    schedule: scheduleCreator(
      conn.req.body.schedule,
      conn.templateData.schedule
    ),
    venue: venueCreator(
      conn.req.body.schedule,
      conn.templateData.venue
    ),
    timestamp: new Date(conn.req.body.timestamp),
  }, {
    merge: true,
  });

  batch.set(updates.doc(conn.requester.uid)
    .collection('Addendum').doc(), conn.addendumData);

  commitBatch(conn);
};


/**
 * Handles the document creation in /Profiles and addition of new documents in
 * /Updates/<uid>/Activities collection for the assigned users of the acivity.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
const processAsigneesList = (conn, result) => {
  if (Array.isArray(conn.req.body.deleteAssignTo)) {
    conn.req.body.deleteAssignTo.forEach((val) => {
      if (!isValidPhoneNumber(val)) return;

      batch.delete(activities.doc(conn.req.body.activityId)
        .collection('AssignTo').doc(val));

      batch.delete(profiles.doc(val).collection('Activities')
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
    batch.set(activities.doc(conn.req.body.activityId)
      .collection('AssignTo').doc(val), {
        canEdit: handleCanEdit(conn.templateData.canEditRule),
      });

    batch.set(profiles.doc(val).collection('Activities')
      .doc(conn.req.body.activityId), {
        canEdit: handleCanEdit(conn.templateData.canEditRule),
        timestamp: new Date(conn.req.body.timestamp),
      });

    promises.push(profiles.doc(val).get());
  });

  conn.usersWithAuth = [];

  Promise.all(promises).then((snapShots) => {
    snapShots.forEach((doc) => {
      if (doc.exists && doc.get('uid') !== null) {
        batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), conn.addendumData);
      }
    });

    writeActivityRoot(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};

/**
 * Fetches the assignees list and the template from the Activity in context.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Array} result Array of document data objects fetched from Firestore.
 */
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

    conn.addendumData = {
      activityId: conn.req.body.activityId,
      user: conn.requester.displayName || conn.requester.phoneNumber,
      comment: `${conn.requester.displayName || conn.requester.phoneNumber}
        updated ${conn.templateData.name}`,
      location: getGeopointObject(
        conn.req.body.geopoint[0],
        conn.req.body.geopoint[1]
      ),
      timestamp: new Date(conn.req.body.timestamp),
    };

    if (conn.req.body.addAssignTo || conn.req.body.deleteAssignTo) {
      processAsigneesList(conn, result);
    } else {
      writeActivityRoot(conn, result);
    }

    return;
  }).catch((error) => handleError(conn, error));
};


/**
 * Fetches the activtiy root and enum/activitytemplates doc.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const fetchDocs = (conn) => {
  const activityRef = activities.doc(conn.req.body.activityId).get();
  const activityStatusRef = enums.doc('ACTIVITYSTATUS').get();

  Promise.all([activityRef, activityStatusRef]).then((result) => {
    if (!result[0].exists) {
      // the activity-id in the request doesn't exist in the db
      sendResponse(conn, 409, 'CONFLICT');
      return;
    }

    getTemplateAndAssigneesFromActivity(conn, result);
    return;
  }).catch((error) => {
    console.log(error);
    sendResponse(conn, 400, 'BAD REQUEST');
  });
};

/**
 * Checks whether the user has the permission to update the activity.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const verifyPermissionToUpdateActivity = (conn) => {
  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists) {
        // TODO: forbidden or bad request???
        sendResponse(conn, 403, 'FORBIDDEN');
        return;
      }

      // along with having a document in /AssignTo collection,
      // the user must also have the permission to edit the activity.
      doc.get('canEdit') ? fetchDocs(conn) :
        sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }).catch((error) => handleError(conn, error));
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
