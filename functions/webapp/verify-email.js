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

const { code } = require('../admin/responses');
const { auth, rootCollections } = require('../admin/admin');
const { isNonEmptyString } = require('../admin/utils');
const admin = require('firebase-admin');

module.exports = async conn => {
  if (!isNonEmptyString(conn.req.query.uid)) {
    return conn.res.status(code.temporaryRedirect).redirect('/');
  }

  try {
    const updatesDoc = await rootCollections.updates
      .doc(conn.req.query.uid)
      .get();

    if (
      !updatesDoc.exists ||
      !updatesDoc.get('emailVerificationRequestPending')
    ) {
      return conn.res.status(code.temporaryRedirect).redirect('/');
    }

    await Promise.all([
      auth.updateUser(conn.req.query.uid, {
        emailVerified: true,
      }),
      updatesDoc.ref.set(
        {
          emailVerificationRequestPending: admin.firestore.FieldValue.delete(),
          verificationRequestsCount:
            (updatesDoc.get('verificationRequestsCount') || 0) + 1,
        },
        {
          merge: true,
        },
      ),
    ]);

    return conn.res.status(code.temporaryRedirect).redirect('/');
  } catch (error) {
    console.error(error);

    return conn.res
      .status(code.internalServerError)
      .send('Something went wrong');
  }
};
