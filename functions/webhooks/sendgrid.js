'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const env = require('../admin/env');

module.exports = async conn => {
  console.log('in sgmail webhook', conn.req.body);

  try {
    if (conn.req.query.token !== env.sgMailParseToken) {
      return;
    }

    const batch = db.batch();

    conn.req.body.forEach(object => {
      const {
        testMail
      } = object;

      // Ignore test emails
      if (testMail) {
        return;
      }

      batch.set(
        rootCollections
        .mailEvents
        .doc(),
        Object.assign({}, object, {
          webhookReceivedAt: Date.now(),
        })
      );
    });

    await batch.commit();

    return {};
  } catch (error) {
    console.error('MailEvents Error', error);

    return {};
  }
};
