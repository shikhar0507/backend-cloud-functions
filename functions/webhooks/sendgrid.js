'use strict';

'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const {
  handleError,
  sendResponse,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');
const env = require('../admin/env');
const momentTz = require('moment-timezone');


module.exports = async conn => {
  if (conn.req.query.token !== env.sgMailParseToken) {
    console.log('TrackMailError:', conn.req.query, conn.req.body);

    return sendResponse(conn, code.badRequest);
  }

  const batch = db.batch();
  const promises = [];
  const recipientIdArray = [];
  const contextArray = [];
  const firstItem = conn.req.body[0];
  const unix = firstItem.timestamp * 1000;
  const momentToday = momentTz(unix);
  const dayStart = momentToday.startOf('day');
  const dayEnd = momentToday.endOf('day');

  conn
    .req
    .body
    .forEach(eventContext => {
      if (!eventContext.recipientId) {
        return;
      }

      recipientIdArray
        .push(eventContext.recipientId);
      contextArray
        .push(eventContext);

      const promise = rootCollections
        .recipients
        .doc(eventContext.recipientId)
        .collection('MailEvents')
        .where('timestamp', '>=', dayStart.valueOf())
        .where('timestamp', '<=', dayEnd.valueOf())
        .limit(1)
        .get();

      promises
        .push(promise);
    });

  try {
    const snapShots = Promise
      .all(promises);

    snapShots.forEach((snapShot, index) => {
      const recipientId = recipientIdArray[index];
      const doc = snapShot.docs[0];

      const ref = doc ? doc.ref : rootCollections
        .recipients
        .doc(recipientId)
        .collection('MailEvents')
        .doc();

      const eventContext = contextArray[index];

      batch
        .set(ref, {
          timestamp: momentToday.valueOf(),
          [eventContext.email]: {
            [eventContext.event]: {
              [eventContext.reportName]: eventContext,
            }
          },
        }, {
          merge: true,
        });
    });

    await batch
      .commit();

    return sendResponse(conn, code.ok);
  } catch (error) {
    return handleError(conn, error);
  }
};
