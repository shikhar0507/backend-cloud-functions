'use strict';

const {code} = require('../admin/responses');
const {auth, rootCollections} = require('../admin/admin');
const {isNonEmptyString} = require('../admin/utils');
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
