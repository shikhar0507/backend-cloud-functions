'use strict';

const {
  rootCollections,
  db,
} = require('./admin/admin');
const {
  getFileHash,
  cloudflareCdnUrl,
  promisifiedRequest,
  promisifiedExecFile,
} = require('./admin/utils');
const admin = require('firebase-admin');
const fs = require('fs');
const mozjpeg = require('mozjpeg');
const env = require('./admin/env');
const url = require('url');


module.exports = async object => {
  const filePath = object.name;
  const bucket = admin.storage().bucket(object.bucket);
  const batch = db.batch();
  let timerDoc;
  let authorizationToken;
  let mainDownloadUrlStart;
  let base64Value;
  let base64ImageString;
  let originalFileName;
  let originalFilePath;
  let compressedFilePath;
  let fileName;
  let requestersPhoneNumber;
  let activityRef;
  let addendumDocRef;
  let base64Field;
  let addendumDocObject;
  let activityData;

  return Promise
    .all([
      rootCollections
        .timers
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get(),
      bucket
        .file(filePath)
        .download()
    ])
    .then(result => {
      const [timerDocQuery, bucketResult] = result;

      timerDoc = timerDocQuery.docs[0];

      const [buffer] = bucketResult;
      const json = JSON.parse(buffer.toString());

      const {
        canEditMap,
        activityId,
        addendumId,
      } = json;

      requestersPhoneNumber = json.requestersPhoneNumber;
      activityData = json.activityData;
      addendumDocObject = json.addendumDocObject;
      base64Field = json.base64Field;
      base64Value = activityData.attachment[base64Field].value;
      base64ImageString = base64Value.split('base64,').pop();
      originalFileName = `${activityId}-original.jpg`;
      originalFilePath = `/tmp/${originalFileName}`;
      compressedFilePath = `/tmp/${activityId}.jpg`;
      fileName = `${activityId}.jpg`;

      activityData.venue.forEach((_, index) => {
        if (!activityData.venue[index].geopoint
          || !activityData.venue[index].geopoint.latitude) {
          return;
        }

        activityData
          .venue[index]
          .geopoint = new admin.firestore.GeoPoint(
            activityData.venue[index].geopoint
          );
      });

      fs.writeFileSync(
        originalFilePath,
        base64ImageString,
        { encoding: 'base64' }
      );

      activityRef = rootCollections
        .activities
        .doc(activityId);
      addendumDocRef = rootCollections
        .offices
        .doc(activityData.officeId)
        .collection('Addendum')
        .doc(addendumId);

      activityData.addendumDocRef = addendumDocRef;

      Object
        .keys(canEditMap)
        .forEach(phoneNumber => {
          const canEdit = canEditMap[phoneNumber];

          batch.set(activityRef.collection('Assignees').doc(phoneNumber), {
            canEdit,
          });
        });

      return promisifiedExecFile(mozjpeg, ['-outfile', compressedFilePath, originalFilePath]);
    })
    .then(() => {
      authorizationToken = timerDoc.get('backblazeAuthorizationToken');
      const newHostName = timerDoc.get('apiUrl').split('https://')[1];
      mainDownloadUrlStart = newHostName;
      const bucketId = env.backblaze.buckets.images;

      return promisifiedRequest({
        hostname: newHostName,
        path: `/b2api/v2/b2_get_upload_url?bucketId=${bucketId}`,
        method: 'GET',
        headers: {
          'Authorization': authorizationToken,
        },
      });
    })
    .then(response => {
      authorizationToken = response.authorizationToken;

      const fileBuffer = fs.readFileSync(compressedFilePath);
      const uploadUrl = response.uploadUrl;
      const parsed = url.parse(uploadUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.path,
        method: 'POST',
        postData: fileBuffer,
        headers: {
          'Authorization': authorizationToken,
          'X-Bz-File-Name': encodeURI(fileName),
          'Content-Type': 'b2/x-auto',
          'Content-Length': Buffer.byteLength(fileBuffer),
          'X-Bz-Content-Sha1': getFileHash(fileBuffer),
          'X-Bz-Info-Author': requestersPhoneNumber,
        },
      };

      return promisifiedRequest(options);
    })
    .then(response => {
      const url = cloudflareCdnUrl(
        mainDownloadUrlStart,
        response.fileId,
        fileName
      );

      activityData.attachment[base64Field].value = url;
      // Need to replace this because the old activityData object
      // will contain the `base64` string which we don't want.
      // Max file size for writing a single document
      // in Firestore is 1048487 bytes.
      addendumDocObject.activityData = activityData;

      batch.set(activityRef, activityData);
      batch.set(addendumDocRef, addendumDocObject);

      return batch.commit();
    })
    /** Delete the file since the activity creation is complete */
    .then(() => {
      if (!env.isProduction) {
        return Promise.resolve();
      }

      // Not deleting json files in test project
      return bucket.file(filePath).delete();
    })
    .catch(console.error);
};
