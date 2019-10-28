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


const functions = require('firebase-functions');
const env = require('./admin/env');

const authOnCreate = functions
  .auth
  .user()
  .onCreate(require('./auth/on-create'));

const api = functions
  .https
  .onRequest(require('./server/server'));

const assigneeOnDelete = functions
  .firestore
  .document('Activities/{activityId}/Assignees/{phoneNumber}')
  .onDelete(require('./firestore/assignees/index'));

const activityOnWrite = functions
  .firestore
  .document('/Activities/{activityId}')
  .onWrite(require('./firestore/activity/on-write'));

const instantOnCreate = functions
  .firestore
  .document('Instant/{docId}')
  .onCreate(require('./firestore/instant/index'));

const generateOfficeNamePermutations = functions
  .firestore
  .document('Offices/{officeId}')
  .onCreate(require('./firestore/offices/background/on-create'));

const profileOnWrite = functions
  .firestore
  .document('Profiles/{phoneNumber}')
  .onWrite(require('./firestore/profiles/on-write'));

const activityTemplatesOnUpdate = functions
  .runWith({
    memory: '1GB',
    timeoutSeconds: '120'
  })
  .firestore
  .document('ActivityTemplates/{docId}')
  .onUpdate(require('./firestore/subscriptions/on-update'));

const timer = functions
  .firestore
  .document('Timers/{docId}')
  .onCreate(require('./timer/on-create'));

const recipientsOnUpdate = functions
  .firestore
  .document('Recipients/{docId}')
  .onUpdate(require('./firestore/recipients/on-update'));

/** For sending notifications to the client app */
const sendPushNotification = functions
  .firestore
  .document('Updates/{uid}/Addendum/{docId}')
  .onCreate(require('./firestore/updates/addendum/on-create'));

const webapp = functions
  .https
  .onRequest(require('./webapp'));

const getUser = functions
  .https
  .onRequest(require('./get-user'));

const monthlyOnWrite = functions
  .firestore
  .document('Offices/{officeId}/Statuses/{monthYear}/Employees/{phoneNumber}')
  .onWrite(require('./firestore/monthly'));

const temporaryImageHandler = functions
  .storage
  .bucket(env.tempBucketName)
  .object()
  .onFinalize(require('./storage/temporary-image-handler'));

const bulkCreateHandler = functions
  .storage
  .bucket(env.bulkStorageBucketName)
  .object()
  .onFinalize(require('./storage/bulk'));

const deleter = functions
  .firestore
  .document('Deleter/{docId}')
  .onCreate(require('./temp/deleteOldData'));


const creator = functions
  .firestore
  .document(`FromDeleter/{docId}`)
  .onCreate(require('./temp/createData'));


module.exports = {
  deleter,
  creator,
  api,
  timer,
  webapp,
  getUser,
  authOnCreate,
  monthlyOnWrite,
  profileOnWrite,
  instantOnCreate,
  activityOnWrite,
  assigneeOnDelete,
  bulkCreateHandler,
  recipientsOnUpdate,
  sendPushNotification,
  temporaryImageHandler,
  activityTemplatesOnUpdate,
  generateOfficeNamePermutations,
};
