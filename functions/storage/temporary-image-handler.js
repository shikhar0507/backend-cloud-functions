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

const { rootCollections, db } = require('../admin/admin');
const { subcollectionNames } = require('../admin/constants');
const {
  getFileHash,
  cloudflareCdnUrl,
  promisifiedRequest,
  promisifiedExecFile,
} = require('../admin/utils');
const admin = require('firebase-admin');
const fs = require('fs');
const mozjpeg = require('mozjpeg');
const env = require('../admin/env');
const url = require('url');

module.exports = async ({ name: filePath, bucket }) => {
  try {
    const batch = db.batch();
    // const { name: filePath } = object;
    // const bucket = admin.storage().bucket(object.bucket);

    const [
      {
        docs: [timerDoc],
      },
      [buffer],
    ] = await Promise.all([
      rootCollections.timers.orderBy('timestamp', 'desc').limit(1).get(),
      admin.storage().bucket(bucket).file(filePath).download(),
    ]);

    const json = JSON.parse(buffer.toString());
    const {
      canEditMap,
      activityId,
      addendumId,
      requestersPhoneNumber,
      addendumDocObject,
      activityData,
      base64Field,
    } = json;
    const { value: base64Value } = activityData.attachment[base64Field];
    const base64ImageString = base64Value.split('base64,').pop();
    const originalFilePath = `/tmp/${activityId}-original.jpg`;
    const compressedFilePath = `/tmp/${activityId}.jpg`;
    const fileName = `${activityId}.jpg`;
    const activityRef = rootCollections.activities.doc(activityId);

    activityData.addendumDocRef = rootCollections.offices
      .doc(activityData.officeId)
      .collection(subcollectionNames.ADDENDUM)
      .doc(addendumId);
    activityData.venue.forEach((_, index) => {
      if (
        !activityData.venue[index].geopoint ||
        !activityData.venue[index].geopoint.latitude
      ) {
        return;
      }

      activityData.venue[index].geopoint = new admin.firestore.GeoPoint(
        activityData.venue[index].geopoint,
      );
    });

    fs.writeFileSync(originalFilePath, base64ImageString, {
      encoding: 'base64',
    });

    Object.keys(canEditMap).forEach(phoneNumber => {
      const canEdit = canEditMap[phoneNumber];

      batch.set(
        activityRef.collection(subcollectionNames.ASSIGNEES).doc(phoneNumber),
        { canEdit },
      );
    });

    await promisifiedExecFile(mozjpeg, [
      '-outfile',
      compressedFilePath,
      originalFilePath,
    ]);

    const [, newHostName] = timerDoc.get('apiUrl').split('https://');

    return promisifiedRequest({
      hostname: newHostName,
      path: `/b2api/v2/b2_get_upload_url?bucketId=${env.backblaze.buckets.images}`,
      method: 'GET',
      headers: {
        Authorization: timerDoc.get('backblazeAuthorizationToken'),
      },
    })
      .then(({ uploadUrl, authorizationToken }) => {
        const fileBuffer = fs.readFileSync(compressedFilePath);
        const { path, hostname } = url.parse(uploadUrl);

        return promisifiedRequest({
          hostname,
          path,
          method: 'POST',
          postData: fileBuffer,
          headers: {
            Authorization: authorizationToken,
            'X-Bz-File-Name': encodeURI(fileName),
            'Content-Type': 'b2/x-auto',
            'Content-Length': Buffer.byteLength(fileBuffer),
            'X-Bz-Content-Sha1': getFileHash(fileBuffer),
            'X-Bz-Info-Author': requestersPhoneNumber,
          },
        });
      })
      .then(({ fileId }) => {
        batch.set(activityRef, {
          attachment:{
            [base64Field] : {
              type: activityData.attachment[base64Field].type,
              value: cloudflareCdnUrl(
                  newHostName,
                  fileId,
                  fileName,
              )
            }
          }
        },{merge:true});

        batch.set(
          activityData.addendumDocRef,
          Object.assign({}, {
            // Need to replace this because the old activityData object
            // will contain the `base64` string which we don't want.
            // Max file size for writing a single document
            // in Firestore is 1048487 bytes.
            activityData: {
              attachment: {
                [base64Field] : {
                  type: activityData.attachment[base64Field].type,
                  value: cloudflareCdnUrl(
                      newHostName,
                      fileId,
                      fileName,
                  )
                }
              }
            },
          }),
            {merge:true}
        );

        /** Delete the file since the activity creation is complete */
        return Promise.all([
          batch.commit(),
          admin.storage().bucket(bucket).file(filePath).delete(),
        ]);
      });
  } catch (error) {
    console.error(error);
  }
};
