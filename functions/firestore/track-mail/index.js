'use strict';

const {
  db,
  rootCollections,
} = require('../../admin/admin');
const env = require('../../admin/env');


module.exports = (conn) => {
  console.log('TRACKING MAILS...');
  console.log('Body', conn.req.body);
  console.log('Headers', conn.req.headers);

  if (conn.req.query.token !== env.sgMailParseToken) {
    console.log('TrackMailError:', conn.req.query, conn.req.body);

    return Promise.resolve({});
  }

  const batch = db.batch();
  let count = 0;

  conn.req.body.forEach(eventContext => {
    count++;

    const ref = rootCollections.mailEvents.doc();

    batch.set(ref, eventContext);
  });

  console.log('Docs', count);

  return batch
    .commit()
    .then(() => Promise.resolve({}))
    .catch(error => {
      console.log('TrackMailError:', error, conn.req.body);

      return Promise.resolve({});
    });
};
