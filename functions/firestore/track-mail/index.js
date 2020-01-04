/**
 * Copyright (c) 2018 GrowthFile
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 *
 */

'use strict';

const {db, rootCollections} = require('../../admin/admin');
const env = require('../../admin/env');
const momentTz = require('moment-timezone');

module.exports = conn => {
  if (conn.req.query.token !== env.sgMailParseToken) {
    console.log('TrackMailError:', conn.req.query, conn.req.body);

    return Promise.resolve({});
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

  conn.req.body.forEach(eventContext => {
    if (!eventContext.recipientId) return;

    recipientIdArray.push(eventContext.recipientId);
    contextArray.push(eventContext);

    const promise = rootCollections.recipients
      .doc(eventContext.recipientId)
      .collection('MailEvents')
      .where('timestamp', '>=', dayStart.valueOf())
      .where('timestamp', '<=', dayEnd.valueOf())
      .limit(1)
      .get();

    promises.push(promise);
  });

  return Promise.all(promises)
    .then(snapShots => {
      snapShots.forEach((snapShot, index) => {
        const recipientId = recipientIdArray[index];

        const ref = (() => {
          if (snapShot.empty) {
            return rootCollections.recipients
              .doc(recipientId)
              .collection('MailEvents')
              .doc();
          }

          return snapShot.docs[0].ref;
        })();

        const eventContext = contextArray[index];

        batch.set(
          ref,
          {
            timestamp: momentToday.valueOf(),
            [eventContext.email]: {
              [eventContext.event]: {
                [eventContext.reportName]: eventContext,
              },
            },
          },
          {
            merge: true,
          },
        );
      });

      return batch.commit();
    })
    .then(() => ({
      success: true,
    }));
};
