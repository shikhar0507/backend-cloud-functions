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

const { rootCollections } = require('../admin/admin');
const { getFileHash, sendJSON, sendResponse } = require('../admin/utils');
const { code } = require('../admin/responses');
const rpn = require('request-promise-native');
const fs = require('fs');
const env = require('../admin/env');
const url = require('url');
const uuidv1 = require('uuid/v1');

let authorizationToken;
let uploadUrl;

const isPossiblyValidAadharNumber = input => /^\d{4}\d{4}\d{4}$/.test(input);

const isPossiblyValidPan = input =>
  /^([a-zA-Z]){5}([0-9]){4}([a-zA-Z]){1}?$/.test(input);

const validator = body => {
  if (
    !body.aadhar ||
    !body.aadhar.number ||
    !isPossiblyValidAadharNumber(body.aadhar.number)
  ) {
    return `'Invalid/missing 'aadhar' in the request body`;
  }

  if (!body.pan || !body.pan.number || !isPossiblyValidPan(body.pan.number)) {
    return `Invalid/missing 'pan' in the request body`;
  }

  // TODO: Validate base64 here.

  return null;
};

const setImgUrl = async ({
  base64,
  phoneNumber,
  fieldPath,
  backblazeAuthorizationToken,
  apiUrl,
  idProof = {},
}) => {
  const fileName = uuidv1();
  const filePath = `/tmp/${fileName}.jpg`;

  // Is already an image url set previously.
  if (base64.startsWith('https://')) {
    return base64;
  }

  try {
    fs.writeFileSync(filePath, base64, { encoding: 'base64' });
    const fileBuffer = fs.readFileSync(filePath);
    const uploadUri = url.resolve(
      apiUrl,
      `/b2api/v2/b2_get_upload_url?bucketId=${env.backblaze.buckets.idProof}`,
    );

    if (!authorizationToken || !uploadUri) {
      const step1 = await rpn(uploadUri, {
        method: 'GET',
        json: true,
        headers: {
          Authorization: backblazeAuthorizationToken,
        },
      });

      authorizationToken = step1.authorizationToken;
      uploadUrl = step1.uploadUrl;
    }

    const step2 = await rpn(uploadUrl, {
      body: fileBuffer,
      method: 'POST',
      headers: {
        Authorization: authorizationToken,
        'X-Bz-File-Name': encodeURI(`${fileName}.jpg`),
        'Content-Type': 'b2/x-auto',
        'Content-Length': Buffer.byteLength(fileBuffer),
        'X-Bz-Content-Sha1': getFileHash(fileBuffer),
        'X-Bz-Info-Author': phoneNumber,
      },
    });

    // Adding { json:true } in the options, results
    // in ERROR: Connection reset. Skipping that option
    // and parsing the response fixes it.
    const { fileId } = JSON.parse(step2);
    const final = (() => {
      if (env.isProduction) {
        return (
          `https://photos.growthfile.com/file/` +
          `growthfile-207204-id-proof/${fileName}.jpg`
        );
      }

      // A very convoluted way to do this.
      // But I don't have the time to touch it.
      return (
        `https://${apiUrl.split('https://')[1]}` +
        `/b2api/v2/b2_download_file_by_id` +
        `?fileId=${fileId}`
      );
    })();

    const [parentProp, childProp] = fieldPath.split('.');
    idProof[parentProp] = idProof[parentProp] || {};
    idProof[parentProp][childProp] = final;

    return final;
  } catch (error) {
    console.error(error);

    return '';
  } finally {
    // Cleanup to avoid unnecessary memory usage.
    fs.unlinkSync(filePath);
  }
};

module.exports = async conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `'${conn.req.method}' is not allowed. Use 'POST'`,
    );
  }

  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  const { aadhar, pan } = conn.req.body;
  const frontAadharEnc = aadhar.front.split(';base64,').pop();
  const backAadharEnc = aadhar.back.split(';base64,').pop();
  const frontPanEnc = pan.front.split(';base64,').pop();
  const { phoneNumber, uid } = conn.requester;

  const [timerDoc] = (
    await rootCollections.timers.orderBy('timestamp', 'desc').limit(1).get()
  ).docs;

  const { backblazeAuthorizationToken, apiUrl } = timerDoc.data();
  const updatesDoc = await rootCollections.updates.doc(uid).get();
  const { idProof } = updatesDoc.data();

  const responseObject = {
    aadhar: {
      front: await setImgUrl({
        idProof,
        phoneNumber,
        backblazeAuthorizationToken,
        apiUrl,
        base64: frontAadharEnc,
        fieldPath: 'aadhar.front',
      }),
      back: await setImgUrl({
        idProof,
        phoneNumber,
        uid,
        backblazeAuthorizationToken,
        apiUrl,
        base64: backAadharEnc,
        fieldPath: 'aadhar.back',
      }),
      number: conn.req.body.aadhar.number,
    },
    pan: {
      front: await setImgUrl({
        idProof,
        phoneNumber,
        backblazeAuthorizationToken,
        apiUrl,
        base64: frontPanEnc,
        fieldPath: 'pan.front',
      }),
      number: conn.req.body.pan.number,
    },
  };

  await updatesDoc.ref.set(
    {
      idProof: {
        aadhar: {
          front: responseObject.aadhar.front,
          back: responseObject.aadhar.back,
          number: conn.req.body.aadhar.number,
        },
        pan: {
          front: responseObject.pan.front,
          number: conn.req.body.pan.number,
        },
      },
    },
    {
      merge: true,
    },
  );

  return sendJSON(conn, responseObject);
};
