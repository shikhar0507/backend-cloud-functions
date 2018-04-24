const admin = require('../../admin/admin');
const utils = require('../../admin/utils');

const addCommentToActivity = (conn) => {
  const batch = admin.batch;

  batch.set(admin.rootCollections.activities.doc(conn.req.body.activityId), {
    lastUpdateTime: new Date(new Date(conn.req.body.updateTime)
      .toUTCString()),
  }, {
    merge: true,
  });

  batch.set(admin.rootCollections.activities.doc(conn.req.body.activityId)
    .collection('Addendum').doc(), {
      activityId: conn.req.body.activityId,
      user: admin.rootCollections.profiles.doc(conn.phoneNumber).id,
      comment: conn.req.body.comment,
      location: admin.getGeopointObject(
        conn.req.body.updateLocation[0],
        conn.req.body.updateLocation[1]
      ),
      timestamp: new Date(new Date(conn.req.body.updateTime)
        .toUTCString()),
      changes: [], // comment doesn't change the activity
    });

  batch.commit().then(() => {
    utils.sendResponse(conn, 201, 'CREATED', conn.headers);
    return null;
  }).catch((error) => utils.handleError(conn, error));
};

const checkAssignToList = (conn) => {
  console.log('working till assigntolist', conn.uid);
  admin.rootCollections.activities.doc(conn.req.body.activityId)
    .collection('AssignTo').doc(conn.phoneNumber).get()
    .then((doc) => {
      doc.exists ? addCommentToActivity(conn) :
        utils.sendResponse(conn, 401, 'UNAUTHORIZED', conn.headers);
      return null;
    }).catch((error) => utils.handleError(conn, error));
};

const getMobileNumber = (conn) => {
  admin.manageUsers.getUserByUid(conn.uid).then((userRecord) => {
    conn.phoneNumber = userRecord.phoneNumber.split('+')[1];
    checkAssignToList(conn);
    return null;
  }).catch((error) => {
    utils.handleError(conn, error);
  });
};


const app = (conn) => {
  // updateTime should be a unix timestamp.
  if (!(!isNaN(new Date(conn.req.body.updateTime)) &&
      Array.isArray(conn.req.body.updateLocation))) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  // lat = updateLocation[0]
  // lng = updateLocation[1]
  // -90 <= lat <= +90 AND -180 <= lng <= 180
  if (!((conn.req.body.updateLocation[0] >= -90 &&
        conn.req.body.updateLocation[0] <= 90) &&
      (conn.req.body.updateLocation[1] >= -180 &&
        conn.req.body.updateLocation[1] <= 180))) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  if (!conn.req.body.activityId) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  if (!(typeof conn.req.body.activityId === 'string' &&
      typeof conn.req.body.comment === 'string')) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  if (conn.req.body.activityId.trim() === '' ||
    conn.req.body.comment.trim() === '') {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  getMobileNumber(conn);
};

module.exports = app;
