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
const {
  auth,
} = require('../admin/admin');
const { code } = require('../admin/responses');
const fs = require('fs');
const url = require('url');
const mozjpeg = require('mozjpeg');
const env = require('../admin/env');


const validateRequest = (requestBody) => {
  const validationResult = {
    isValid: true,
    message: null,
  };

  if (!requestBody.hasOwnProperty('imageBase64')) {
    validationResult.message =
      `The field 'imageBase64' is missing from the request body.`;
    validationResult.isValid = false;
  }

  if (!isNonEmptyString(requestBody.imageBase64)) {
    validationResult.message = `The field 'imageBase64'`
      + ` should be a non-empty 'string'.`;
    validationResult.isValid = false;
  }

  return validationResult;
};


module.exports = (conn) => {
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
      .catch((error) => handleError(conn, error));

    return;
  }

  // endpoint for enabling the frontend to set images to auth
  let authorizationToken = '';
  let mainDownloadUrlStart = '';
  const bucketId = env.backblaze.buckets.images;
  const applicationKey = env.backblaze.apiKey;
  const keyId = env.backblaze.keyId;
  const getKeyId = (applicationKey) => `${keyId}:${applicationKey}`;
  const keyWithPrefix = getKeyId(applicationKey);
  const authorization =
    `Basic ${Buffer.from(keyWithPrefix).toString('base64')}`;
  const originalFileName = `${conn.requester.uid}-original.jpg`;
  const originalFilePath = `/tmp/${originalFileName}`;
  const compressedFilePath = `/tmp/${conn.requester.uid}.jpg`;
  const base64ImageString = conn.req.body.imageBase64.split(';base64,').pop();

  fs.writeFileSync(originalFilePath, base64ImageString, {
    encoding: 'base64',
  });

  promisifiedExecFile(mozjpeg, ['-outfile', compressedFilePath, originalFilePath])
    .then(() => promisifiedRequest({
      hostname: `api.backblazeb2.com`,
      path: `/b2api/v2/b2_authorize_account`,
      headers: {
        Authorization: authorization,
      },
    }))
    .then((response) => {
      authorizationToken = response.authorizationToken;
      const newHostName = response.apiUrl.split('https://')[1];
      console.log({ newHostName });
      mainDownloadUrlStart = newHostName;

      return promisifiedRequest({
        hostname: newHostName,
        path: `/b2api/v2/b2_get_upload_url?bucketId=${bucketId}`,
        method: 'GET',
        headers: {
          'Authorization': authorizationToken,
        },
      });
    })
    .then((response) => {
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
          'X-Bz-File-Name': encodeURI(`${conn.requester.uid}.jpg`),
          'Content-Type': 'b2/x-auto',
          'Content-Length': Buffer.byteLength(fileBuffer),
          'X-Bz-Content-Sha1': getFileHash(fileBuffer),
          'X-Bz-Info-Author': conn.requester.phoneNumber,
        },
      };

      return promisifiedRequest(options);
    })
    .then((response) => {
      const url =
        cloudflareCdnUrl(
          mainDownloadUrlStart,
          response.fileId,
          `${conn.requester.uid}.jpg`
        );

      try {
        fs.unlink(compressedFilePath);
        fs.unlink(originalFilePath);

        return auth
          .updateUser(conn.requester.uid, {
            photoURL: url,
          });

      } catch (error) {
        console.log('Error:', error);

        return auth
          .updateUser(conn.requester.uid, {
            photoURL: url,
          });
      }
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error, 'Image upload unavailable at the moment...'));
};
