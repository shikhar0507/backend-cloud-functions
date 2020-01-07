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

const isProduction = process.env.GCLOUD_PROJECT === 'my-project';
const systemEmail = `john.doe@gmail.com`;

const vars = {
  youtubeDataApiKey: '',
  cc: '',
  isProduction,
  systemEmail,
  mailReplyTo: '',
  databaseURL: '',
  mainDomain: '',
  firebaseDomain: '',
  supportPhoneNumber: '',
  sgMailParseToken: '',
  cfSecret: '',
  cfUrl: '',
  downloadUrl: '', // download link to your app.
  devEmail: '',
  frontEndDevEmail: ``,
  sgMailApiKey: '',
  mapsApiKey: '',
  allowedOrigins: new Set(),
  instantEmailRecipientEmails: [
    {
      email: 'john.doe@gmail.com',
      name: 'John Doe',
    },
  ],
  smsgupshup: {
    userId: '',
    password: '',
  },
  backblaze: {
    keyId: '',
    accountId: '',
    apiKey: '',
    buckets: {
      images: '',
      sitemaps: '',
      idProof: '',
    },
  },
  supportUid: '',
  getUserBaseUrl: '',
  apiBaseUrl: '',
  tempBucketName: '',
  bulkStorageBucketName: '',
  cashFree: {
    autocollect: {
      clientId: '',
      clientSecret: '',
    },
    payout: {
      clientId: '',
      clientSecret: '',
    },
  },
  cashFreeToken: '',
  fbVerificationToken: '',
};

module.exports = vars;
