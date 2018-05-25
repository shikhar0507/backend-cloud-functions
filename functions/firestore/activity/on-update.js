const {
  rootCollections,
  users,
  getGeopointObject,
  db,
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
  filterSchedules,
  filterVenues,
  attachmentCreator,
} = require('./helper');

const {
  code,
} = require('../../admin/responses');

const {
  activities,
  profiles,
  updates,
  enums,
  activityTemplates,
  offices,
} = rootCollections;

const commitBatch = (conn) => conn.batch.commit()
  .then((data) => sendResponse(
    conn,
    code.accepted,
    'The activity was successfully updated.',
    true
  )).catch((error) => handleError(conn, error));


const updateActivityDoc = (conn) => {
  conn.update.description = conn.req.body.description;

  if (!conn.update.description || typeof conn.update.description !== 'string') {
    conn.update.description = '';
  }

  conn.update.title = conn.req.body.title;

  if (!conn.update.title || typeof conn.update.title !== 'string') {
    conn.update.title = conn.req.body.description
      .substring(0, 30) || conn.data.template.get('defaultTitle');
  }

  if (conn.req.body.schedule) {
    conn.update.schedule = filterSchedules(
      conn.req.body.schedule,
      conn.data.activity.get('schedule')
    );
  }

  if (conn.req.body.venue) {
    conn.update.venue = filterVenues(
      conn.req.body.venue,
      conn.data.activity.get('venue')
    );
  }

  conn.update.timestamp = new Date(conn.req.body.timestamp);

  conn.batch.set(activities.doc(conn.req.body.activityId), conn.update, {
    merge: true,
  });

  commitBatch(conn);
};

const handleAttachment = (conn) => {
  /** do stuff */

  updateActivityDoc(conn);
};


const addAddendumForAssignees = (conn) => {
  Promise.all(conn.data.assigneesArray).then((snapShot) => {
    snapShot.forEach((doc) => {
      if (doc.get('uid')) {
        conn.batch.set(updates.doc(doc.get('uid'))
          .collection('Addendum').doc(), conn.addendum);
      }
    });

    /** Stores the objects that are to be updated in the activity root. */
    conn.update = {};

    if (conn.req.body.attachment) {
      handleAttachment(conn);
      return;
    }

    updateActivityDoc(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


const fetchTemplate = (conn) => {
  activityTemplates.doc(conn.data.activity.get('template')).get()
    .then((doc) => {
      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: conn.requester.displayName || conn.requester.phoneNumber +
          ' updated ' + doc.get('defaultTitle'),
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: new Date(conn.req.body.timestamp),
      };

      conn.data.template = doc;
      addAddendumForAssignees(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


const fetchDocs = (conn) => {
  Promise.all([
    activities.doc(conn.req.body.activityId).get(),
    activities.doc(conn.req.body.activityId).collection('Assignees').get(),
  ]).then((result) => {
    if (!result[0].exists) {
      /** This case should probably never execute becase there is provision
       * for deleting an activity anywhere. AND, for reaching the fetchDocs()
       * function, the check for the existance of the activity has already
       * been performed in the User's profile.
       */
      sendResponse(
        conn,
        code.conflict,
        `There is no activity with the id: ${conn.req.body.activityId}`,
        false
      );
      return;
    }

    conn.batch = db.batch();
    conn.data = {};
    conn.data.activity = result[0];

    conn.data.assigneesArray = [];

    result[1].forEach((doc) => {
      /** The assigneesArray is required to add addendum. */
      conn.data.assigneesArray.push(profiles.doc(doc.id).get());
    });

    fetchTemplate(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


const verifyEditPermission = (conn) => {
  profiles.doc(conn.requester.phoneNumber).collection('Activities')
    .doc(conn.req.body.activityId).get().then((doc) => {
      if (!doc.exists) {
        /** The activity doesn't exist for the user */
        sendResponse(
          conn,
          conn.forbidden,
          `An activity with the id: ${conn.req.body.activityId} doesn't exist.`,
          false
        );
        return;
      }

      if (!doc.get('canEdit')) {
        /** The canEdit flag is false so updating is not allowed */
        sendResponse(
          conn,
          code.forbidden,
          'You do not have the permission to edit this activity.',
          false
        );
        return;
      }

      fetchDocs(conn);
      return;
    }).catch((error) => handleError(conn, error));
};


const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp) &&
    isValidString(conn.req.body.activityId) &&
    isValidLocation(conn.req.body.geopoint)) {
    verifyEditPermission(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper' +
    ' values. Please make sure that the timestamp, activityId' +
    ' and the geopoint are included in the request with appropriate values.',
    false
  );
};


module.exports = app;
