const commitBatch = (conn) => conn.batch.commit()
  .then((data) => sendResponse(
    conn,
    code.accepted,
    'The activity was successfully updated.'
  )).catch((error) => handleError(conn, error));


const addAddendumForAssignees = (conn) => {
  Promise.all(conn.data.Assignees).then((docsArray) => {
    docsArray.forEach((doc) => {
      if (doc.get(uid)) {
        conn.batch.set(updates.doc(doc.get(uid))
          .collection('Addendum').doc(), conn.addendum);
      }
    });

    commitBatch(conn);
    return;
  }).catch((error) => handleError(conn, error));
};

const updateActivityStatus = (conn) => {
  conn.batch.set(activities.doc(conn.req.body.activityId), {
    status: conn.req.body.status,
    timestamp: new Date(conn.req.body.timestamp),
  }, {
      merge: true,
    });

  addAddendumForAssignees(conn);
};

const fetchTemplate = (conn) => {
  activityTemplates.doc(conn.data.activity.get('template')).get()
    .then((doc) => {
      conn.data.template = doc;

      conn.addendum = {
        activityId: conn.req.body.activityId,
        user: conn.requester.displayName || conn.requester.phoneNumber,
        comment: conn.requester.displayName || conn.requester.phoneNumber
          + ' updated ' + conn.data.template.get('template'),
        location: getGeopointObject(conn.req.body.geopoint),
        timestamp: new Date(conn.req.body.timestamp),
      };

      updateActivityStatus(conn);

      return;
    }).catch((error) => handleError(conn, error));
};


const fetchDocs = (conn) => {
  Promise.all([
    activities.doc(conn.req.body.activityId).get(),
    activities.doc(conn.req.body.activityId).collection('Assignees').get(),
    enums.doc('ACTIVITYSTATUS').get(),
  ]).then((result) => {
    if (!result[1].exists) {
      /** This case should probably never execute becase there is provision
       * for deleting an activity anywhere. AND, for reaching the fetchDocs()
       * function, the check for the existance of the activity has already
       * been performed in the User's profile.
       */
      sendResponse(
        conn,
        code.conflict,
        `There is no activity with the id: ${conn.req.body.activityId}`
      );
      return;
    }

    conn.batch = db.batch();
    conn.data = {};

    conn.data.Assignees = [];

    /** The Assignees list is required to add addendum. */
    result[2].forEach((doc) =>
      conn.data.Assignees.push(profiles.doc(doc.id).get()));

    conn.data.statusEnum = result[3].get('ACTIVITYSTATUS');

    if (conn.data.statusEnum.indexOf(conn.req.body.status) === -1) {
      sendResponse(con, 400, 'Activity status sent in the request is invalid');
      return;
    }

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
          `An activity with the id: ${conn.req.body.activityId} does not exist.`
        );
        return;
      }

      if (!doc.get('canEdit')) {
        /** The canEdit flag is false so updating is not allowed */
        sendResponse(
          conn,
          code.forbidden,
          'You do not have the permission to edit this activity.'
        );
        return;
      }

      fetchDocs(conn);
      return;
    }).catch((error) => handleError(conn, error));
};

// share --> assign
const app = (conn) => {
  if (isValidDate(conn.req.body.timestamp)
    && isValidString(conn.req.body.activityId)
    && isValidString(conn.req.body.status)
    && isValidLocation(conn.req.body.geopoint)) {
    verifyPermissionToUpdateActivity(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper'
    + ' values. Please make sure that the timestamp, activityId'
    + ' and the geopoint are included in the request with appropriate values.'
  );
};


module.exports = app;
