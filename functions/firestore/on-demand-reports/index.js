'use strict';

const {
  db,
  rootCollections,
} = require('../../admin/admin');
const {
  sendResponse,
  hasAdminClaims,
  hasSupportClaims,
  handleError,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const momentTz = require('moment-timezone');


const triggerReports = (options) => {
  const { timestampsArray, recipientsDoc } = options;
  const batch = db.batch();

  timestampsArray.forEach((timestamp) => {
    batch.set(recipientsDoc.ref, {
      timestamp,
    }, {
        merge: true,
      });
  });

  return batch.commit();
};


const fetchRecipientsDoc = (conn, officeDoc) => {
  rootCollections
    .recipients
    .where('report', '==', conn.req.body.report)
    .where('office', '==', conn.req.body.office)
    .limit(1)
    .get()
    .then((snapShot) => {
      if (snapShot.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `The recipient for the office: '${conn.req.body.office}'`
          + ` for the report: '${conn.req.body.report}' does not exist`
        );
      }

      const timezone = officeDoc.get('attachment.Timezone.value');
      const startDay = momentTz().tz(timezone).startOf('day');
      const endDay = momentTz().tz(timezone).endOf('day');
      const numberOfDays = Math.abs(endDay.diff(startDay, 'day'));

      const timestampsArray = [
        startDay.valueOf(),
      ];

      for (let iter = 0; iter < numberOfDays; iter++) {
        const newMoment = startDay.clone().add(1, 'day');

        timestampsArray.push(newMoment.valueOf());
      }

      const options = {
        officeDoc,
        recipientsDoc: snapShot.docs[0],
      };

      return triggerReports(options);
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error));
};


module.exports = (conn) => {
  /**
   * Request body
   * {
   *   startDay: unix
   *   endDay: unix
   *   office: string
   *   report: string
   * }
   */

  if (!conn.requester.isSupportRequest) {
    if (!hasAdminClaims(conn.requester.customClaims)
      || !conn.requester.customClaims.includes(conn.req.body.office)) {
      return sendResponse(
        conn,
        code.forbidden,
        'You cannot access this resource'
      );
    }
  }

  if (conn.requester.isSupportRequest
    && !hasSupportClaims(conn.requester.customClaims)) {
    return sendResponse(
      conn,
      code.forbidden,
      'You cannot access this resource'
    );
  }

  return rootCollections
    .offices
    .where('attachment.Name.value', '==', conn.req.body.office)
    .limit(1)
    .get()
    .then((docs) => {
      if (docs.empty) {
        return sendResponse(
          conn,
          code.badRequest,
          `Office: '${conn.req.body.office}' does not exist`
        );
      }

      const officeDoc = docs.docs[0];

      return fetchRecipientsDoc(conn, officeDoc);
    })
    .catch((error) => handleError(conn, error));
};
