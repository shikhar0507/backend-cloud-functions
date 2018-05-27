const {
  rootCollections,
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
} = require('./helper');

const {
  code,
} = require('../../admin/responses');

const {
  activities,
  profiles,
  updates,
  activityTemplates,
} = rootCollections;


const commitBatch = (conn) => conn.batch.commit()
  .then((data) => sendResponse(
    conn,
    code.accepted,
    'The activity was successfully updated.',
    true
  )).catch((error) => handleError(conn, error));


const updateActivityDoc = (conn) => {
  conn.batch.set(activities.doc(conn.req.body.activityId), {
    timestamp: new Date(conn.req.body.timestamp),
  }, {
    merge: true,
  });

  commitBatch(conn);
};

const setAddendumForUsersWithUid = (conn) => {
  const arrayWithoutDuplicates = Array.from(new Set(conn.data.assigneeArray));
  let promises = [];

  arrayWithoutDuplicates.forEach((phoneNumber) => {
    promises.push(profiles.doc(phoneNumber).get());
  });

  Promise.all(promises).then((snapShot) => {
    snapShot.forEach((doc) => {
      /** Create Profiles for the users who don't have a profile already. */
      if (!doc.exists) {
        /** doc.id is the phoneNumber that doesn't exist */
        conn.batch.set(profiles.doc(doc.id), {
          uid: null,
        });
      }

      if (doc.get('uid')) {
        /** uid is NOT null OR undefined */
        conn.batch.set(updates.doc(doc.get('uid')).collection('Addendum')
          .doc(), conn.addendum);
      }
    });

    updateActivityDoc(conn);
    return;
  }).catch((error) => handleError(conn, error));
};


const addAddendumForAssignees = (conn) => {
  conn.req.body.share.forEach((phoneNumber) => {
    if (!isValidPhoneNumber(phoneNumber)) return;

    /** Adding a doc with the id = phoneNumber in
     * Activities/(activityId)/Assignees
     * */
    conn.batch.set(activities.doc(conn.req.body.activityId)
      .collection('Assignees').doc(phoneNumber), {
        canEdit: handleCanEdit(
          conn.data.subscription.get('canEditRule'),
          phoneNumber,
          conn.requester.phoneNumber,
          conn.data.subscription.get('include')
        ),
      }, {
        merge: true,
      });

    /** Adding a doc with the id = activityId inside
     *  Profiles/(phoneNumber)/Activities/(activityId)
     * */
    conn.batch.set(profiles.doc(phoneNumber).collection('Activities')
      .doc(conn.req.body.activityId), {
        canEdit: handleCanEdit(
          conn.data.subscription.get('canEditRule'),
          phoneNumber,
          conn.requester.phoneNumber,
          conn.data.subscription.get('include')
        ),
        timestamp: new Date(conn.req.body.timestamp),
      }, {
        merge: true,
      });

    conn.data.assigneeArray.push(phoneNumber);
  });

  setAddendumForUsersWithUid(conn);
};


const fetchTemplateAndSubscriptions = (conn) => {
  Promise.all([
    activityTemplates.doc(conn.data.activity.get('template')).get(),
    profiles.doc(conn.requester.phoneNumber).collection('Subscriptions')
    .where('office', '==', conn.data.activity.get('office'))
    .where('template', '==', conn.data.activity.get('template'))
    .limit(1).get(),
  ]).then((docsArray) => {
    conn.addendum = {
      activityId: conn.req.body.activityId,
      user: conn.requester.displayName || conn.requester.phoneNumber,
      comment: conn.requester.displayName || conn.requester.phoneNumber +
        ' updated ' + docsArray[0].get('defaultTitle'),
      location: getGeopointObject(conn.req.body.geopoint),
      timestamp: new Date(conn.req.body.timestamp),
    };

    conn.data.template = docsArray[0];
    conn.data.subscription = docsArray[1].docs[0];

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
      /** This case should probably never execute becase there is NO provision
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
    conn.data.assigneeArray = [];

    /** The assigneeArray is required to add addendum. */
    result[1].forEach((doc) => {
      /** The doc.id is the phoneNumber of the assignee. */
      // conn.data.assigneeArray.push(profiles.doc(doc.id).get());
      conn.data.assigneeArray.push(doc.id);
    });

    fetchTemplateAndSubscriptions(conn);
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
    Array.isArray(conn.req.body.share) &&
    isValidLocation(conn.req.body.geopoint)) {
    verifyEditPermission(conn);
    return;
  }

  sendResponse(
    conn,
    code.badRequest,
    'The request body does not have all the necessary fields with proper' +
    ' values. Please make sure that the timestamp, activityId, geopoint' +
    ' and the assign array are included in the request body.',
    false
  );
};

module.exports = app;
