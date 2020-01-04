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

const admin = require('firebase-admin');
const {rootCollections} = require('../../../admin/admin');

module.exports = async (snapShot, context) => {
  // Unassign notifications will go to the user when they are cancelled,
  // or removed as an assignee from an activity for some reason
  // Not sending in the case of unassign because this will trigger multiple
  // notifications to the user
  const {unassign, comment} = snapShot.data();

  if (unassign || !comment) {
    return;
  }

  // remove form include here too.

  try {
    const updatesDoc = await rootCollections.updates
      .doc(context.params.uid)
      .get();

    const {registrationToken} = updatesDoc.data();

    if (!registrationToken) {
      return;
    }

    return admin.messaging().sendToDevice(
      registrationToken,
      {
        data: {
          // Ask the client to send a request to the /read endpoint
          read: '1',
        },
        notification: {
          body: snapShot.get('comment') || '',
          tile: `Growthfile`,
        },
      },
      {
        priority: 'high',
        timeToLive: 60,
      },
    );
  } catch (error) {
    console.error(error);
  }
};
