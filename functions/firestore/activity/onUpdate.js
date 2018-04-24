const admin = require('../../admin/admin');
const utils = require('../../admin/utils');

const handleCanEdit = (str) => true;

const commitBatch = (conn) => {
  conn.batch.commit().then(() => {
    utils.sendResponse(conn, 204, 'NO CONTENT', conn.headers);
    return null;
  }).catch((error) => utils.handleError(conn, error));
};

const addActivityDataToBatch = (conn, result) => {
  if (conn.req.body.addAssignTo) {
    if (Array.isArray(conn.req.body.addAssignTo)) {
      conn.changes.add('AssignTo');
      conn.req.body.addAssignTo.forEach((val) => {
        if (typeof val !== 'string' || val === '') {
          // skip the iteration where the val is not a string
          // OR is an empty string
          return;
        }

        if (val.trim() === '') {
          // empty string not allowed
          return;
        }

        conn.batch.set(admin.rootCollections.activities
          .doc(conn.req.body.activityId).collection('AssignTo').doc(val), {
            // get a boolean true/false from the string 'true/'/'false'
            canEdit: handleCanEdit(conn.templateData.canEditRule),
          });
      });
    }
  }

  const validScheduleObject = {};
  if (Array.isArray(conn.req.body.schedule)) {
    conn.req.body.schedule.forEach((sch, index) => {
      if (!isNaN(new Date(sch.startTime)) && sch.endTime === undefined) {
        validScheduleObject.push({
          name: sch.name || '',
          startTime: new Date(new Date(sch.startTime).toUTCString()),
          endTime: new Date(new Date(sch.startTime).toUTCString()),
        });
      } else if (!isNaN(new Date(sch.startTime)) &&
        !isNaN(new Date(sch.endTime)) &&
        sch.endTime >= sch.startTime) {
        validScheduleObject[`${index}`] = {
          name: sch.name || '',
          startTime: new Date(new Date(sch.startTime).toUTCString()),
          endTime: new Date(new Date(sch.endtime).toUTCString()),
        };
      }
    });
  }

  // create docs in Venue collection if venue is present in the request body
  const validVenueObject = {};
  if (Array.isArray(conn.req.body.venue)) {
    conn.req.body.venue.forEach((val, index) => {
      // only venues with valid geopoint are created
      if (!Array.isArray(val.geopoint)) {
        // skip the iteration where the geopoint is not of type array
        return;
      }

      // -90 <= lat <= +90 AND -180 <= lng <= +180
      if (!((val.geopoint[0] >= -90 && val.geopoint[0] <= 90) &&
          (val.geopoint[1] >= -180 && val.geopoint[1] <= 180))) {
        // if the geopoint is an array, but doesn't have the valid ranges
        // skip the iteration
        return;
      }

      // if both conditions above are false, create the venue
      validVenueObject[`${index}`] = {
        venueDescriptor: val.venueDescriptor || '',
        location: val.location || '',
        geopoint: admin.getGeopointObject(
          val.geopoint[0],
          val.geopoint[1]
        ),
        address: val.address || '',
      };
    });
  }

  if (conn.req.body.title || conn.req.body.description ||
    conn.req.body.status) {
    // if either of these values have arrived in the request body, then
    // we can safely assume that Root has changed
    conn.changes.add('Root');
  }

  conn.batch.set(admin.rootCollections.activities
    .doc(conn.req.body.activityId), {
      title: conn.req.body.title || result[0].data().title || '',
      description: conn.req.body.description ||
        result[0].get('description') || '',
      status: result[1].get('ACTIVITYSTATUS')
        .indexOf(conn.req.body.status) > -1 ?
        conn.req.body.status : result[0].get('status'),
      schedule: validScheduleObject || {},
      venue: validVenueObject || {},
      lastUpdateTime: new Date(new Date(conn.req.body.updateTime)
        .toUTCString()),
    }, {
      merge: true,
    });

  conn.batch.set(admin.rootCollections.activities
    .doc(conn.req.body.activityId).collection('Addendum').doc(), {
      activityId: conn.req.body.activityId,
      user: admin.rootCollections.profiles.doc(conn.phoneNumber).id,
      comment: `${conn.displayName || conn.phoneNumber
        || 'someone'} updated ${conn.templateData.name}`,
      location: admin.getGeopointObject(
        conn.req.body.updateLocation[0],
        conn.req.body.updateLocation[1]
      ),
      timestamp: new Date(new Date(conn.req.body.updateLocation)
        .toUTCString()),
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
        conn.batch.delete(admin.rootCollections.activities
          .doc(conn.req.body.activityId).collection('AssignTo').doc(val));
      });
    }
  }

  // result[0] --> activity data
  admin.rootCollections.templates.doc(result[0].get('template'))
    .get().then((doc) => {
      conn.templateData = doc.data();
      return addActivityDataToBatch(conn, result);
    }).catch((error) => utils.handleError(conn, error));
};

const fetchDocs = (conn) => {
  const activityRef = admin.rootCollections.activities
    .doc(conn.req.body.activityId).get();
  const activityStatusRef = admin.rootCollections.enums
    .doc('ACTIVITYSTATUS').get();

  Promise.all([activityRef, activityStatusRef]).then((result) => {
    if (!result[0].exists) {
      utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    } else {
      updateActivityWithBatch(conn, result);
    }
    return;
  }).catch((error) => utils.handleError(conn, error));
};

const checkAssignToListInActivity = (conn) => {
  admin.rootCollections.activities.doc(conn.req.body.activityId)
    .collection('AssignTo').doc(conn.phoneNumber).get().then((doc) => {
      if (!doc.exists) {
        utils.sendResponse(conn, 401, 'UNAUTHORIZED', conn.headers);
      } else if (handleCanEdit(doc.get('canEdit'))) {
        fetchDocs(conn);
      }
      return null;
    }).catch((error) => utils.handleError(conn, error));
};

const getPhoneNumberFromAuth = (conn) => {
  admin.manageUsers.getUserByUid(conn.uid).then((userRecord) => {
    conn.phoneNumber = userRecord.phoneNumber.split('+')[1];
    conn.displayName = userRecord.displayName;
    checkAssignToListInActivity(conn);
    return null;
  }).catch((error) => {
    console.log(error);
    console.log('catch');
    utils.sendResponse(conn, 401, 'UNAUTHORIZED', conn.headers);
  });
};


const app = (conn) => {
  if (!(!isNaN(new Date(conn.req.body.updateTime)) &&
      Array.isArray(conn.req.body.updateLocation))) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  if (!((conn.req.body.updateLocation[0] >= -90 &&
        conn.req.body.updateLocation[0] <= 90) &&
      (conn.req.body.updateLocation[1] >= -180 &&
        conn.req.body.updateLocation[1] <= 180))) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  if (typeof conn.req.body.activityId !== 'string') {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  if (conn.req.body.activityId.trim() === '') {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  getPhoneNumberFromAuth(conn);
};

module.exports = app;
