'use strict';

const {rootCollections} = require('../admin/admin');
const env = require('../admin/env');
const momentTz = require('moment-timezone');

const storeEvents = async conn => {
  const {date, months: month, years: year} = momentTz().toObject();
  const ref = rootCollections.facebookEvents.doc();

  console.log('ref', ref.path);

  await ref.set({
    date,
    month,
    year,
    type: conn.req.body.object || null,
    body: conn.req.body,
    query: conn.req.query,
    receivedAt: Date.now(),
  });

  return '';
};

module.exports = async conn => {
  // This way of verifying is perhaps not correct.
  // We should store this event details somewhere and then
  // verify them in the subsequent POST request.
  // Not sure, though.
  if (
    conn.req.method === 'GET' &&
    conn.req.query['hub.verify_token'] === env.fbVerificationToken
  ) {
    return parseInt(conn.req.query['hub.challenge']);
  }

  if (conn.req.method === 'POST') {
    return storeEvents(conn);
  }

  return null;
};
