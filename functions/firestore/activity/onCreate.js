const admin = require('../../admin/admin');
const utils = require('../../admin/utils');
const helpers = require('./helpers');

const rootCollections = admin.rootCollections;
const activities = rootCollections.activities;
const inbox = rootCollections.inboxes;
const profile = rootCollections.profiles;

const handleError = utils.handleError;
const sendResponse = utils.sendResponse;
const isValidDate = helpers.isValidDate;
const venueCreator = helpers.venueCreator;
const handleCanEdit = helpers.handleCanEdit;
const isValidString = helpers.isValidString;
const getDateObject = helpers.getDateObject;
const scheduleCreator = helpers.scheduleCreator;
const isValidLocation = helpers.isValidLocation;
const stripPlusFromMobile = helpers.stripPlusFromMobile;

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
    office: !conn.req.body.officeId ? null : conn.req.body.officeId,
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
      .collection('AssignTo')
      .doc(stripPlusFromMobile(stripPlusFromMobile(result[0].phoneNumber))), {
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

  const addendumData = {
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
  };


  conn.batch.set(activities.doc(conn.activityId).collection('Addendum')
    .doc(), addendumData);

  conn.batch.set(inbox.doc(conn.uid), {
    mobile: stripPlusFromMobile(result[0].phoneNumber),
  }, {
      merge: true,
    });

  conn.batch.set(inbox.doc(conn.uid).collection('Addendum')
    .doc(), addendumData);

  conn.batch.set(inbox.doc(conn.uid).collection('Activities').doc(), {
    activityId: conn.activityId,
    timestamp: getDateObject(conn.req.body.createTime),
  });

  // TODO: allowed templates in inbox???

  commitBatch(conn);
};

const fetchDocs = (conn) => {
  const userRecord = admin.manageUsers.getUserByUid(conn.uid);
  const templateRef = rootCollections.templates
    .doc(conn.req.body.templateId).get();
  const officeRef = rootCollections.offices.doc(conn.req.body.officeId).get();
  const profileRef = rootCollections.profiles.doc(conn.uid)
    .collection('AllowedTemplates').doc('personal').get();

  Promise.all([userRecord, templateRef, officeRef, profileRef])
    .then((result) => {
      if (result[3].get('template')
        .indexOf(conn.req.body.templateId) > -1) {
        createActivityWithBatch(conn, result);
      } else {
        sendResponse(conn, 401, 'UNAUTHORIZED');
      }
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
