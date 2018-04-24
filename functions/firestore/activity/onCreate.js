const admin = require('../../admin/admin');
const utils = require('../../admin/utils');

const handleCanEdit = (str) => true;

const createActivityWithBatch = (conn, result) => {
  conn.batch = admin.batch;
  conn.changes = new Set();
  const activityRef = admin.rootCollections.activities.doc();

  // activity ID is required at multiple places
  conn.activityId = activityRef.id;

  const validScheduleObject = {};
  // venue needs to be an array.
  if (Array.isArray(conn.req.body.schedule)) {
    conn.req.body.schedule.forEach((sch, index) => {
      if (!isNaN(new Date(sch.startTime)) && !sch.endTime) {
        // schedule has startTime but not endTime
        validScheduleObject[`${index}`] = {
          name: sch.name || '',
          startTime: new Date(new Date(sch.startTime).toUTCString()),
          endTime: new Date(new Date(sch.startTime).toUTCString()),
        };
      } else if (!isNaN(new Date(sch.startTime)) &&
        !isNaN(new Date(sch.endTime)) &&
        sch.endTime >= sch.startTime) {
        // schedule has both startTime, endTime and endTime  >= startTime
        validScheduleObject[`${index}`] = {
          name: sch.name || '',
          startTime: new Date(new Date(sch.startTime).toUTCString()),
          endTime: new Date(new Date(sch.endTime).toUTCString()),
        };
      }
    });
  }

  const validVenueObject = {};
  if (Array.isArray(conn.req.body.venue)) {
    conn.req.body.venue.forEach((val, index) => {
      if (!Array.isArray(val.geopoint)) {
        // skip the iteration where the geopoint is not of type array
        return;
      }

      if (!((val.geopoint[0] >= -90 && val.geopoint[0] <= 90) &&
          (val.geopoint[1] >= -180 && val.geopoint[1] <= 180))) {
        // if the geopoint is an array, but doesn't have the valid ranges,
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

  conn.changes.add('Root'); // activity root changed

  // if description is not sent in the request body.
  // create data in activity root
  // result[1] -> template
  if (!conn.req.body.description) conn.req.body.description = '';
  conn.batch.set(activityRef, {
    title: conn.req.body.title || conn.req.body
      .description.substring(0, 30) || result[1].get('defaultTitle'),
    description: conn.req.body.description || '',
    status: result[1].get('statusOnCreate'),
    office: conn.req.body.officeId === undefined ?
      null : conn.req.body.officeId,
    template: conn.req.body.templateId,
    schedule: validScheduleObject || {},
    venue: validVenueObject || {},
    lastUpdateTime: new Date(new Date(conn.req.body.createTime)
      .toUTCString()),
  });

  // userRecors --> result[0]
  // templateRef --> result[1]
  if (result[1].get('autoIncludeOnCreate').indexOf('CREATOR') > -1) {
    conn.changes.add('AssignTo'); // creator is added, so assignTo is changed
    conn.batch.set(admin.rootCollections.activities.doc(conn.activityId)
      .collection('AssignTo').doc(result[0].phoneNumber.split('+')[1]), {
        // mobile without the '+' sign
        canEdit: handleCanEdit(result[1].get('canEditRule')),
      });
  }

  // create docs in AssignTo collection if assignTo is in the reqeuest body
  if (conn.req.body.assignTo) {
    conn.changes.add('AssignTo'); // assignTo changed
    conn.req.body.assignTo.forEach((val) => {
      // doc-id of any document in the AssignTo collection is same as
      // the PublicData docId of the user for whom the document
      // is being created
      conn.batch.set(admin.rootCollections.activities.doc(conn.activityId)
        .collection('AssignTo').doc(val), {
          // template --> result[1].data()
          canEdit: handleCanEdit(result[1].get('canEditRule')),
        });
    });
  }
  conn.batch.set(admin.rootCollections.activities.doc(conn.activityId)
    .collection('Addendum').doc(), {
      activityId: conn.activityId,
      user: result[0].phoneNumber.split('+')[1],
      comment: `${result[0].displayName || result[0]
        .phoneNumber.split('+')[1] || 'someone'} 
        created ${result[1].get('name')}`,
      location: admin.getGeopointObject(
        conn.req.body.createLocation[0],
        conn.req.body.createLocation[1]
      ),
      timestamp: new Date(new Date(conn.req.body.createTime)
        .toUTCString()),
      changes: [...conn.changes], // list of things that changed
    });

  conn.batch.commit().then(() => {
    utils.sendResponse(conn, 200, 'OK', conn.headers);
    return null;
  }).catch((error) => {
    utils.handleError(conn, error);
  });
};

const fetchDocs = (conn) => {
  const userRecord = admin.manageUsers.getUserByUid(conn.uid);
  const templateRef = admin.rootCollections.templates
    .doc(conn.req.body.templateId).get();
  const officeRef = admin.rootCollections.offices
    .doc(conn.req.body.officeId).get();

  Promise.all([userRecord, templateRef, officeRef])
    .then((result) => {
      createActivityWithBatch(conn, result);
      return null;
    }).catch((error) => {
      console.log(error);
      utils.sendResponse(conn, 500, 'BAD REQUEST', conn.headers);
    });
};

const app = (conn) => {
  // createTime needs to be a valid unix timestamp
  if (!(!isNaN(new Date(conn.req.body.createTime)) &&
      Array.isArray(conn.req.body.createLocation))) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  // lat -> createLocation[0]
  // lng -> createLocation[1]
  // -90 <= lat <= +90 AND -180 <= lng <= +180
  if (!((conn.req.body.createLocation[0] >= -90 &&
        conn.req.body.createLocation[0] <= 90) &&
      (conn.req.body.createLocation[1] >= -180 &&
        conn.req.body.createLocation[1] <= 180))) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  if (!(typeof conn.req.body.templateId === 'string')) {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  if (conn.req.body.templateId.trim() === '') {
    utils.sendResponse(conn, 400, 'BAD REQUEST', conn.headers);
    return;
  }

  fetchDocs(conn);
};

module.exports = app;
