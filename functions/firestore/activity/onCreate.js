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
const handleCanEdit = helpers.handleCanEdit;
const isValidDate = helpers.isValidDate;
const isValidString = helpers.isValidString;
const isValidPhoneNumber = helpers.isValidPhoneNumber;
const isValidLocation = helpers.isValidLocation;
const getDateObject = helpers.getDateObject;
const scheduleCreator = helpers.scheduleCreator;
const venueCreator = helpers.venueCreator;


/**
 * Commits the batch and sends a response to the client.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 */
const commitBatch = (conn) => {
  conn.batch.commit().then(() => sendResponse(conn, 201, 'CREATED'))
    .catch((error) => handleError(conn, error));
};


/**
 * Adds Addendum for each user who has their document inside the Updates
 * collection in the database.
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} result Contains the fetched documents from Firestore.
 */
const addAddendumForUsersWithAuth = (conn, result) => {
  conn.usersWithAuth.forEach((uid) => {
    conn.batch.set(updates.doc(uid).collection('Addendum')
      .doc(), conn.addendumData);
  });

  commitBatch(conn);
};

/**
 *
 * @param {Object} conn Contains Express' Request and Respone objects.
 * @param {Object} result Contains the fetched documents from Firestore.
 */
const handleAssignedUsers = (conn, result) => {
  const promises = [];

  // create docs in AssignTo collection if assignTo is in the reqeuest body
  conn.req.body.assignTo.forEach((val) => {
    // TODO: add a method for verifying a valid mobile
    if (!isValidPhoneNumber(val)) return;

    conn.batch.set(activities.doc(conn.activityId)
      .collection('AssignTo').doc(val), {
        // template --> result[1].data()
        canEdit: handleCanEdit(result[1].get('canEditRule')),
      }, {
        merge: true,
      });

    // phone numbers exist uniquely in the db
    promises.push(updates.where('phoneNumber', '==', val).limit(1).get());

    conn.batch.set(profiles.doc(val).collection('Activities')
      .doc(conn.activityId), {
        canEdit: handleCanEdit(result[1].get('canEditRule')),
        timestamp: getDateObject(conn.req.body.timestamp),
      });
  });

  conn.usersWithAuth = [];

  // getting the docs which have uids inside /Updates
  Promise.all(promises).then((snapShotsArray) => {
    snapShotsArray.forEach((snapShot) => {
      if (!snapShot.empty) conn.usersWithAuth.push(snapShot.docs[0].id);
    });

    addAddendumForUsersWithAuth(conn, result);
    return;
  }).catch((error) => handleError(conn, error));
};

const createActivity = (conn, result) => {
  conn.batch = admin.batch;

  const activityRef = activities.doc();
  conn.activityId = activityRef.id; // used multiple times

  if (!conn.req.body.description) conn.req.body.description = '';

  conn.batch.set(activityRef, {
    title: conn.req.body.title || conn.req.body.description
      .substring(0, 30) || result[1].get('defaultTitle'),
    description: conn.req.body.description,
    status: result[0].get('statusOnCreate'),
    office: conn.req.body.officeId,
    template: conn.req.body.templateId,
    schedule: scheduleCreator(conn.req.body.schedule),
    venue: venueCreator(conn.req.body.venue),
    timestamp: getDateObject(conn.req.body.timestamp),
    attachment: null,
  });

  conn.addendumData = {
    activityId: conn.activityId,
    user: conn.creator.displayName || conn.creator.phoneNumber,
    comment: `${conn.creator.displayName || conn.creator.phoneNumber}
      created ${result[0].get('name')}`,
    location: admin.getGeopointObject(
      conn.req.body.geopoint[0],
      conn.req.body.geopoint[1]
    ),
    timestamp: getDateObject(conn.req.body.timestamp),
  };

  result[2].get('autoIncludeOnCreate').forEach((val) => {
    conn.batch.set(activities.doc(conn.activityId)
      .collection('AssignTo').doc(val), {
        canEdit: handleCanEdit(result[0].get('canEditRule')),
      });
  });

  Array.isArray(conn.req.body.assignTo)
    ? handleAssignedUsers(conn, result) : commitBatch(conn);
};


const fetchDocs = (conn) => {
  const promises = [];

  promises.push(activityTemplates.doc(conn.req.body.templateId).get());
  promises.push(profiles.doc(conn.creator.phoneNumber).get());
  promises.push(profiles.doc(conn.creator.phoneNumber)
    .collection('Subscriptions').doc('subscriptions')
    .collection('personal').doc(conn.req.body.officeId).get());

  Promise.all(promises).then((result) => {
    // template sent in the request body is not a valid type
    if (!result[0].exists) {
      sendResponse(conn, 400, 'BAD REQUEST');
      return;
    }

    if (!result[1].exists || !result[2].exists) {
      // profile doesn't exist
      // OR
      // the requester is not allowed to create an activity
      // with the requested template
      sendResponse(conn, 403, 'FORBIDDEN');
      return;
    }

    createActivity(conn, result);
    return;
  }).catch((error) => {
    console.log(error);
    sendResponse(conn, 400, 'BAD REQUEST');
  });
};

const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp) &&
    isValidString(conn.req.body.templateId) &&
    isValidLocation(conn.req.body.geopoint)) {
    fetchDocs(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

module.exports = app;
