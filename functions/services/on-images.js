'use strict';

const {
  sendResponse,
  handleError,
  isNonEmptyString,
  cloudflareCdnUrl,
  promisifiedRequest,
  getFileHash,
  promisifiedExecFile,
} = require('../admin/utils');
const {rootCollections} = require('../admin/admin');
const {auth} = require('../admin/admin');
const {code} = require('../admin/responses');
const fs = require('fs');
const url = require('url');
const mozjpeg = require('mozjpeg');
const env = require('../admin/env');

const validateRequest = requestBody => {
  const validationResult = {
    isValid: true,
    message: null,
  };

  if (!requestBody.hasOwnProperty('imageBase64')) {
    validationResult.message = `The field 'imageBase64' is missing from the request body.`;
    validationResult.isValid = false;
  }

  if (!isNonEmptyString(requestBody.imageBase64)) {
    validationResult.message =
      `The field 'imageBase64'` + ` should be a non-empty 'string'.`;
    validationResult.isValid = false;
  }

  return validationResult;
};

module.exports = conn => {
  const result = validateRequest(conn.req.body);
  if (!result.isValid) {
    sendResponse(conn, code.badRequest, result.message);

    return;
  }

  if (conn.req.body.imageBase64.startsWith('https://')) {
    auth
      .updateUser(conn.requester.uid, {
        photoURL: conn.req.body.imageBase64,
      })
      .then(() => sendResponse(conn, code.noContent))
      .catch(error => handleError(conn, error));

    return;
  }

  // endpoint for enabling the frontend to set images to auth
  let authorizationToken = '';
  let mainDownloadUrlStart = '';
  const bucketId = env.backblaze.buckets.images;
  const originalFileName = `${conn.requester.uid}-original.jpg`;
  const originalFilePath = `/tmp/${originalFileName}`;
  const compressedFilePath = `/tmp/${conn.requester.uid}.jpg`;
  const base64ImageString = conn.req.body.imageBase64.split(';base64,').pop();

  fs.writeFileSync(originalFilePath, base64ImageString, {
    encoding: 'base64',
  });

  promisifiedExecFile(mozjpeg, [
    '-outfile',
    compressedFilePath,
    originalFilePath,
  ])
    .then(() => {
      return rootCollections.timers
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
    })
    .then(timerDocQuery => {
      const timerDoc = timerDocQuery.docs[0];
      authorizationToken = timerDoc.get('backblazeAuthorizationToken');
      const newHostName = timerDoc.get('apiUrl').split('https://')[1];
      mainDownloadUrlStart = newHostName;

      return promisifiedRequest({
        hostname: newHostName,
        path: `/b2api/v2/b2_get_upload_url?bucketId=${bucketId}`,
        method: 'GET',
        headers: {
          Authorization: authorizationToken,
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
          Authorization: authorizationToken,
          'X-Bz-File-Name': encodeURI(`${conn.requester.uid}.jpg`),
          'Content-Type': 'b2/x-auto',
          'Content-Length': Buffer.byteLength(fileBuffer),
          'X-Bz-Content-Sha1': getFileHash(fileBuffer),
          'X-Bz-Info-Author': conn.requester.phoneNumber,
        },
      };

      return promisifiedRequest(options);
    })
    .then(response => {
      const photoURL = cloudflareCdnUrl(
        mainDownloadUrlStart,
        response.fileId,
        `${conn.requester.uid}.jpg`,
      );

      try {
        if (fs.existsSync(compressedFilePath)) {
          fs.unlinkSync(compressedFilePath);
        }

        if (fs.existsSync(originalFilePath)) {
          fs.unlinkSync(originalFilePath);
        }

        return auth.updateUser(conn.requester.uid, {photoURL});
      } catch (error) {
        console.warn('Error:', error);

        return auth.updateUser(conn.requester.uid, {photoURL});
      }
    })
    .then(() => sendResponse(conn, code.ok))
    .catch(error =>
      handleError(conn, error, 'Image upload unavailable at the moment...'),
    );
};
