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


const { rootCollections, } = require('../../admin/admin');


/**
 * Copies the document created at the path 
 * `/Offices/(officeId)/Subscriptions/(activityId)` to 
 * `/Profiles/(subcriberPhoneNumber)/Subscriptions/(activityId)`.
 * 
 * @param {Object} doc Doc ref of the document created `onWrite()`.
 * @param {Object} context Data about the `event`.
 * @returns {Promise <Object>} Batch object.
 */
module.exports = (doc, context) => {
  const docData = doc.data();

  const activityId = doc.get('activityId');
  const subscriberPhoneNumber = doc.get('phoneNumber');

  return rootCollections
    .profiles
    .doc(subscriberPhoneNumber)
    .collection('Subscriptions')
    .doc(activityId)
    .set(docData)
    /* eslint no-console: "off" */
    .catch(console.error);
};
