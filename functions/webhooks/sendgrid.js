'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const env = require('../admin/env');
const momentTz = require('moment-timezone');


module.exports = async conn => {
  console.log('in sgmail webhook', conn.req.method);

  try {
    if (conn.req.query.token !== env.sgMailParseToken) {
      return;
    }

    const batch = db.batch();
    const promises = [];
    const recipientIdArray = [];
    const contextArray = [];
    const [firstItem] = conn.req.body;
    const momentToday = momentTz(firstItem.timestamp * 1000);
    const dayStart = momentToday.startOf('day');
    const dayEnd = momentToday.endOf('day');
    const recipientRefs = [];

    conn
      .req
      .body
      .forEach(eventContext => {
        if (!eventContext.recipientId) {
          return;
        }

        const ref = rootCollections
          .recipients
          .doc(eventContext.recipientId);

        recipientRefs.push(ref);
      });

    console.log('before recipientRefs.length');

    if (recipientRefs.length === 0) {
      console.log('returning recipientRefs len = 0');

      return;
    }

    console.log('after recipientRefs.length');

    const recipientDocs = await db
      .getAll(...recipientRefs);

    const existingRecipientIds = new Set();

    recipientDocs
      .forEach(doc => {
        existingRecipientIds.add(doc.id);
      });

    conn
      .req
      .body
      .forEach(eventContext => {
        if (!eventContext.recipientId) {
          return;
        }

        if (!existingRecipientIds.has(eventContext.recipientId)) {
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

    const snapShots = await Promise
      .all(promises);

    snapShots
      .forEach((snapShot, index) => {
        const recipientId = recipientIdArray[index];
        const doc = snapShot.docs[0];

        const ref = doc ? doc.ref : rootCollections
          .recipients
          .doc(recipientId)
          .collection('MailEvents')
          .doc();

        const eventContext = contextArray[index];

        const updateToMerge = {
          timestamp: momentToday.valueOf(),
          [eventContext.email]: {
            [eventContext.event]: {
              [eventContext.reportName]: eventContext,
            }
          },
        };

        console.log('path', ref.path);

        batch
          .set(ref, updateToMerge, {
            merge: true,
          });
      });

    await batch
      .commit();

    return;
  } catch (error) {
    console.error('Sg Error', error);
    return;
  }
};
