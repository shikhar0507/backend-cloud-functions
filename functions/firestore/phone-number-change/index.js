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

const deleteAuth = async uid => {
  try {
    return auth.deleteUser(uid);
  } catch (error) {
    console.warn(error);
    return {};
  }
};

const getAuth = async phoneNumber => {
  try {
    return auth.getUserByPhoneNumber(phoneNumber);
  } catch (error) {
    console.warn(error);

    return {
      phoneNumber: {},
    };
  }
};


const deleteUpdates = async uid => {
  const batch = db.batch();

  batch.delete(rootCollections.updates.doc(uid));

  const docs = rootCollections
    .updates
    .doc(uid)
    .collection('Addendum')
    .get();

  docs.forEach(doc => {
    batch.delete(doc.ref);
  });

  return Promise
    .all([
      batch.commit(),
      deleteAuth(uid)
    ]);
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

const transferActivitiesToNewProfile = async conn => {
  const newPhoneNumberAuth = await getAuth(conn.req.body.newPhoneNumber);

  const runQuery = (query, resolve, reject) => {
    return query
      .get()
      .then(activitiesInProfile => {
        if (activitiesInProfile.empty) {
          return [0];
        }

        console.log('profileActivities', activitiesInProfile.size);

        const batch = db.batch();

        activitiesInProfile.forEach(profileActivity => {
          const rootActivityRef = rootCollections
            .activities
            .doc(profileActivity.id);

          console.log({
            id: rootActivityRef.id,
            template: profileActivity.get('template'),
          });

          // Add new assignee
          batch
            .set(rootActivityRef
              .collection('Assignees')
              .doc(conn.req.body.newPhoneNumber), {
                canEdit: profileActivity.get('canEdit'),
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
            newPhoneNumberAuth
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

  try {
    return new Promise((resolve, reject) => {
      return runQuery(query, resolve, reject);
    });
  } catch (error) {
    console.error(error);
  }
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


module.exports = async conn => {
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
      `You cannot access this resource`
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

  const promises = [
    rootCollections
      .offices
      .where('office', '==', conn.req.body.office)
      .limit(1)
      .get(),
    rootCollections
      .activities
      .where('office', '==', conn.req.body.office)
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', 'employee')
      .where('attachment.Employee Contact.value', '==', conn.req.body.oldPhoneNumber)
      .limit(1)
      .get(),
    rootCollections
      .activities
      .where('office', '==', conn.req.body.office)
      .where('status', '==', 'CONFIRMED')
      .where('template', '==', 'employee')
      .where('attachment.Employee Contact.value', '==', conn.req.body.newPhoneNumber)
      .limit(1)
      .get(),
    rootCollections
      .profiles
      .doc(conn.req.body.oldPhoneNumber)
      .get(),
  ];

  try {
    const [
      officeQueryResult,
      oldEmployeeQueryResult,
      newEmployeeQueryResult,
      oldProfileDoc,
    ] = await Promise.all(promises);

    if (oldEmployeeQueryResult.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `${conn.req.body.oldPhoneNumber} is not an employee`
      );
    }

    if (!newEmployeeQueryResult.empty) {
      return sendResponse(
        conn,
        code.badRequest,
        `${conn.req.body.oldPhoneNumber} is already an employee`
      );
    }

    const {
      uid,
      employeeOf
    } = oldProfileDoc.data();

    const officeList = Object.keys(employeeOf || {});

    if (officeList.length <= 1) {
      await oldProfileDoc.ref.delete();
    }

    await transferActivitiesToNewProfile(conn);
    await deleteUpdates(uid);

    const officeDoc = officeQueryResult.docs[0];
    const {
      date,
      months,
      years
    } = require('moment')().toObject();

    await officeDoc
      .ref
      .collection('Addendum')
      .doc()
      .set({
        date,
        month: months,
        year: years,
        timestamp: Date.now(),
        user: conn.requester.phoneNumber,
        action: httpsActions.updatePhoneNumber,
        oldPhoneNumber: conn.req.body.oldPhoneNumber,
        newPhoneNumber: conn.req.body.newPhoneNumber,
        isSupportRequest: conn.requester.isSupportRequest || false,
      });

    return sendResponse(
      conn,
      code.ok,
      'Phone number updated successfully'
    );
  } catch (error) {
    handleError(conn, error);
  }
};
