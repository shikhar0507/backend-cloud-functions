'use strict';

const {
  rootCollections,
} = require('../admin/admin');
const {
  getFileHash,
  sendJSON,
  cloudflareCdnUrl,
  sendResponse,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');
const rpn = require('request-promise-native');
const fs = require('fs');
const env = require('../admin/env');
const url = require('url');
const uuidv1 = require('uuid/v1');

const isPossiblyValidAadharNumber = input => /^\d{4}\d{4}\d{4}$/
  .test(input);

const isPossiblyValidPan = input => /^([a-zA-Z]){5}([0-9]){4}([a-zA-Z]){1}?$/
  .test(input);

const validator = body => {
  if (!body.aadhar ||
    !body.aadhar.number ||
    !isPossiblyValidAadharNumber(body.aadhar.number)) {
    return `'Field 'aadhar' is missing from request body.`;
  }

  if (!body.pan ||
    !body.pan.number ||
    !isPossiblyValidPan(body.pan.number)) {
    return `Invalid PAN`;
  }

  // TODO: Validate base64 here.

  return null;
};

const setImgUrl = async (base64, phoneNumber, uid, fieldPath) => {
  try {
    const idProof = {
      [fieldPath]: base64,
    };

    if (base64.startsWith('https://')) {
      return rootCollections.updates.doc(uid).set(idProof, {merge: true});
    }

    const fileName = uuidv1();
    const filePath = `/tmp/${fileName}.jpg`;

    fs.writeFileSync(filePath, base64, { encoding: 'base64' });

    const fileBuffer = fs.readFileSync(filePath);
    const [timerDoc] = (
      await rootCollections
      .timers
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get()
    ).docs;

    const { backblazeAuthorizationToken, apiUrl } = timerDoc.data();
    const uploadUri = url.resolve(
      apiUrl,
      `/b2api/v2/b2_get_upload_url?bucketId=${env.backblaze.buckets.idProof}`
    );

    const step1 = await rpn(uploadUri, {
      method: 'GET',
      json: true,
      headers: {
        Authorization: backblazeAuthorizationToken,
      },
    });

    const {
      authorizationToken,
      uploadUrl,
    } = step1;

    const step2 = await rpn(uploadUrl, {
      method: 'POST',
      body: fileBuffer,
      json: true,
      headers: {
        'Authorization': authorizationToken,
        'X-Bz-File-Name': encodeURI(fileName),
        'Content-Type': 'b2/x-auto',
        'Content-Length': Buffer.byteLength(fileBuffer),
        'X-Bz-Content-Sha1': getFileHash(fileBuffer),
        'X-Bz-Info-Author': phoneNumber,
      },
    });

    const { fileId } = step2;
    const final = cloudflareCdnUrl(
      apiUrl.split('https://')[1],
      fileId,
      fileName,
    );

    idProof[fieldPath] = final;

    await rootCollections
      .updates
      .doc(uid)
      .set({
        idProof,
      }, {
        merge: true,
      });

    return final;
  } catch(error) {
    console.error(error);

    return '';
  }
};

module.exports = async conn => {
  const v = validator(conn.req.body);

  if (v) {
    return sendResponse(conn, code.badRequest, v);
  }

  const { aadhar, pan } = conn.req.body;
  const frontAadharEnc = aadhar.front.split(';base64,').pop();
  const backAadharEnc = aadhar.back.split(';base64,').pop();
  const frontPanEnc = pan.front.split(';base64,').pop();
  const backPanEnc = pan.back.split(';base64,').pop();
  const { phoneNumber, uid } = conn.requester;

  return sendJSON(conn, {
    aadhar: {
      front: await setImgUrl(frontAadharEnc, phoneNumber, uid, 'aadhar.front'),
      back: await setImgUrl(backAadharEnc, phoneNumber, uid, 'aadhar.back'),
      number: conn.req.body.aadhar.number,
    },
    pan: {
      front: await setImgUrl(frontPanEnc, phoneNumber, uid, 'pan.front'),
      back: await setImgUrl(backPanEnc, phoneNumber, uid, 'pan.back'),
      number: conn.req.body.pan.number,
    },
  });
};
