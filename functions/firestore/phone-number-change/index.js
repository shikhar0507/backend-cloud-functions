'use strict';

const {
  rootCollections,
  db,
  auth,
} = require('../../admin/admin');
const {
  sendResponse,
  handleError,
  isNonEmptyString,
  hasAdminClaims,
  isE164PhoneNumber,
} = require('../../admin/utils');
const {
  code,
} = require('../../admin/responses');
const {
  httpsActions,
} = require('../../admin/constants');
const admin = require('firebase-admin');


const getAuth = phoneNumber => {
  return auth
    .getUserByPhoneNumber(phoneNumber)
    .catch(error => {
      if (error.code === 'auth/user-not-found') {
        return {
          phoneNumber,
          displayName: '',
          photoURL: '',
        };
      }

      console.error(error);
    });
};

const validateRequest = body => {
  const messageObject = {
    isValid: true,
    message: null,
  };

  if (!body.hasOwnProperty('oldPhoneNumber')) {
    messageObject.isValid = false;
    messageObject.message =
      `Request body is missing the field: 'oldPhoneNumber'`;

    return messageObject;
  }

  if (!body.hasOwnProperty('newPhoneNumber')) {
    messageObject.isValid = false;
    messageObject.message =
      `Request body is missing the field: 'newPhoneNumber'`;

    return messageObject;
  }

  if (!body.hasOwnProperty('office')) {
    messageObject.isValid = false;
    messageObject.message = `Request body is missing the field: 'office'`;

    return messageObject;
  }

  if (!isNonEmptyString(body.office)) {
    messageObject.isValid = false;
    messageObject.message = `The field 'office' should be a non-empty string`;

    return messageObject;
  }

  if (!isE164PhoneNumber(body.oldPhoneNumber)) {
    messageObject.isValid = false;
    messageObject.message = `The field 'oldPhoneNumber' should be`
      + ` a valid E.164 phone number`;

    return messageObject;
  }

  if (!isE164PhoneNumber(body.newPhoneNumber)) {
    messageObject.isValid = false;
    messageObject.message =
      `The field 'newPhoneNumber' should be`
      + ` a valid E.164 phone number`;

    return messageObject;
  }

  return messageObject;
};

const updatePhoneNumberFields = (doc, oldPhoneNumber, newPhoneNumber, newPhoneNumberAuth) => {
  const result = doc.data();
  const attachment = doc.get('attachment');
  const creator = doc.get('creator');
  result.timestamp = Date.now();
  result.addendumDocRef = null;
  delete result.assignees;

  if (creator === oldPhoneNumber
    || creator.phoneNumber === oldPhoneNumber) {
    result.creator = {
      phoneNumber: newPhoneNumber,
      photoURL: newPhoneNumberAuth.photoURL || '',
      displayName: newPhoneNumberAuth.displayName || '',
    };
  }

  Object
    .keys(attachment)
    .forEach(field => {
      const item = attachment[field];

      if (item.value === oldPhoneNumber) {
        result
          .attachment[field]
          .value = newPhoneNumber;
      }
    });

  return result;
};

const deleteUpdates = oldPhoneNumberUid => {
  if (!oldPhoneNumberUid) {
    return Promise
      .resolve();
  }

  return rootCollections
    .updates
    .doc(oldPhoneNumberUid)
    .collection('Addendum')
    .get()
    .then(docs => {
      const batch = db.batch();

      docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      batch.delete(rootCollections
        .updates
        .doc(oldPhoneNumberUid));

      return batch.commit();
    })
    .then(() => {
      return auth
        .deleteUser(oldPhoneNumberUid);
    })
    .catch(error => {
      if (error.code === 'auth/user-not-found') {
        return;
      }

      console.error(error);
    });
};

const getCanEditValue = (canEditRule, creator, conn, locals) => {
  if (canEditRule === 'CREATOR') {
    return creator === conn.req.body.newPhoneNumber;
  }

  if (canEditRule === 'ADMIN') {
    return locals
      .newPhoneNumberIsAdmin;
  }

  if (canEditRule === 'EMPLOYEE') {
    // If the new phone number is already an employee,
    // code the request will be rejected in the previous step.
    return false;
  }

  if (canEditRule === 'NONE') {
    return false;
  }

  // canEditRule is `ALL`
  return true;
};

const createAddendum = async (conn, locals) => {
  const moment = require('moment');

  return locals
    .officeDoc
    .ref
    .collection('Addendum')
    .doc()
    .set({
      date: moment().date(),
      month: moment().month(),
      year: moment().year(),
      timestamp: Date.now(),
      user: conn.requester.phoneNumber,
      action: httpsActions.updatePhoneNumber,
      oldPhoneNumber: conn.req.body.oldPhoneNumber,
      newPhoneNumber: conn.req.body.newPhoneNumber,
      isSupportRequest: conn.requester.isSupportRequest || false,
    });
};

const transferActivitiesToNewProfile = (conn, locals) => {
  let iterations = 0;

  const runQuery = (query, resolve, reject) => {
    return query
      .get()
      .then(activitiesInProfile => {
        if (activitiesInProfile.empty) {
          return [0];
        }

        iterations++;
        console.log('profileActivities', activitiesInProfile.size);

        const batch = db.batch();

        activitiesInProfile.forEach(profileActivity => {
          const rootActivityRef = rootCollections
            .activities
            .doc(profileActivity.id);
          const canEdit = getCanEditValue(
            profileActivity.get('canEditRule'),
            profileActivity.get('creator'),
            conn,
            locals
          );

          console.log({
            id: rootActivityRef.id,
            template: profileActivity.get('template'),
          });

          // Add new assignee
          batch
            .set(rootActivityRef
              .collection('Assignees')
              .doc(conn.req.body.newPhoneNumber), {
                canEdit,
                addToInclude: profileActivity.get('template') !== 'subscription',
              }, {
                merge: true,
              });

          // Remove old assignee
          batch
            .delete(rootActivityRef
              .collection('Assignees')
              .doc(conn.req.body.oldPhoneNumber)
            );

          const activityData = updatePhoneNumberFields(
            profileActivity,
            conn.req.body.oldPhoneNumber,
            conn.req.body.newPhoneNumber,
            locals.newPhoneNumberAuth
          );

          // Update the main activity in root `Activities` collection
          batch
            .set(rootActivityRef, activityData, {
              merge: true,
            });
        });

        return Promise
          .all([
            Promise
              .resolve(activitiesInProfile.docs[activitiesInProfile.size - 1]),
            batch
              .commit(),
          ]);
      })
      .then(result => {
        const [lastDoc] = result;

        if (!lastDoc) {
          return resolve();
        }

        return process
          .nextTick(() => {
            const newQuery = query
              // Using greater than sign because we need
              // to start after the last activity which was
              // processed by this code otherwise some activities
              // might be updated more than once.
              .where(admin.firestore.FieldPath.documentId(), '>', lastDoc.id);

            return runQuery(newQuery, resolve, reject);
          });
      })
      .catch(reject);
  };

  const MAX_UPDATES_AT_ONCE = 200;
  const query = rootCollections
    .profiles
    .doc(conn.req.body.oldPhoneNumber)
    .collection('Activities')
    .where('office', '==', conn.req.body.office)
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(MAX_UPDATES_AT_ONCE);

  return new Promise((resolve, reject) => {
    console.log('transferActivitiesToNewProfile');

    return runQuery(query, resolve, reject);
  })
    .then(() => {
      console.log({ iterations });

      return deleteUpdates(locals.oldPhoneNumberUid);
    })
    .then(() => createAddendum(conn, locals));
};

module.exports = conn => {
  if (conn.req.method !== 'POST') {
    return sendResponse(
      conn,
      code.methodNotAllowed,
      `${conn.req.method} is not allowed. Use POST`
    );
  }

  if (!conn.requester.isSupportRequest
    && !hasAdminClaims(conn.requester.customClaims)) {
    return sendResponse(
      conn,
      code.unauthorized,
      'You cannot access this resource'
    );
  }

  const validationResult = validateRequest(conn.req.body);

  if (!validationResult.isValid) {
    return sendResponse(
      conn,
      code.badRequest,
      validationResult.message
    );
  }

  if (conn.requester.phoneNumber
    === conn.req.body.oldPhoneNumber) {
    return sendResponse(
      conn,
      code.forbidden,
      `You cannot change your own phone number`
    );
  }

  if (conn.req.body.oldPhoneNumber
    === conn.req.body.newPhoneNumber) {
    return sendResponse(
      conn,
      code.badRequest,
      'Old and the new phone number cannot be the same.'
    );
  }

  let failed = false;
  const locals = {};

  return Promise
    .all([
      rootCollections
        .offices
        .where('office', '==', conn.req.body.office)
        .limit(1)
        .get(),
      rootCollections
        .activities
        .where('status', '==', 'CONFIRMED')
        .where('template', '==', 'employee')
        .where('attachment.Employee Contact.value', '==', conn.req.body.oldPhoneNumber)
        .limit(1)
        .get(),
      rootCollections
        .activities
        .where('status', '==', 'CONFIRMED')
        .where('template', '==', 'employee')
        .where('attachment.Employee Contact.value', '==', conn.req.body.newPhoneNumber)
        .limit(1)
        .get(),
      rootCollections
        .activities
        .where('status', '==', 'CONFIRMED')
        .where('template', '==', 'admin')
        .where('attachment.Admin.value', '==', conn.req.body.newPhoneNumber)
        .limit(1)
        .get(),
      rootCollections
        .profiles
        .doc(conn.req.body.oldPhoneNumber)
        .get(),
      rootCollections
        .profiles
        .doc(conn.req.body.newPhoneNumber)
        .get(),
      getAuth(conn.req.body.newPhoneNumber)
    ])
    .then(result => {
      const [
        officeQueryResult,
        oldEmployeeQueryResult,
        newEmployeeQueryResult,
        newPhoneNumberAdminQueryResult,
        oldPhoneNumberProfileDoc,
        newPhoneNumberProfileDoc,
        newPhoneNumberAuth,
      ] = result;

      if (officeQueryResult.empty) {
        failed = true;

        return sendResponse(
          conn,
          code.badRequest,
          `Office: ${conn.req.body.office} not found`
        );
      }

      if (oldEmployeeQueryResult.empty) {
        failed = true;

        return sendResponse(
          conn,
          code.badRequest,
          `${conn.req.body.oldPhoneNumber} is not an employee`
        );
      }

      if (!newEmployeeQueryResult.empty) {
        failed = true;

        return sendResponse(
          conn,
          code.badRequest,
          `${conn.req.body.newPhoneNumber} is already an employee`
        );
      }

      locals.oldPhoneNumberUid = '';
      locals.officeDoc = officeQueryResult.docs[0];
      locals.oldPhoneNumberProfileDoc = oldPhoneNumberProfileDoc;
      locals.newPhoneNumberIsAdmin = newPhoneNumberAdminQueryResult.size !== 0;
      locals.newPhoneNumberAuth = newPhoneNumberAuth;

      if (oldPhoneNumberProfileDoc.exists) {
        locals
          .oldPhoneNumberUid = oldPhoneNumberProfileDoc
            .get('uid') || '';
      }

      if (newPhoneNumberProfileDoc.exists) {
        const employeeOf = newPhoneNumberProfileDoc
          .get('employeeOf') || {};

        /** Is in single office */
        locals
          .deleteOldProfile = Object
            .keys(employeeOf)
            .length <= 1;
      }

      return transferActivitiesToNewProfile(conn, locals);
    })
    .then(() => {
      if (failed) return;
      if (!locals.deleteOldProfile) return;

      return locals
        .oldPhoneNumberProfileDoc
        .ref
        .delete();
    })
    .then(() => {
      if (failed) return;

      return sendResponse(
        conn,
        code.ok,
        'Phone number updated successfully'
      );
    })
    .catch(error => handleError(conn, error));
};
