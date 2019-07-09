'use strict';

const {
  isE164PhoneNumber,
  isValidEmail,
  hasAdminClaims,
  hasSupportClaims,
} = require('../admin/utils');
const {
  code,
} = require('../admin/responses');
const {
  auth,
  rootCollections,
} = require('../admin/admin');
const {
  sendGridTemplateIds,
} = require('../admin/constants');
const sgMail = require('@sendgrid/mail');
const env = require('../admin/env');

sgMail.setApiKey(env.sgMailApiKey);

const valuesPolyfill = (object) => {
  return Object.keys(object).map((key) => object[key]);
};

/**
 * A temporary polyfill for using `Object.values` since sendgrid has
 * probably removed support for Node 6, but the Node 8 runtime is still
 * suffering from "connection error" issue at this time.
 * Will remove this after a few days.
 *
 * @see https://github.com/sendgrid/sendgrid-nodejs/issues/929
 * @see https://github.com/firebase/firebase-functions/issues/429
 */
Object.values = Object.values || valuesPolyfill;

const validateRequestBody = requestBody => {
  const result = {
    success: true,
    message: '',
  };

  // Request body contains phoneNumber, email, office, displayName
  // If isSupport or admin -> office is required
  // if user has no custom claims, only allow update for self.
  // if phone number is missing, put phone number === requester's phone number

  return result;
};



const sendCustomVerificationEmail = options => {
  const { displayName, email, phoneNumber, uid } = options;

  if (!env.isProduction) {
    return Promise.resolve();
  }

  return sgMail
    .send({
      templateId: sendGridTemplateIds.verificationEmail,
      to: {
        email,
        name: displayName,
      },
      from: {
        name: 'Growthfile Help',
        email: env.systemEmail,
      },
      dynamicTemplateData: {
        phoneNumber,
        verificationUrl: `${env.mainDomain}/verify-email?uid=${uid}`,
      },
      subject: 'Verify your email on Growthfile',
    });
};

const getAuth = (phoneNumber, displayName, email) => {
  return auth
    .getUserByPhoneNumber(phoneNumber)
    .catch(error => {
      if (error.code === 'auth/user-not-found') {
        return auth.createUser({ phoneNumber, displayName, email });
      }

      if (error.code === 'auth/email-already-exists') {
        return new Error(error.code);
      }

      console.error(error);
    });
};

const createVerificationFlow = options => {
  const {
    displayName,
    email,
    uid,
    phoneNumber,
    photoURL,
  } = options;

  console.log('Options', options);

  return rootCollections
    .updates
    .where('phoneNumber', '==', phoneNumber)
    .limit(1)
    .get()
    .then(docs => {
      console.log('size', docs.size);

      const updatesDocRef = (() => {
        if (docs.empty) {
          return rootCollections.updates.doc(uid);
        }

        return docs.docs[0].ref;
      })();

      const updatesDoc = docs.docs[0];

      const verificationRequestsCount = (() => {
        if (updatesDoc && updatesDoc.get('verificationRequestsCount')) {
          return updatesDoc.get('verificationRequestsCount');
        }

        return 0;
      })();

      return Promise
        .all([
          sendCustomVerificationEmail({
            displayName,
            email,
            phoneNumber,
            uid,
          }),
          auth
            .updateUser(uid, {
              displayName,
              email,
              photoURL,
              emailVerified: false,
            }),
          updatesDocRef
            .set({
              // When the user visits the verification link sent
              // to them in the email, this link will allow
              // the backend to verify if their email verification
              // was initiated
              verificationRequestsCount: verificationRequestsCount + 1,
              emailVerificationRequestPending: true,
            }, {
                merge: true,
              })
        ]);
    })
    .then(() => ({
      success: true,
      code: code.ok,
      message: 'Profile updated successfully',
    }))
    .catch(error => {
      return {
        success: false,
        message: error.toString(),
        code: code.badRequest,
      };
    });
};

const handleAdminRequest = (conn, requester) => {
  const employeeCheckPromises = [];
  let employeeFound = false;

  requester
    .adminOffices
    .forEach(officeName => {
      const promise = rootCollections
        .activities
        .where('office', '==', officeName)
        .where('template', '==', 'employee')
        .where('attachment.Employee Contact.value', '==', conn.req.body.phoneNumber)
        .limit(1)
        .get();

      employeeCheckPromises.push(promise);
    });

  return Promise
    .all(employeeCheckPromises)
    .then(snapShots => {
      snapShots.forEach(snapShot => {
        if (snapShot.empty) return;

        employeeFound = true;
      });

      if (!employeeFound) {
        return ({
          code: code.forbidden,
          message: `No employee found with the phone number: `
            + `${conn.req.body.phoneNumber}`,
          success: false,
        });
      }

      // Fetches auth. If not found, creates and returns the auth
      return getAuth(conn.req.body.phoneNumber);
    })
    .then(result => {
      if (result.message) {
        return Promise.resolve(result);
      }

      const options = {
        uid: result.uid,
        email: conn.req.body.email || result.email,
        photoURL: conn.req.body.photoURL || requester.photoURL || undefined,
        displayName: conn.req.body.displayName || result.email,
        phoneNumber: conn.req.body.phoneNumber || result.phoneNumber,
      };

      return createVerificationFlow(options);
    });
};


module.exports = (conn, requester) => {
  const result = validateRequestBody(conn.req.body);

  if (!result.success) {
    return Promise.resolve(result);
  }

  const isSelfUpdateRequest = conn
    .req
    .body
    .phoneNumber === requester.phoneNumber;

  console.log({ isSelfUpdateRequest });

  if (!hasAdminClaims(requester.customClaims)
    && !hasSupportClaims(requester.customClaims)
    // Only support and admin can send requests for modifying
    // someone else's phone number
    && !isSelfUpdateRequest) {
    return Promise.resolve({
      success: false,
      message: 'You cannot perform this operation',
      code: code.forbidden,
    });
  }

  if (!isSelfUpdateRequest
    && requester.isAdmin
    && !requester.adminOffices.includes(conn.req.body.office)) {
    return ({
      success: false,
      message: 'You cannot perform this operation',
      code: code.forbidden,
    });
  }

  const isPrivilidgedUser = Boolean(
    requester.customClaims
    && (
      requester.customClaims.admin
      || requester.customClaims.support
    )
  );

  // Normal user who is trying to update self
  if (!isPrivilidgedUser || isSelfUpdateRequest) {
    const options = {
      email: conn.req.body.email || requester.email,
      photoURL: conn.req.body.photoURL || requester.photoURL,
      uid: requester.uid,
      displayName: conn.req.body.displayName || requester.displayName,
      phoneNumber: conn.req.body.phoneNumber || requester.phoneNumber,
    };

    console.log('isPrivilidgedUser || isSelfUpdateRequest');

    return createVerificationFlow(options);
  }

  if (requester.isSupport) {
    return getAuth(conn.req.body.phoneNumber)
      .then(userRecord => {
        const options = {
          email: conn.req.body.email || userRecord.email,
          photoURL: conn.req.body.photoURL || requester.photoURL || undefined,
          uid: userRecord.uid,
          displayName: conn.req.body.displayName || userRecord.email,
          phoneNumber: conn.req.body.phoneNumber,
        };

        console.log('requester.isSupport');

        return createVerificationFlow(options);
      });
  }

  return handleAdminRequest(conn, requester);
};
