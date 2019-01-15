'use strict';

const {
  sendJSON,
  sendResponse,
  handleError,
  isNonEmptyString,
  promisifiedRequest,
} = require('../admin/utils');
const {
  auth,
} = require('../admin/admin');
const { code } = require('../admin/responses');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');
const { execFile } = require('child_process');
const mozjpeg = require('mozjpeg');
const env = require('../admin/env');


const promisifiedExecFile = (command, args) => {
  return new Promise((resolve, reject) => {
    return execFile(command, args, (error) => {
      if (error) {
        return reject(new Error(error));
      }

      return resolve(true);
    });
  });
};


const getFileHash = (fileBuffer) =>
  crypto
    .createHash('sha1')
    .update(fileBuffer)
    .digest('hex');


/**
 * Takes in the backblaze main download url along with the fileName (uid of the uploader)
 * and returns the downloadable pretty URL for the client to consume.
 * 
 * `Note`: photos.growthfile.com is behind the Cloudflare + Backblaze CDN, but only for
 * the production project, oso the pretty url will only show up for the production and
 * not for any other project that the code runs on.
 * 
 * @param {string} mainDownloadUrlStart Backblaze main download host url.
 * @param {string} fileId File ID returned by Backblaze.
 * @param {string} fileName Equals to the uid of the uploader.
 * @returns {string} File download url.
 */
const getDownloadUrl = (mainDownloadUrlStart, fileId, fileName) => {
  if (env.isProduction) {
    return `${env.imageCdnUrl}/${fileName}`;
  }

  return `https://${mainDownloadUrlStart}`
    + `/b2api/v2/b2_download_file_by_id`
    + `?fileId=${fileId}`;
};


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
    validationResult.message = `The field 'imageBase64' should be a 'string'.`;
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

  // endpoint for enabling the frontend to upload images
  let authorizationToken = '';
  let mainDownloadUrlStart = '';
  const bucketId = env.backblaze.buckets.images;
  const applicationKey = env.backblaze.apiKey;
  const keyId = env.backblaze.keyId;
  const getKeyId = (applicationKey) => `${keyId}:${applicationKey}`;
  const keyWithPrefix = getKeyId(applicationKey);
  const authorization =
    `Basic ${new Buffer(keyWithPrefix).toString('base64')}`;
  const originalFileName = `${conn.requester.uid}-original.jpg`;
  const originalFilePath = `/tmp/${originalFileName}`;
  const compressedFilePath = `/tmp/${conn.requester.uid}.jpg`;
  const base64ImageString = conn.req.body.imageBase64.split(';base64,').pop();

  fs.writeFileSync(originalFilePath, base64ImageString, {
    encoding: 'base64',
  });

  promisifiedExecFile(mozjpeg, ['-outfile', compressedFilePath, originalFilePath])
    .then(() => {
      return promisifiedRequest({
        hostname: `api.backblazeb2.com`,
        path: `/b2api/v2/b2_authorize_account`,
        headers: {
          Authorization: authorization,
        },
      });
    })
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
      console.log({ response });

      const url =
        getDownloadUrl(
          mainDownloadUrlStart,
          response.fileId,
          `${conn.requester.uid}.jpg`
        );

      console.log({ url });

      return auth
        .updateUser(conn.requester.uid, {
          photoURL: url,
        });
    })
    .then(() => sendResponse(conn, code.noContent))
    .catch((error) => handleError(conn, error, 'Image upload unavailable at the moment...'));
};
