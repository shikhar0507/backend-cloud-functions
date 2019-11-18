'use strict';

const {
  db,
  rootCollections,
} = require('../admin/admin');
const {
  getAuth,
  handleError,
  sendResponse,
  isE164PhoneNumber,
} = require('../admin/utils');
const {
  httpsActions,
  subcollectionNames,
} = require('../admin/constants');
const {
  code,
} = require('../admin/responses');
const admin = require('firebase-admin');


const validator = (body, oldPhoneNumber) => {
  if (!body.hasOwnProperty('newPhoneNumber')) {
    return `Field 'newPhoneNumber' is missing`
      + ` from the request body`;
  }

  if (!isE164PhoneNumber(body.newPhoneNumber)) {
    return `Invalid phone number:`
      + ` '${body.newPhoneNumber}' in the request body`;
  }

  if (body.newPhoneNumber === oldPhoneNumber) {
    return `Old Phone Number cannot be the same as`
      + ` the New Phone Number`;
  }

  return null;
};


const populateActivities = async (oldPhoneNumber, newPhoneNumber) => {
  const updateActivities = async (query, resolve, reject) => {
    const snap = await query.get();

    console.log('docs', snap.size);

    if (snap.empty) {
      return resolve();
    }

    const batch = db.batch();

    snap
      .forEach(doc => {
        const activityOld = doc.data();
        // replace old phone number in activities
        // creator, creator.phoneNumber
        if (doc.get('template') === 'check-in') {
          batch
            .delete(doc.ref);

          return;
        }

        const data = Object
          .assign({}, doc.data(), {
            addendumDocRef: null,
            timestamp: Date.now(),
          });

        const attachment = doc.get('attachment');

        console.log('Activity:', doc.ref.path);

        const creator = (() => {
          if (typeof doc.get('creator') === 'string') {
            return {
              displayName: '',
              photoURL: '',
              phoneNumber: doc.get('creator'),
            };
          }

          return doc.get('creator');
        })();

        if (creator.phoneNumber === oldPhoneNumber) {
          data
            .creator = Object
              .assign({}, creator, {
                phoneNumber: newPhoneNumber,
              });
        }

        const fields = Object.keys(attachment);

        fields
          .forEach(field => {
            const { value, type } = attachment[field];

            if (type !== 'phoneNumber') {
              return;
            }

            if (value === oldPhoneNumber) {
              data
                .attachment[field]
                .value = newPhoneNumber;
            }
          });

        const ref = rootCollections
          .activities
          .doc(doc.id);

        if (data.template === 'employee'
          && data.attachment['Employee Contact'].value === oldPhoneNumber) {
          const officeId = data.officeId;

          const ref = rootCollections
            .offices
            .doc(officeId)
            .collection(subcollectionNames.ADDENDUM)
            .doc();

          data
            .addendumDocRef = ref;

          batch
            .set(ref, {
              activityOld,
              oldPhoneNumber,
              newPhoneNumber,
              activityData: data,
              timestamp: Date.now(),
              action: httpsActions.update,
              user: newPhoneNumber,
              activityId: data.activityId,
              userDeviceTimestamp: Date.now(),
              template: data.template,
              isSupportRequest: false,
              isAdminRequest: false,
              geopointAccuracy: null,
              provider: null,
              userDisplayName: '',
              location: null,
            });
        }

        delete data.customerObject;
        delete data.canEdit;
        delete data.activityId;
        delete data.assignees;

        batch
          .set(ref,
            Object.assign({}, data), {
            merge: true,
          });

        batch
          .delete(
            ref
              .collection(subcollectionNames.ASSIGNEES)
              .doc(oldPhoneNumber)
          );

        batch
          .set(
            ref
              .collection(subcollectionNames.ASSIGNEES)
              .doc(newPhoneNumber), {
            addToInclude: data.template === 'subscription',
          });
      });

    await batch
      .commit();

    const lastDoc = snap.docs[snap.size - 1];

    if (!lastDoc) {
      return resolve();
    }

    process
      .nextTick(() => {
        const newQuery = query
          .startAfter(lastDoc.id);

        return updateActivities(
          newQuery,
          resolve,
          reject
        );
      });
  };

  const promiseExecutor = (resolve, reject) => {
    const query = rootCollections
      .profiles
      .doc(oldPhoneNumber)
      .collection(subcollectionNames.ACTIVITIES)
      .orderBy('__name__')
      .limit(100);

    return updateActivities(
      query,
      resolve,
      reject
    );
  };

  return new Promise(promiseExecutor);
};


const populateWebapp = async (oldPhoneNumber, newPhoneNumber) => {
  const promiseCallback = (resolve, reject) => {
    const moveWebapp = async (query, resolve, reject) => {
      const snap = await query.get();
      const batch = db.batch();

      snap
        .forEach(doc => {
          const ref = rootCollections
            .profiles
            .doc(newPhoneNumber)
            .collection(subcollectionNames.WEBAPP)
            .doc(doc.id);
          const data = doc.data();

          if (data.phoneNumber === oldPhoneNumber) {
            data
              .phoneNumber = newPhoneNumber;
          }

          batch
            .set(ref, data, { merge: true });
        });

      await batch
        .commit();

      const lastDoc = snap.docs[snap.size - 1];

      if (!lastDoc) {
        return resolve();
      }

      return process
        .nextTick(() => {
          const newQuery = query
            .startAfter(lastDoc.id);

          return moveWebapp(
            newQuery,
            resolve,
            reject
          );
        });
    };

    const query = rootCollections
      .profiles
      .doc(oldPhoneNumber)
      .collection(subcollectionNames.WEBAPP)
      .orderBy('__name__')
      .limit(498);

    return moveWebapp(
      query,
      resolve,
      reject
    );
  };

  return new Promise(promiseCallback);
};


module.exports = async conn => {
  const v = validator(
    conn.req.body,
    conn.requester.phoneNumber
  );

  if (v) {
    return sendResponse(
      conn,
      code.badRequest,
      v,
    );
  }

  try {
    const newAuth = await getAuth(
      conn.req.body.newPhoneNumber
    );

    if (newAuth.uid) {
      return sendResponse(
        conn,
        code.badRequest,
        `The phone number: '${conn.req.body.newPhoneNumber}'`
        + ` is already in use`
      );
    }

    /**
     * Disabling user until all the activity
     * onWrite instances have triggered.
     */
    await admin
      .auth()
      .updateUser(conn.requester.uid, {
        disabled: true,
      });

    await populateActivities(
      (conn.req.body.oldPhoneNumber || conn.requester.phoneNumber),
      conn.req.body.newPhoneNumber,
    );

    await populateWebapp(
      conn.req.body.oldPhoneNumber,
      conn.req.body.newPhoneNumber,
    );

    const batch = db.batch();

    const profileData = (
      await rootCollections
        .profiles
        .doc(conn.req.body.oldPhoneNumber)
        .get()
    ).data() || {};

    batch
      .set(rootCollections
        .profiles
        .doc(conn.req.body.newPhoneNumber), Object.assign({}, profileData, {
          uid: conn.requester.uid,
        }), {
        merge: true,
      });

    batch
      .set(rootCollections
        .updates
        .doc(conn.requester.uid), {
        phoneNumber: conn.req.body.newPhoneNumber,
      }, {
        merge: true,
      });

    await Promise
      .all([
        batch
          .commit(),
        admin
          .auth()
          .updateUser(conn.requester.uid, {
            disabled: false,
            phoneNumber: conn.req.body.newPhoneNumber,
          }),
        admin
          .auth()
          .revokeRefreshTokens(conn.requester.uid)
      ]);

    return sendResponse(
      conn,
      code.accepted,
      'Phone Number change is in progress.'
    );
  } catch (error) {
    return handleError(conn, error);
  }
};
