'use strict';


const {
  filterAttachment,
  // getCanEditValue,
  validateSchedules,
  validateVenues,
} = require('../activity/helper');
const {
  rootCollections,
  db,
  // serverTimestamp,
  getGeopointObject,
} = require('../../admin/admin');
const {
  code,
} = require('../../admin/responses');
const {
  handleError,
  sendResponse,
} = require('../../admin/utils');
const {
  httpsActions,
} = require('../../admin/constants');

const moment = require('moment');
// const serverTimestamp = Date.now();
const timestamp = Number(moment().utc().format('x'));


const handleAssignees = (conn, locals) => {
  // TODO: Implement
};


const handleName = (conn, locals) => {
  const query = (() => {
    if (conn.req.body.template === 'office') {
      return rootCollections
        .offices
        /** Template is always `office` at this PATH. No need to add another
         * `where` clause.
         */
        .where('attachment.Name.value', '==', conn.req.body.attachment.Name.value)
        .limit(1);
    }

    const officeId = locals.activityObject.officeId;

    return rootCollections
      .offices
      .doc(officeId)
      .collection('Activities')
      .where('template', '==', conn.req.body.template)
      .where('attachment.Name.value', '==', conn.req.body.attachment.Name.value)
      .limit(1);
  })();

  query
    .get()
    .then((snapShot) => {
      if (!snapShot.empty) {
        const message = (() => {
          if (conn.req.body.template === 'office') {
            return `An office with the name`
              + ` ${conn.req.body.attachment.Name.value}`
              + ` already exists.`;
          }

          return `${conn.req.body.template} already exists in`
            + ` the office: ${conn.req.body.office}`;
        })();

        sendResponse(conn, code.conflict, message);

        return;
      }

      if (conn.req.body.template !== 'office') {
        handleAssignees(conn, locals);

        return;
      }

      // handleOffice(conn, locals);

      return;
    })
    .catch((error) => handleError(conn, error));
};


const handleResult = (conn, result) => {
  const [
    rootActivity,
    officeActivity,
  ] = result;

  const activityObject = rootActivity.data();

  const adminsCanEdit = officeActivity.get('adminsCanEdit');

  if (!adminsCanEdit
    .contains(conn.requester.phoneNumber)) {
    sendResponse(
      conn,
      code.forbidden,
      `You cannot edit this activity`
    );

    return;
  }

  {
    const scheduleNames =
      rootActivity
        .get('schedule')
        .map((object) => object.name);

    const result = validateSchedules(conn.req.body,
      scheduleNames);

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    activityObject.schedule = result.schedules;
  }

  {
    const venueNames =
      rootActivity
        .get('venue')
        .map((object) => object.venueDescriptor);

    const result =
      validateVenues(
        conn.req.body,
        venueNames
      );

    if (!result.isValid) {
      sendResponse(conn, code.badRequest, result.message);

      return;
    }

    activityObject.venue = result.venues;
  }

  const attachmentValid = filterAttachment({
    officeId: rootActivity.get('officeId'),
    bodyAttachment: conn.req.body.attachment,
    templateAttachment: rootActivity.get('attachment'),
    template: conn.req.body.template,
    office: conn.req.body.office,
  });

  if (!attachmentValid.isValid) {
    sendResponse(
      conn,
      code.badRequest,
      attachmentValid.message
    );

    return;
  }

  activityObject.attachment = conn.req.body.attachment;

  const nameChanged = (() => {
    if (!activityObject.attachment.Name) return false;

    const oldName = activityObject.activities.Name.value;
    const newName = conn.req.body.attachment.Name.value;

    return oldName !== newName;
  })();

  const locals = { activityObject };

  if (!nameChanged) {
    handleAssignees(conn, locals);

    return;
  }

  handleName(conn, locals);
};


module.exports = (conn) =>
  Promise
    .all([
      rootCollections
        .activities
        .doc(conn.req.body.activityId)
        .get(),
      rootCollections
        .offices
        .doc(conn.req.body.office)
        .collection('Activities')
        .doc(conn.req.body.activityId)
        .get(),
    ])
    .then((result) => handleResult(conn, result))
    .catch((error) => handleError(conn, error));
