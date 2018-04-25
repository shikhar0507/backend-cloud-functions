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
const isValidLocation = helpers.isValidLocation;
const isValidString = helpers.isValidString;
const isValidDate = helpers.isValidDate;

const commitBatch = (conn) => {
  conn.batch.commit().then(() => sendResponse(conn, 200, 'OK'))
    .catch((error) => handleError(conn, error));
};

const createActivityWithBatch = (conn, result) => {
  conn.batch = admin.batch;
  conn.changes = new Set();
  const activityRef = activities.doc();

  // activity ID is required at multiple places
  conn.activityId = activityRef.id;

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
    schedule: scheduleCreator(conn),
    venue: venueCreator(conn),
    lastUpdateTime: getDateObject(conn.req.body.createTime),
  });

  // userRecors --> result[0]
  // templateRef --> result[1]
  if (result[1].get('autoIncludeOnCreate').indexOf('CREATOR') > -1) {
    conn.changes.add('AssignTo'); // creator is added, so assignTo is changed
    conn.batch.set(activities.doc(conn.activityId)
      .collection('AssignTo').doc(stripPlusFromMobile(result[0].phoneNumber)), {
        canEdit: handleCanEdit(result[1].get('canEditRule')),
      });
  }

  // create docs in AssignTo collection if assignTo is in the reqeuest body
  if (conn.req.body.assignTo) {
    conn.changes.add('AssignTo'); // assignTo changed
    conn.req.body.assignTo.forEach((val) => {
      if (!isValidString(val)) return;

      conn.batch.set(activities.doc(conn.activityId)
        .collection('AssignTo').doc(val), {
          // template --> result[1].data()
          canEdit: handleCanEdit(result[1].get('canEditRule')),
        });
    });
  }
  conn.batch.set(activities.doc(conn.activityId)
    .collection('Addendum').doc(), {
      activityId: conn.activityId,
      user: stripPlusFromMobile(result[0].phoneNumber),
      comment: `${result[0].displayName ||
        stripPlusFromMobile(result[0].phoneNumber) || 'someone'}
        created ${result[1].get('name')}`,
      location: admin.getGeopointObject(
        conn.req.body.createLocation[0],
        conn.req.body.createLocation[1]
      ),
      timestamp: getDateObject(conn.req.body.createTime),
      changes: [...conn.changes], // list of things that changed
    });

  commitBatch(conn);
};

const fetchDocs = (conn) => {
  const userRecord = admin.manageUsers.getUserByUid(conn.uid);
  const templateRef = rootCollections.templates
    .doc(conn.req.body.templateId).get();
  const officeRef = rootCollections.offices.doc(conn.req.body.officeId).get();

  Promise.all([userRecord, templateRef, officeRef])
    .then((result) => {
      createActivityWithBatch(conn, result);
      return null;
    }).catch((error) => {
      console.log(error);
      sendResponse(conn, 400, 'BAD REQUEST');
    });
};

const app = (conn) => {
  if (isValidDate(conn.req.body.createTime)
    && isValidString(conn.req.body.templateId)
    && isValidLocation(conn.req.body.createLocation)) {
    fetchDocs(conn);
  } else {
    sendResponse(conn, 400, 'BAD REQUEST');
  }
};

module.exports = app;
